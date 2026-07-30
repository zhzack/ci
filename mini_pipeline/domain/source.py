"""Protocols implemented by plugin source providers."""

from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol


class PluginSource(Protocol):
    """Fetch a plugin into a caller-owned empty destination directory."""

    source_type: str

    def fetch(self, config: Mapping[str, Any], destination: Path) -> Path:
        """Populate destination with exactly one plugin directory."""
