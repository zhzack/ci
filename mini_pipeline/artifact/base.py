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

    def delete(self, artifact: ArtifactRecord) -> None:
        """Remove the stored content of one artifact (best effort)."""

    def presign_download(
        self, artifact: ArtifactRecord, *, expires_seconds: int = 3600
    ) -> str | None:
        """Direct-download URL bypassing the API server, if supported.

        Object-storage backends return a presigned URL; local-disk backends
        return None and callers fall back to the proxied download endpoint.
        """
        return None
