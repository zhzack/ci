"""Plugin registration and catalog operations."""

import os
import shutil
import tempfile
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any, BinaryIO, Optional

from mini_pipeline.core.config import StorageConfig
from mini_pipeline.database.models import PluginVersion
from mini_pipeline.database.repositories import PluginRepository
from mini_pipeline.domain.exceptions import ConflictError, SourceError
from mini_pipeline.plugin.manifest import PluginManifest, load_manifest
from mini_pipeline.source.registry import SourceRegistry
from mini_pipeline.source.upload import UploadSource


class PluginService:
    def __init__(
        self,
        *,
        storage: StorageConfig,
        repository: PluginRepository,
        sources: SourceRegistry,
        upload_source: UploadSource,
        credentials: Optional[Any] = None,
    ) -> None:
        self.storage = storage
        self.repository = repository
        self.sources = sources
        self.upload_source = upload_source
        self.credentials = credentials

    def register(
        self, source: Mapping[str, Any], *, owner_id: Optional[str] = None
    ) -> PluginVersion:
        source_type = str(source.get("type", "")).strip()
        if not source_type:
            raise SourceError("Plugin source requires a type")

        source_dict = dict(source)
        cred_id = source_dict.get("credential_id")
        if cred_id and self.credentials:
            cred_payload = self.credentials.resolve_secret(cred_id, user_id=owner_id)
            if cred_payload:
                source_dict["credential_payload"] = cred_payload

        return self._install(
            lambda destination: self.sources.fetch(source_type, source_dict, destination),
            source_type=source_type,
            source_url=str(source.get("url")) if source.get("url") else None,
            source_revision=self._source_revision(source),
            owner_id=owner_id,
        )

    def register_upload(self, stream: BinaryIO, *, owner_id: Optional[str] = None) -> PluginVersion:
        return self._install(
            lambda destination: self.upload_source.fetch_stream(stream, destination),
            source_type="upload",
            source_url=None,
            source_revision=None,
            owner_id=owner_id,
        )

    def register_folder(self, files, *, owner_id: Optional[str] = None) -> PluginVersion:
        """Register a plugin from a list of FolderFile entries."""
        from mini_pipeline.source.upload import FolderFile  # local import to avoid cycles

        if isinstance(files, FolderFile):
            files = [files]
        return self._install(
            lambda destination: self.upload_source.fetch_folder(files, destination),
            source_type="upload",
            source_url=None,
            source_revision=None,
            owner_id=owner_id,
        )

    def list(self) -> list[PluginVersion]:
        return self.repository.list_versions()

    def get(self, name: str, version: str) -> PluginVersion:
        return self.repository.get_version(name, version)

    @staticmethod
    def _source_revision(source: Mapping[str, Any]) -> Optional[str]:
        for key in ("commit", "revision", "tag", "branch"):
            if source.get(key):
                return str(source[key])
        return None

    def _install(
        self,
        fetch,
        *,
        source_type: str,
        source_url: Optional[str],
        source_revision: Optional[str],
        owner_id: Optional[str] = None,
    ) -> PluginVersion:
        staging_parent = Path(
            tempfile.mkdtemp(prefix="plugin-register-", dir=str(self.storage.temp))
        )
        fetched_path: Optional[Path] = None
        installed_path: Optional[Path] = None
        lock_descriptor: Optional[int] = None
        lock_path: Optional[Path] = None
        try:
            fetched_path = fetch(staging_parent / "source")
            manifest = load_manifest(fetched_path)
            target = self.storage.plugins / manifest.name / manifest.version
            target.parent.mkdir(parents=True, exist_ok=True)
            lock_path = target.parent / f".{manifest.version}.install.lock"
            try:
                lock_descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError as exc:
                raise ConflictError(
                    f"Plugin {manifest.name}@{manifest.version} is currently being registered"
                ) from exc
            if self.repository.version_exists(manifest.name, manifest.version):
                raise ConflictError(f"Plugin {manifest.name}@{manifest.version} already exists")
            # Filesystem may have leftover from a previous DB that was recreated.
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)

            install_staging = target.parent / f".{manifest.version}.{uuid.uuid4().hex}.tmp"
            shutil.move(str(fetched_path), install_staging)
            os.rename(install_staging, target)
            installed_path = target
            try:
                return self.repository.create_version(
                    name=manifest.name,
                    version=manifest.version,
                    description=manifest.description,
                    source_type=source_type,
                    source_url=source_url,
                    source_revision=source_revision,
                    install_path=str(target),
                    runtime_type=manifest.runtime.type,
                    entry=manifest.entry,
                    manifest=manifest.model_dump(mode="json"),
                    owner_id=owner_id,
                )
            except Exception:
                shutil.rmtree(target, ignore_errors=True)
                installed_path = None
                raise
        finally:
            if lock_descriptor is not None:
                os.close(lock_descriptor)
            if lock_path is not None:
                lock_path.unlink(missing_ok=True)
            if installed_path is None and fetched_path is not None:
                # fetched_path may already have moved; ignore either state.
                shutil.rmtree(fetched_path, ignore_errors=True)
            shutil.rmtree(staging_parent, ignore_errors=True)


def manifest_from_version(version: PluginVersion) -> PluginManifest:
    return PluginManifest.model_validate(version.manifest)
