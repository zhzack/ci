"""Local filesystem storage driver implementation with strict path containment."""

import mimetypes
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Optional

from mini_pipeline.domain.exceptions import NotFoundError, ValidationError
from mini_pipeline.storage.base import (
    StorageDriver,
    StorageItem,
    StorageLeaderboardItem,
    StorageStats,
    TypeUsage,
    ZoneUsage,
)

_TEXT_EDITABLE_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".yaml", ".yml", ".json", ".sh", ".bash",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".env", ".ini", ".conf", ".cfg",
    ".toml", ".xml", ".css", ".html", ".sql", ".dockerfile", ".ps1", ".bat",
    ".csv", ".log", ".svg"
}

_NAMED_TEXT_FILES = {"dockerfile", "makefile", "license", "readme", ".gitignore", ".env"}

_ARCHIVE_EXTS = {".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"}
_CODE_EXTS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml", ".sh",
    ".bash", ".sql", ".html", ".css", ".toml", ".xml", ".dockerfile", ".ps1", ".bat"
}
_MEDIA_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".mp4", ".mp3", ".wav", ".ico"}
_DOC_EXTS = {".md", ".markdown", ".txt", ".log", ".pdf", ".doc", ".docx", ".csv", ".xlsx"}


def is_file_editable(filename: str, mime_type: Optional[str] = None) -> bool:
    name_lower = filename.lower()
    if name_lower in _NAMED_TEXT_FILES:
        return True
    ext = Path(filename).suffix.lower()
    if ext in _TEXT_EDITABLE_EXTENSIONS:
        return True
    if mime_type and (mime_type.startswith("text/") or "json" in mime_type or "yaml" in mime_type):
        return True
    return False


def categorize_file(filename: str) -> tuple[str, str, str]:
    ext = Path(filename).suffix.lower()
    if ext in _ARCHIVE_EXTS:
        return "archives", "归档压缩包", "#722ed1"
    if ext in _CODE_EXTS:
        return "code", "代码与配置", "#1677ff"
    if ext in _MEDIA_EXTS:
        return "media", "图片与多媒体", "#13c2c2"
    if ext in _DOC_EXTS:
        return "docs", "文档与日志", "#faad14"
    return "other", "其他格式", "#8c8c8c"


class LocalStorageDriver(StorageDriver):
    """Stores files on a local filesystem directory with security controls."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @property
    def driver_name(self) -> str:
        return "local"

    def _normalize_rel_path(self, path: str) -> str:
        clean = path.strip().replace("\\", "/").strip("/")
        parts = [p for p in clean.split("/") if p and p != "."]
        if any(p == ".." for p in parts):
            raise ValidationError(f"Path traversal detected: {path}")
        return "/".join(parts)

    def _resolve_safe(self, rel_path: str) -> Path:
        normalized = self._normalize_rel_path(rel_path)
        resolved = (self.root / normalized).resolve()
        if resolved != self.root and not resolved.is_relative_to(self.root):
            raise ValidationError(f"Access outside root denied: {rel_path}")
        return resolved

    def _calc_dir_size(self, dir_path: Path) -> int:
        total = 0
        try:
            for root, _, files in os.walk(dir_path):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass
        except OSError:
            pass
        return total

    def _to_item(self, target: Path) -> StorageItem:
        rel = target.relative_to(self.root).as_posix()
        if rel == ".":
            rel = ""
        is_dir = target.is_dir()
        size = self._calc_dir_size(target) if is_dir else target.stat().st_size
        mtime = datetime.fromtimestamp(target.stat().st_mtime, tz=timezone.utc)
        ext = target.suffix.lower() if not is_dir else ""
        mime, _ = mimetypes.guess_type(target.name)
        mime = mime or ("inode/directory" if is_dir else "application/octet-stream")

        is_plugin = False
        if not is_dir and ext in {".zip", ".tar", ".gz"}:
            is_plugin = True
        elif is_dir and ((target / "plugin.yaml").is_file() or (target / "plugin.yml").is_file()):
            is_plugin = True

        return StorageItem(
            name=target.name or "root",
            path=rel,
            is_dir=is_dir,
            size=size,
            mime_type=mime,
            updated_at=mtime,
            extension=ext,
            is_editable=not is_dir and is_file_editable(target.name, mime),
            is_plugin_candidate=is_plugin,
        )

    def list_dir(self, path: str = "") -> list[StorageItem]:
        target = self._resolve_safe(path)
        if not target.exists():
            raise NotFoundError(f"Directory not found: {path}")
        if not target.is_dir():
            raise ValidationError(f"Path is not a directory: {path}")

        items: list[StorageItem] = []
        for entry in target.iterdir():
            try:
                items.append(self._to_item(entry))
            except (OSError, PermissionError):
                continue

        # Folders first, then alphabetically
        return sorted(items, key=lambda x: (not x.is_dir, x.name.lower()))

    def get_file_stream(self, path: str) -> tuple[BinaryIO, str, int]:
        target = self._resolve_safe(path)
        if not target.exists() or not target.is_file():
            raise NotFoundError(f"File not found: {path}")
        mime, _ = mimetypes.guess_type(target.name)
        mime = mime or "application/octet-stream"
        return target.open("rb"), mime, target.stat().st_size

    def read_text(self, path: str, max_chars: int = 2_000_000) -> str:
        target = self._resolve_safe(path)
        if not target.exists() or not target.is_file():
            raise NotFoundError(f"File not found: {path}")
        size = target.stat().st_size
        if size > max_chars * 4:  # rough byte limit
            msg = f"File too large to preview as text ({size} bytes, limit: {max_chars})"
            raise ValidationError(msg)

        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            try:
                return target.read_text(encoding="gbk")
            except UnicodeDecodeError:
                return target.read_text(encoding="latin-1", errors="replace")

    def write_file(self, path: str, stream: BinaryIO) -> StorageItem:
        target = self._resolve_safe(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path = target.with_suffix(f"{target.suffix}.tmp_{datetime.now().timestamp()}")
        try:
            with temp_path.open("wb") as dst:
                shutil.copyfileobj(stream, dst)
            temp_path.replace(target)
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise
        return self._to_item(target)

    def write_text(self, path: str, text: str) -> StorageItem:
        target = self._resolve_safe(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path = target.with_suffix(f"{target.suffix}.tmp_{datetime.now().timestamp()}")
        try:
            temp_path.write_text(text, encoding="utf-8")
            temp_path.replace(target)
        except Exception:
            if temp_path.exists():
                temp_path.unlink()
            raise
        return self._to_item(target)

    def create_dir(self, path: str) -> StorageItem:
        target = self._resolve_safe(path)
        target.mkdir(parents=True, exist_ok=True)
        return self._to_item(target)

    def delete(self, path: str, recursive: bool = False) -> bool:
        target = self._resolve_safe(path)
        if target == self.root:
            raise ValidationError("Cannot delete root storage directory")
        if not target.exists():
            return False
        if target.is_dir():
            if not recursive and any(target.iterdir()):
                raise ValidationError(f"Directory is not empty: {path}")
            shutil.rmtree(target)
        else:
            target.unlink()
        return True

    def stat(self, path: str) -> Optional[StorageItem]:
        target = self._resolve_safe(path)
        if not target.exists():
            return None
        return self._to_item(target)

    def get_real_path_if_local(self, path: str) -> Optional[str]:
        target = self._resolve_safe(path)
        return str(target)

    def get_stats(self, path: str = "") -> StorageStats:
        target = self._resolve_safe(path)
        if not target.exists():
            raise NotFoundError(f"Directory not found: {path}")
        if not target.is_dir():
            raise ValidationError(f"Path is not a directory: {path}")

        total_size = 0
        total_files = 0
        total_dirs = 0

        cat_stats: dict[str, dict[str, Any]] = {
            "archives": {"label": "归档压缩包", "color": "#722ed1", "size": 0, "count": 0},
            "code": {"label": "代码与配置", "color": "#1677ff", "size": 0, "count": 0},
            "media": {"label": "图片与多媒体", "color": "#13c2c2", "size": 0, "count": 0},
            "docs": {"label": "文档与日志", "color": "#faad14", "size": 0, "count": 0},
            "other": {"label": "其他格式", "color": "#8c8c8c", "size": 0, "count": 0},
        }

        zone_stats: dict[str, dict[str, Any]] = {}
        all_candidates: list[StorageLeaderboardItem] = []

        zone_names = {
            "personal": "个人私有空间",
            "shared": "团队公共空间",
            "artifacts": "流水线产物沉淀",
            "plugins": "插件暂存候选",
        }
        for sub in target.iterdir():
            if sub.is_dir():
                z_name = sub.name
                z_label = zone_names.get(z_name, z_name)
                z_size = self._calc_dir_size(sub)
                z_files = sum(len(files) for _, _, files in os.walk(sub))
                z_dirs = sum(len(dirs) for _, dirs, _ in os.walk(sub))
                zone_stats[z_name] = {
                    "zone": z_name,
                    "name": z_label,
                    "size_bytes": z_size,
                    "file_count": z_files,
                    "dir_count": z_dirs,
                }
                all_candidates.append(
                    StorageLeaderboardItem(
                        name=sub.name,
                        path=sub.relative_to(self.root).as_posix(),
                        is_dir=True,
                        size_bytes=z_size,
                        updated_at=datetime.fromtimestamp(sub.stat().st_mtime, tz=timezone.utc),
                    )
                )

        for root_dir, dir_names, filenames in os.walk(target):
            total_dirs += len(dir_names)
            for f in filenames:
                total_files += 1
                fp = Path(root_dir) / f
                try:
                    fsize = fp.stat().st_size
                    mtime = datetime.fromtimestamp(fp.stat().st_mtime, tz=timezone.utc)
                except OSError:
                    continue
                total_size += fsize
                cat, _, _ = categorize_file(f)
                cat_stats[cat]["size"] += fsize
                cat_stats[cat]["count"] += 1

                all_candidates.append(
                    StorageLeaderboardItem(
                        name=f,
                        path=fp.relative_to(self.root).as_posix(),
                        is_dir=False,
                        size_bytes=fsize,
                        updated_at=mtime,
                    )
                )

        type_usages: list[TypeUsage] = []
        for cat_key, cdata in cat_stats.items():
            if cdata["count"] > 0:
                pct = round((cdata["size"] / total_size * 100), 1) if total_size > 0 else 0.0
                type_usages.append(
                    TypeUsage(
                        category=cat_key,
                        label=cdata["label"],
                        color=cdata["color"],
                        size_bytes=cdata["size"],
                        file_count=cdata["count"],
                        percentage=pct,
                    )
                )
        type_usages.sort(key=lambda x: x.size_bytes, reverse=True)

        zone_usages: list[ZoneUsage] = []
        for _, zdata in zone_stats.items():
            pct = round((zdata["size_bytes"] / total_size * 100), 1) if total_size > 0 else 0.0
            zone_usages.append(
                ZoneUsage(
                    zone=zdata["zone"],
                    name=zdata["name"],
                    size_bytes=zdata["size_bytes"],
                    file_count=zdata["file_count"],
                    dir_count=zdata["dir_count"],
                    percentage=pct,
                )
            )
        zone_usages.sort(key=lambda x: x.size_bytes, reverse=True)

        top_largest = sorted(all_candidates, key=lambda x: x.size_bytes, reverse=True)[:10]

        rel_scope = target.relative_to(self.root).as_posix()
        if rel_scope == ".":
            rel_scope = ""

        return StorageStats(
            scope_path=rel_scope,
            total_size_bytes=total_size,
            total_files=total_files,
            total_dirs=total_dirs,
            zones=zone_usages,
            types=type_usages,
            top_largest=top_largest,
        )
