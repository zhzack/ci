"""Uploaded ZIP plugin source provider."""

import io
import tempfile
import zipfile
from collections.abc import Iterable, Mapping
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, NamedTuple, Optional

from mini_pipeline.core.config import SourceConfig
from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.source.archive import ArchiveLimits, extract_zip


class FolderFile(NamedTuple):
    """One entry inside an uploaded folder."""

    path: str  # POSIX-style relative path inside the folder
    content: bytes
    is_dir: bool
    mode: Optional[int] = None


class UploadSource:
    source_type = "upload"

    def __init__(self, settings: SourceConfig) -> None:
        self.settings = settings

    def fetch_stream(self, stream: BinaryIO, destination: Path) -> Path:
        with tempfile.NamedTemporaryFile(prefix="upload-", suffix=".zip", delete=False) as temp:
            archive_path = Path(temp.name)
        try:
            size = 0
            with archive_path.open("wb") as output:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.settings.max_archive_bytes:
                        raise SourceError("Uploaded plugin exceeds the configured size limit")
                    output.write(chunk)
            return extract_zip(
                archive_path,
                destination,
                ArchiveLimits(
                    max_files=self.settings.max_archive_files,
                    max_extracted_bytes=self.settings.max_extracted_bytes,
                ),
            )
        finally:
            archive_path.unlink(missing_ok=True)

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        source_path = Path(str(config.get("path", "")))
        if not source_path.is_file():
            raise SourceError("Upload source requires an existing temporary path")
        with source_path.open("rb") as stream:
            return self.fetch_stream(stream, destination)

    def fetch_folder(self, files: Iterable[FolderFile], destination: Path) -> Path:
        """Build a zip archive from an in-memory folder and run it through the
        normal extract pipeline. Files are validated and bounded like the zip
        upload path, so the same protections apply.
        """
        entries = self._normalize_folder(files)
        if not any(not entry.is_dir for entry in entries):
            raise SourceError("Uploaded folder is empty")

        buffer = io.BytesIO()
        size = 0
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
            seen_dirs: set[str] = set()
            for entry in entries:
                parent = str(PurePosixPath(entry.path).parent)
                if parent and parent != "." and parent not in seen_dirs:
                    archive.writestr(parent + "/", b"")
                    seen_dirs.add(parent)
                if entry.is_dir:
                    if entry.path and entry.path not in seen_dirs:
                        archive.writestr(entry.path + "/", b"")
                        seen_dirs.add(entry.path)
                    continue
                info = zipfile.ZipInfo(entry.path)
                if entry.mode is not None:
                    info.external_attr = (entry.mode & 0o777) << 16
                archive.writestr(info, entry.content)
                size += len(entry.content)
                if size > self.settings.max_archive_bytes:
                    raise SourceError(
                        "Uploaded folder exceeds the configured size limit"
                    )
        buffer.seek(0)
        return self.fetch_stream(buffer, destination)

    @staticmethod
    def _normalize_folder(files: Iterable[FolderFile]) -> list[FolderFile]:
        normalized: list[FolderFile] = []
        seen: set[str] = set()
        for entry in files:
            raw = entry.path.strip().replace("\\", "/").lstrip("/")
            if not raw:
                continue
            parts = [part for part in raw.split("/") if part not in {"", "."}]
            if any(part == ".." for part in parts):
                raise SourceError(f"Unsafe path in folder upload: {entry.path!r}")
            if not parts:
                continue
            posix = "/".join(parts)
            if posix in seen:
                continue
            seen.add(posix)
            normalized.append(
                FolderFile(
                    path=posix,
                    content=entry.content,
                    is_dir=entry.is_dir,
                    mode=entry.mode if isinstance(entry.mode, int) else None,
                )
            )
        return normalized
