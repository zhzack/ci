"""Safe archive extraction shared by HTTP and upload sources."""

import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath

from mini_pipeline.domain.exceptions import SourceError


class ArchiveLimits:
    def __init__(self, *, max_files: int, max_extracted_bytes: int) -> None:
        self.max_files = max_files
        self.max_extracted_bytes = max_extracted_bytes


def extract_zip(archive: Path, destination: Path, limits: ArchiveLimits) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        zip_file = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as exc:
        raise SourceError("Plugin source is not a valid ZIP archive") from exc

    with zip_file:
        members = zip_file.infolist()
        if len(members) > limits.max_files:
            raise SourceError("Plugin archive contains too many files")
        total_size = sum(member.file_size for member in members)
        if total_size > limits.max_extracted_bytes:
            raise SourceError("Plugin archive expands beyond the configured size limit")

        destination = destination.resolve()
        for member in members:
            relative = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            if (
                not member.filename
                or relative.is_absolute()
                or ".." in relative.parts
                or stat.S_ISLNK(mode)
            ):
                raise SourceError(f"Unsafe path in plugin archive: {member.filename!r}")
            target = (destination / Path(*relative.parts)).resolve()
            if not target.is_relative_to(destination):
                raise SourceError(f"Unsafe path in plugin archive: {member.filename!r}")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zip_file.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            if mode:
                target.chmod(mode & 0o777)

    return normalize_plugin_root(destination)


def normalize_plugin_root(destination: Path) -> Path:
    """Accept plugin.yaml at archive root or below one wrapping directory."""
    if (destination / "plugin.yaml").is_file():
        return destination
    entries = [entry for entry in destination.iterdir() if entry.name != "__MACOSX"]
    if len(entries) == 1 and entries[0].is_dir() and (entries[0] / "plugin.yaml").is_file():
        return entries[0]
    raise SourceError("Plugin source must contain plugin.yaml at its root")
