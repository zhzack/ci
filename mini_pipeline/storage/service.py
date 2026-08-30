import io
import json
import mimetypes
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import BinaryIO, Optional

from mini_pipeline.account.service import PermissionService, Principal
from mini_pipeline.core.config import Settings
from mini_pipeline.database.account_repositories import (
    GrantRepository,
    PackageShareRepository,
    TeamRepository,
)
from mini_pipeline.database.models import PackageShareLink, ShareGrant
from mini_pipeline.domain.exceptions import NotFoundError, PermissionDeniedError, ValidationError
from mini_pipeline.domain.models import PluginRecord
from mini_pipeline.plugin.service import PluginService
from mini_pipeline.storage.base import (
    DirectoryListing,
    FilePreview,
    StorageDriver,
    StorageItem,
    StorageStats,
)
from mini_pipeline.storage.local import LocalStorageDriver
from mini_pipeline.storage.s3 import S3StorageDriver


class PackageStorageService:
    """Service providing unified package & artifact file operations across drivers."""

    def __init__(
        self,
        settings: Settings,
        plugin_service: Optional[PluginService] = None,
        driver: Optional[StorageDriver] = None,
        shares: Optional[PackageShareRepository] = None,
        permissions: Optional[PermissionService] = None,
        grants: Optional[GrantRepository] = None,
        teams: Optional[TeamRepository] = None,
    ) -> None:
        self.settings = settings
        self.plugin_service = plugin_service
        self.shares = shares
        self.permissions = permissions
        self.grants = grants
        self.teams = teams

        if driver is not None:
            self.driver = driver
        elif settings.packages.driver.lower() == "s3":
            s3_cfg = settings.packages.s3
            self.driver = S3StorageDriver(
                bucket_name=s3_cfg.bucket_name,
                endpoint_url=s3_cfg.endpoint_url,
                access_key=s3_cfg.access_key,
                secret_key=s3_cfg.secret_key,
                region=s3_cfg.region,
            )
        else:
            self.driver = LocalStorageDriver(root=settings.packages.local.root)

        # Pre-seed default shared directories
        self._init_default_zones()

    def _init_default_zones(self) -> None:
        """Ensure standard top-level zones exist."""
        for zone in ["personal", "shared", "artifacts", "plugins"]:
            try:
                if not self.driver.stat(zone):
                    self.driver.create_dir(zone)
            except Exception:
                pass

    def ensure_user_zone(self, username: str) -> StorageItem:
        """Ensure a user's personal zone directory exists."""
        clean_user = username.strip().replace("\\", "/").strip("/")
        if not clean_user:
            raise ValidationError("Username cannot be empty")
        path = f"personal/{clean_user}"
        item = self.driver.stat(path)
        if not item:
            item = self.driver.create_dir(path)
        return item

    def check_zone_access(
        self, principal: Principal, path: str, write: bool = False
    ) -> None:
        """Enforce zone-based permissions and ACL grants for multi-tenant isolation."""
        if principal.is_admin:
            return

        clean = path.strip().replace("\\", "/").strip("/")
        if not clean:
            if write:
                raise PermissionDeniedError("Cannot write to root package directory")
            return

        # Check if caller has explicit grant or zone permission
        if self.permissions and self.permissions.package_can_access(principal, clean, write=write):
            return

        parts = clean.split("/")
        top_zone = parts[0]

        if top_zone == "personal":
            if len(parts) < 2:
                # Listing personal/ top-level is restricted to admin unless reading
                if write:
                    raise PermissionDeniedError("Cannot write directly under personal/")
                return
            target_user = parts[1]
            user_name = getattr(principal, "username", None) or getattr(principal, "name", "")
            if target_user != user_name and not principal.is_admin:
                raise PermissionDeniedError(
                    f"Access denied: cannot access personal zone of user {target_user!r}"
                )
        elif top_zone in {"shared", "artifacts", "plugins"}:
            if top_zone == "artifacts" and write:
                raise PermissionDeniedError("Direct writes to artifacts/ zone are prohibited")
            return
        else:
            if write and not principal.is_admin:
                raise PermissionDeniedError(
                    f"Write access to custom zone {top_zone!r} requires admin role"
                )

    def _get_parent_path(self, path: str) -> Optional[str]:
        clean = path.strip().replace("\\", "/").strip("/")
        if not clean:
            return None
        parts = clean.split("/")
        if len(parts) <= 1:
            return ""
        return "/".join(parts[:-1])

    def list_directory(
        self, path: str = "", principal: Optional[Principal] = None
    ) -> DirectoryListing:
        clean = path.strip().replace("\\", "/").strip("/")
        if clean.startswith("personal/"):
            parts = clean.split("/")
            if len(parts) >= 2 and parts[1]:
                self.ensure_user_zone(parts[1])
        elif clean in {"personal", "shared", "artifacts", "plugins"}:
            try:
                if not self.driver.stat(clean):
                    self.driver.create_dir(clean)
            except Exception:
                pass
        items = self.driver.list_dir(clean)

        # Filter items for non-admin users browsing root or personal zone
        if principal and not principal.is_admin:
            user_name = getattr(principal, "username", None) or getattr(principal, "name", "")
            if clean == "personal":
                # Only show user's own folder plus any granted personal folders
                allowed_users = {user_name}
                if self.grants and principal.user_id:
                    team_ids = (
                        {t.id for t in self.teams.teams_of_user(principal.user_id)}
                        if self.teams
                        else set()
                    )
                    for g in self.grants.list_for_grantee(
                        user_id=principal.user_id, team_ids=team_ids, resource_type="package"
                    ):
                        g_parts = g.resource_id.split("/")
                        if len(g_parts) >= 2 and g_parts[0] == "personal":
                            allowed_users.add(g_parts[1])
                items = [i for i in items if i.name in allowed_users]

        parent = self._get_parent_path(clean)
        return DirectoryListing(
            driver=self.driver.driver_name,
            current_path=clean,
            parent_path=parent,
            items=items,
        )

    def get_stats(
        self, path: str = "", principal: Optional[Principal] = None
    ) -> StorageStats:
        clean = path.strip().replace("\\", "/").strip("/")
        if principal and not principal.is_admin and not clean:
            user_name = getattr(principal, "username", None) or getattr(principal, "name", "")
            clean = f"personal/{user_name}"
            self.ensure_user_zone(user_name)

        return self.driver.get_stats(clean)

    def get_file(self, path: str) -> tuple[BinaryIO, str, int, str]:
        clean = path.strip().replace("\\", "/").strip("/")
        stat = self.driver.stat(clean)
        if not stat:
            raise NotFoundError(f"File or directory {path!r} not found")
        if stat.is_dir:
            # Package directory into a ZIP archive on-the-fly
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                real_dir = self.driver.get_real_path_if_local(clean)
                if real_dir:
                    p_dir = Path(real_dir)
                    for p in p_dir.rglob("*"):
                        if p.is_file():
                            rel = p.relative_to(p_dir).as_posix()
                            zf.write(p, arcname=rel)
                else:
                    def _zip_walk(sub_path: str, prefix: str = ""):
                        for item in self.driver.list_dir(sub_path):
                            if item.is_dir:
                                _zip_walk(item.path, f"{prefix}{item.name}/")
                            else:
                                s, _, _ = self.driver.get_file_stream(item.path)
                                zf.writestr(f"{prefix}{item.name}", s.read())
                    _zip_walk(clean)
            buf.seek(0)
            zip_name = f"{stat.name or 'packages'}.zip"
            return buf, "application/zip", buf.getbuffer().nbytes, zip_name

        filename = clean.split("/")[-1] if clean else "file"
        stream, mime, size = self.driver.get_file_stream(clean)
        return stream, mime, size, filename

    def batch_get_files(self, paths: list[str]) -> tuple[BinaryIO, str, int, str]:
        """Bundle multiple selected files and directories into a single ZIP archive on-the-fly."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for p_str in paths:
                clean = p_str.strip().replace("\\", "/").strip("/")
                if not clean:
                    continue
                stat = self.driver.stat(clean)
                if not stat:
                    continue
                if stat.is_dir:
                    base_name = stat.name or "folder"
                    real_dir = self.driver.get_real_path_if_local(clean)
                    if real_dir:
                        p_dir = Path(real_dir)
                        for p in p_dir.rglob("*"):
                            if p.is_file():
                                rel = f"{base_name}/{p.relative_to(p_dir).as_posix()}"
                                zf.write(p, arcname=rel)
                    else:
                        def _zip_walk(sub_path: str, prefix: str = ""):
                            for item in self.driver.list_dir(sub_path):
                                if item.is_dir:
                                    _zip_walk(item.path, f"{prefix}{item.name}/")
                                else:
                                    s, _, _ = self.driver.get_file_stream(item.path)
                                    zf.writestr(f"{prefix}{item.name}", s.read())
                        _zip_walk(clean, f"{base_name}/")
                else:
                    file_name = clean.split("/")[-1]
                    stream, _, _ = self.driver.get_file_stream(clean)
                    zf.writestr(file_name, stream.read())
        buf.seek(0)
        zip_name = f"batch_download_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return buf, "application/zip", buf.getbuffer().nbytes, zip_name

    def preview_file(self, path: str) -> FilePreview:
        clean = path.strip().replace("\\", "/").strip("/")
        stat = self.driver.stat(clean)
        if not stat or stat.is_dir:
            raise NotFoundError(f"File not found or is a directory: {path}")

        mime, _ = mimetypes.guess_type(stat.name)
        mime = mime or stat.mime_type or "application/octet-stream"

        is_text = stat.is_editable or (
            mime.startswith("text/")
            or "json" in mime
            or "yaml" in mime
            or "xml" in mime
            or "javascript" in mime
        )

        content: Optional[str] = None
        line_count = 0
        if is_text:
            try:
                content = self.driver.read_text(clean, max_chars=1_000_000)
                line_count = len(content.splitlines())
            except Exception as e:
                is_text = False
                content = f"[Preview unavailable: {e}]"

        return FilePreview(
            name=stat.name,
            path=stat.path,
            size=stat.size,
            mime_type=mime,
            is_text=is_text,
            content=content,
            line_count=line_count,
            is_editable=stat.is_editable,
            updated_at=stat.updated_at,
        )

    def save_text_file(self, path: str, content: str) -> StorageItem:
        clean = path.strip().replace("\\", "/").strip("/")
        if not clean:
            raise ValidationError("File path cannot be empty")
        return self.driver.write_text(clean, content)

    def save_uploaded_file(
        self,
        target_dir: str,
        filename: str,
        stream: BinaryIO,
        relative_path: Optional[str] = None,
    ) -> StorageItem:
        dir_clean = target_dir.strip().replace("\\", "/").strip("/")
        if relative_path:
            clean_rel = relative_path.strip().replace("\\", "/").strip("/")
            parts = [p for p in clean_rel.split("/") if p and p != "."]
            if any(p == ".." for p in parts):
                raise ValidationError(f"Path traversal detected in relative_path: {relative_path}")
            safe_rel = "/".join(parts)
            target_path = f"{dir_clean}/{safe_rel}" if dir_clean else safe_rel
        else:
            file_clean = filename.strip().replace("\\", "/").split("/")[-1]
            if not file_clean:
                raise ValidationError(f"Invalid filename: {filename}")
            target_path = f"{dir_clean}/{file_clean}" if dir_clean else file_clean

        return self.driver.write_file(target_path, stream)

    def extract_archive(self, path: str, target_dir: Optional[str] = None) -> StorageItem:
        """Extract a zip or tar.gz archive into a directory."""
        clean = path.strip().replace("\\", "/").strip("/")
        stat = self.driver.stat(clean)
        if not stat or stat.is_dir:
            raise NotFoundError(f"Archive file not found: {path}")

        stream, _, _, filename = self.get_file(clean)
        # Determine extraction destination directory
        if target_dir:
            dest_dir = target_dir.strip().replace("\\", "/").strip("/")
        else:
            parent = "/".join(clean.split("/")[:-1])
            stem = filename
            for suffix in [".tar.gz", ".tgz", ".zip", ".tar"]:
                if stem.lower().endswith(suffix):
                    stem = stem[: -len(suffix)]
                    break
            dest_dir = f"{parent}/{stem}" if parent else stem

        if filename.lower().endswith(".zip"):
            with zipfile.ZipFile(stream) as zf:
                for member in zf.infolist():
                    if member.is_dir():
                        continue
                    m_parts = [
                        p for p in member.filename.replace("\\", "/").split("/") if p and p != "."
                    ]
                    if any(p == ".." for p in m_parts):
                        continue
                    rel_path = "/".join(m_parts)
                    file_target = f"{dest_dir}/{rel_path}"
                    with zf.open(member) as item_stream:
                        self.driver.write_file(file_target, item_stream)
        elif filename.lower().endswith((".tar.gz", ".tgz", ".tar")):
            import tarfile

            mode = "r:gz" if filename.lower().endswith((".tar.gz", ".tgz")) else "r:"
            with tarfile.open(fileobj=stream, mode=mode) as tf:
                for member in tf.getmembers():
                    if not member.isfile():
                        continue
                    m_parts = [
                        p for p in member.name.replace("\\", "/").split("/") if p and p != "."
                    ]
                    if any(p == ".." for p in m_parts):
                        continue
                    rel_path = "/".join(m_parts)
                    file_target = f"{dest_dir}/{rel_path}"
                    f = tf.extractfile(member)
                    if f:
                        self.driver.write_file(file_target, f)
        else:
            raise ValidationError(f"Unsupported archive format: {filename}")

        out_item = self.driver.stat(dest_dir)
        if not out_item:
            out_item = self.driver.create_dir(dest_dir)
        return out_item

    def create_directory(self, parent_dir: str, name: str) -> StorageItem:
        dir_clean = parent_dir.strip().replace("\\", "/").strip("/")
        name_clean = name.strip().replace("\\", "/").strip("/")
        if not name_clean or "/" in name_clean or name_clean == "..":
            raise ValidationError(f"Invalid directory name: {name}")

        target_path = f"{dir_clean}/{name_clean}" if dir_clean else name_clean
        return self.driver.create_dir(target_path)

    def delete_item(self, path: str, recursive: bool = False) -> bool:
        clean = path.strip().replace("\\", "/").strip("/")
        if not clean:
            raise ValidationError("Cannot delete root directory")
        return self.driver.delete(clean, recursive=recursive)

    def copy_item(self, src_path: str, dst_path: str) -> StorageItem:
        """Copy a file or directory within package storage (for sharing, cloning or importing)."""
        src_clean = src_path.strip().replace("\\", "/").strip("/")
        dst_clean = dst_path.strip().replace("\\", "/").strip("/")
        if not src_clean or not dst_clean:
            raise ValidationError("Source and destination paths cannot be empty")

        real_src = self.driver.get_real_path_if_local(src_clean)
        real_dst = self.driver.get_real_path_if_local(dst_clean)
        if real_src and real_dst:
            p_src = Path(real_src)
            p_dst = Path(real_dst)
            if not p_src.exists():
                raise NotFoundError(f"Source item not found: {src_path}")
            p_dst.parent.mkdir(parents=True, exist_ok=True)
            if p_src.is_dir():
                shutil.copytree(p_src, p_dst, dirs_exist_ok=True)
            else:
                shutil.copy2(p_src, p_dst)
            stat = self.driver.stat(dst_clean)
            return stat or self.driver.create_dir(dst_clean)
        else:
            stream, _, _ = self.driver.get_file_stream(src_clean)
            return self.driver.write_file(dst_clean, stream)

    def publish_as_plugin(self, path: str, owner_id: Optional[str] = None) -> PluginRecord:
        """Import a zip archive or directory containing plugin.yaml directly into plugin store."""
        if not self.plugin_service:
            raise ValidationError("Plugin service is not configured")

        clean = path.strip().replace("\\", "/").strip("/")
        stat = self.driver.stat(clean)
        if not stat:
            raise NotFoundError(f"Package path not found: {path}")

        # Case 1: Zip archive
        if not stat.is_dir and (clean.endswith(".zip") or clean.endswith(".tar.gz")):
            stream, _, _, _ = self.get_file(clean)
            version = self.plugin_service.register_upload(stream, owner_id=owner_id)
            return self.plugin_service.get(version.name, version.version)

        # Case 2: Local directory containing plugin.yaml
        local_path = self.driver.get_real_path_if_local(clean)
        if stat.is_dir and local_path:
            dir_path = Path(local_path)
            yaml_file = dir_path / "plugin.yaml"
            if not yaml_file.is_file():
                yaml_file = dir_path / "plugin.yml"
            if not yaml_file.is_file():
                raise ValidationError(f"Directory {clean} does not contain plugin.yaml")

            # Pack folder to in-memory zip
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_path in dir_path.rglob("*"):
                    if file_path.is_file():
                        rel = file_path.relative_to(dir_path)
                        zf.write(file_path, rel.as_posix())
            zip_buffer.seek(0)
            version = self.plugin_service.register_upload(zip_buffer, owner_id=owner_id)
            return self.plugin_service.get(version.name, version.version)

        raise ValidationError(f"Path is neither a zip file nor a local plugin directory: {path}")

    # --- Share Links & Cross-User Collaboration ---

    def create_share_link(
        self,
        *,
        owner_id: str,
        source_path: str,
        share_type: str,
        description: str = "",
        expires_at: Optional[datetime] = None,
    ) -> PackageShareLink:
        """Create a share link for a file or directory."""
        if not self.shares:
            raise ValidationError("Share repository is not configured")

        clean_path = source_path.strip().replace("\\", "/").strip("/")
        if not clean_path:
            raise ValidationError("Source path cannot be empty")

        stat = self.driver.stat(clean_path)
        if not stat:
            raise NotFoundError(f"Source path {source_path!r} does not exist")

        if share_type not in {"live", "snapshot"}:
            raise ValidationError("share_type must be either 'live' or 'snapshot'")

        return self.shares.create(
            owner_id=owner_id,
            source_path=clean_path,
            share_type=share_type,
            description=description,
            expires_at=expires_at,
        )

    def resolve_share_link(self, token: str) -> PackageShareLink:
        """Look up a share link by token and verify its expiration."""
        if not self.shares:
            raise ValidationError("Share repository is not configured")

        link = self.shares.get_by_token(token)
        if not link:
            raise NotFoundError(f"Share link {token!r} not found")

        if link.expires_at and link.expires_at < datetime.utcnow():
            raise NotFoundError("This share link has expired")

        return link

    def list_shared_directory(self, token: str, sub_path: str = "") -> DirectoryListing:
        """List contents of a shared path via its token."""
        link = self.resolve_share_link(token)
        clean_sub = sub_path.strip().replace("\\", "/").strip("/")
        target = f"{link.source_path}/{clean_sub}" if clean_sub else link.source_path
        return self.list_directory(target)

    def get_shared_file(self, token: str, sub_path: str = "") -> tuple[BinaryIO, str, int, str]:
        """Download a file or directory as zip via a share link."""
        link = self.resolve_share_link(token)
        clean_sub = sub_path.strip().replace("\\", "/").strip("/")
        target = f"{link.source_path}/{clean_sub}" if clean_sub else link.source_path
        return self.get_file(target)

    def import_from_share(
        self,
        token: str,
        target_path: str,
        importer_user_id: str,
        importer_username: str,
    ) -> StorageItem:
        """Import a shared resource into the importer's personal or shared zone."""
        link = self.resolve_share_link(token)
        clean_target = target_path.strip().replace("\\", "/").strip("/")

        # Ensure user's personal zone exists
        self.ensure_user_zone(importer_username)

        if not clean_target:
            src_name = link.source_path.split("/")[-1]
            clean_target = f"personal/{importer_username}/{src_name}"

        # Destination must be in personal/<username>/ or shared/
        if not (
            clean_target.startswith(f"personal/{importer_username}")
            or clean_target.startswith("shared/")
        ):
            clean_target = f"personal/{importer_username}/{clean_target.split('/')[-1]}"

        if link.share_type == "snapshot":
            # Physical copy creating independent snapshot
            return self.copy_item(link.source_path, clean_target)
        else:
            # Live link: write a descriptor pointer file
            link_data = {
                "__package_link__": True,
                "type": "live",
                "token": token,
                "source_path": link.source_path,
                "name": link.source_path.split("/")[-1],
                "created_at": datetime.utcnow().isoformat(),
            }
            final_path = (
                clean_target
                if clean_target.endswith(".link.json")
                else f"{clean_target}.link.json"
            )
            return self.save_text_file(final_path, json.dumps(link_data, indent=2))

    def list_user_shares(self, owner_id: str) -> list[PackageShareLink]:
        """List all active share links created by the user."""
        if not self.shares:
            return []
        return self.shares.list_by_owner(owner_id)

    def delete_share_link(self, token: str, owner_id: Optional[str] = None) -> bool:
        """Delete / revoke a share link."""
        if not self.shares:
            return False
        return self.shares.delete_by_token(token, owner_id=owner_id)

    # --- Directory Access Control (Grants) ---

    def grant_path_access(
        self,
        *,
        principal: Principal,
        path: str,
        grantee_type: str,
        grantee_id: str,
        permission: str = "viewer",
    ) -> ShareGrant:
        """Grant a user or team access to a specific directory."""
        if not self.grants:
            raise ValidationError("Grants repository is not configured")
        clean = path.strip().replace("\\", "/").strip("/")
        if not principal.is_admin:
            user_name = principal.username or principal.name
            if not clean.startswith(f"personal/{user_name}"):
                raise PermissionDeniedError("Only admin or directory owner can grant permissions")
        return self.grants.create(
            resource_type="package",
            resource_id=clean,
            grantee_type=grantee_type,
            grantee_id=grantee_id,
            permission=permission,
            granted_by=principal.user_id,
        )

    def list_path_grants(self, principal: Principal, path: str) -> list[ShareGrant]:
        """List all active ACL grants for a directory."""
        if not self.grants:
            return []
        clean = path.strip().replace("\\", "/").strip("/")
        return self.grants.list_for_resource(resource_type="package", resource_id=clean)

    def revoke_path_grant(self, principal: Principal, grant_id: str) -> None:
        """Revoke a directory ACL grant."""
        if not self.grants:
            return
        grant = self.grants.get(grant_id)
        if not grant:
            raise NotFoundError(f"Grant {grant_id!r} not found")
        if not principal.is_admin:
            user_name = principal.username or principal.name
            if not grant.resource_id.startswith(f"personal/{user_name}"):
                raise PermissionDeniedError("Only admin or directory owner can revoke permissions")
        self.grants.delete(grant_id)



