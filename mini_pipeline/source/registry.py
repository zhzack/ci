"""Registry for extensible plugin source providers."""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.domain.source import PluginSource


class SourceRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, PluginSource] = {}

    def register(self, provider: PluginSource) -> None:
        self._providers[provider.source_type] = provider

    def fetch(self, source_type: str, config: Mapping[str, Any], destination: Path) -> Path:
        try:
            provider = self._providers[source_type]
        except KeyError as exc:
            raise ValidationError(f"Unsupported plugin source type: {source_type}") from exc
        result = provider.fetch(config, destination)
        return result if isinstance(result, Path) else destination
