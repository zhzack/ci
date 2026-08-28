"""Toolhub plugin source provider.

Fetches a tool from an IMFL Tool Hub registry (index.json + tar.gz artifacts)
and returns it as a plugin directory containing plugin.yaml. The toolhub
registry layout matches the one produced by toolhub's publish.sh:

    <hub>/index.json
    <hub>/<tool>/<channel>/<version>/<tool>-<version>.tar.gz

index.json entries look like::

    "sync": {
      "runtime": "python",
      "entry": "sync.py",
      "env": {...},
      "channels": {
        "stable": [{"version": "v1.0.1", "artifact": "sync/stable/..."}]
      }
    }

The toolhub plugin.yaml is a superset of Mini Pipeline's plugin.yaml: it keeps
the same runtime.type / runtime.entry / contract fields and adds a toolhub.env
block which Mini Pipeline ignores.
"""

import io
import tarfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional

import httpx

from mini_pipeline.core.config import SourceConfig
from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.source.archive import ArchiveLimits, normalize_plugin_root

_MAX_INDEX_BYTES = 4 * 1024 * 1024


class ToolhubSource:
    source_type = "toolhub"

    def __init__(self, settings: SourceConfig) -> None:
        self.settings = settings

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        hub = str(config.get("hub", "")).strip().rstrip("/")
        if not hub:
            raise SourceError("Toolhub source requires a hub url")
        tool = str(config.get("tool", "")).strip()
        if not tool:
            raise SourceError("Toolhub source requires a tool name")
        channel = str(config.get("channel", "")).strip() or "stable"
        version = str(config.get("version", "")).strip()
        auth = str(config.get("auth", "")).strip()

        index = self._fetch_index(hub, auth)
        entry = self._resolve(index, tool, channel, version)
        artifact_path = str(entry["artifact"])
        download_url = f"{hub}/{artifact_path}"
        return self._fetch_tar(download_url, auth, destination)

    def _auth(self, auth: str) -> Optional[tuple[str, str]]:
        if not auth:
            return None
        user, _, password = auth.partition(":")
        return (user, password) if user else None

    def _fetch_index(self, hub: str, auth: str) -> dict:
        url = f"{hub}/index.json"
        try:
            response = httpx.get(
                url,
                auth=self._auth(auth),
                follow_redirects=True,
                timeout=self.settings.http_timeout_seconds,
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise SourceError(f"Unable to fetch toolhub index.json: {exc}") from exc
        if len(response.content) > _MAX_INDEX_BYTES:
            raise SourceError("toolhub index.json exceeds the configured size limit")
        try:
            data = response.json()
        except ValueError as exc:
            raise SourceError("toolhub index.json is not valid JSON") from exc
        if not isinstance(data, dict) or not isinstance(data.get("tools"), dict):
            raise SourceError("toolhub index.json has an unexpected structure")
        return data

    def _resolve(self, index: dict, tool: str, channel: str, version: str) -> dict:
        tools = index.get("tools", {})
        meta = tools.get(tool)
        if not isinstance(meta, dict):
            raise SourceError(f"tool {tool!r} not found in toolhub index")
        channels = meta.get("channels", {})
        if version:
            for _ch_name, entries in channels.items():
                for entry in entries:
                    if entry.get("version") == version:
                        return entry
            raise SourceError(
                f"tool {tool!r} version {version!r} not found in toolhub index"
            )
        entries = channels.get(channel, [])
        if not entries:
            raise SourceError(
                f"tool {tool!r} has no versions in channel {channel!r}"
            )
        return entries[0]

    def _fetch_tar(self, url: str, auth: str, destination: Path) -> Path:
        destination.mkdir(parents=True, exist_ok=True)
        try:
            with httpx.stream(
                "GET",
                url,
                auth=self._auth(auth),
                follow_redirects=True,
                timeout=self.settings.http_timeout_seconds,
            ) as response:
                response.raise_for_status()
                buffer = io.BytesIO()
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > self.settings.max_archive_bytes:
                        raise SourceError(
                            "Toolhub download exceeds the configured size limit"
                        )
                    buffer.write(chunk)
        except httpx.HTTPError as exc:
            raise SourceError(f"Unable to download toolhub artifact: {exc}") from exc

        buffer.seek(0)
        return extract_tar_gz(
            buffer,
            destination,
            ArchiveLimits(
                max_files=self.settings.max_archive_files,
                max_extracted_bytes=self.settings.max_extracted_bytes,
            ),
        )


def extract_tar_gz(stream: io.BytesIO, destination: Path, limits: ArchiveLimits) -> Path:
    """Safely extract a toolhub tar.gz artifact into destination.

    Guards against path traversal, absolute paths, symlinks and size limits,
    mirroring the protections used for ZIP archives.
    """
    try:
        with tarfile.open(fileobj=stream, mode="r:gz") as archive:
            members = archive.getmembers()
            if len(members) > limits.max_files:
                raise SourceError("Toolhub archive contains too many files")
            total_size = sum(m.size for m in members)
            if total_size > limits.max_extracted_bytes:
                raise SourceError("Toolhub archive expands beyond the configured size limit")

            destination = destination.resolve()
            for member in members:
                relative = Path(member.name)
                if (
                    not member.name
                    or relative.is_absolute()
                    or ".." in relative.parts
                    or member.issym()
                    or member.islnk()
                ):
                    raise SourceError(f"Unsafe path in toolhub archive: {member.name!r}")
                target = (destination / relative).resolve()
                if not target.is_relative_to(destination):
                    raise SourceError(f"Unsafe path in toolhub archive: {member.name!r}")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    continue
                with source, target.open("wb") as output:
                    import shutil

                    shutil.copyfileobj(source, output)
                mode = member.mode & 0o777 if member.mode else 0
                if mode:
                    target.chmod(mode)
    except tarfile.TarError as exc:
        raise SourceError(f"Toolhub artifact is not a valid tar.gz: {exc}") from exc

    return normalize_plugin_root(destination)
