"""Common interface for run artifact storage backends."""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO, Protocol

from mini_pipeline.domain.models import ArtifactRecord


class ArtifactStore(Protocol):
    """Storage backend for artifacts collected from task runs.

    ``store`` persists one artifact file and records it in the database;
    ``open`` returns a readable binary stream for the stored content.
    """

    def store(
        self,
        *,
        run_id: str,
        task_id: str,
        name: str,
        source: Path,
    ) -> ArtifactRecord: ...

    def open(self, artifact: ArtifactRecord) -> BinaryIO: ...
