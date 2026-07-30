"""Protocols shared by artifact storage implementations."""

from pathlib import Path
from typing import BinaryIO, Protocol

from mini_pipeline.domain.models import ArtifactRecord


class ArtifactStore(Protocol):
    def store(
        self,
        *,
        run_id: str,
        task_id: str,
        name: str,
        source: Path,
    ) -> ArtifactRecord:
        """Persist one file from a task workspace."""

    def open(self, artifact: ArtifactRecord) -> BinaryIO:
        """Open a previously stored artifact for reading."""
