"""HTTP ZIP plugin source provider."""

import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx

from mini_pipeline.core.config import SourceConfig
from mini_pipeline.domain.exceptions import SourceError
from mini_pipeline.source.archive import ArchiveLimits, extract_zip


class HttpSource:
    source_type = "http"

    def __init__(self, settings: SourceConfig) -> None:
        self.settings = settings

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        url = str(config.get("url", "")).strip()
        if not url:
            raise SourceError("HTTP source requires a url")
        if not url.startswith(("http://", "https://")):
            raise SourceError("HTTP source url must use http or https")

        with tempfile.NamedTemporaryFile(prefix="plugin-", suffix=".zip", delete=False) as temp:
            archive_path = Path(temp.name)
        try:
            size = 0
            try:
                with httpx.stream(
                    "GET",
                    url,
                    follow_redirects=True,
                    timeout=self.settings.http_timeout_seconds,
                ) as response:
                    response.raise_for_status()
                    with archive_path.open("wb") as stream:
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > self.settings.max_archive_bytes:
                                raise SourceError(
                                    "Plugin download exceeds the configured size limit"
                                )
                            stream.write(chunk)
            except httpx.HTTPError as exc:
                raise SourceError(f"Unable to download plugin: {exc}") from exc
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
