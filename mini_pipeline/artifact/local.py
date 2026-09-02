"""Local managed artifact storage."""

import hashlib
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from mini_pipeline.core.config import StorageConfig
from mini_pipeline.database.repositories import RunRepository
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord


class LocalArtifactStore:
    def __init__(self, storage: StorageConfig, repository: RunRepository) -> None:
        self.root = storage.artifacts.resolve()
        self.repository = repository

    def store(
        self,
        *,
        run_id: str,
        task_id: str,
        name: str,
        source: Path,
    ) -> ArtifactRecord:
        if not source.is_file():
            raise ExecutionError(f"Artifact is not a regular file: {source.name}")
        artifact_id = str(uuid.uuid4())
        destination_dir = self.root / run_id / task_id / artifact_id
        destination_dir.mkdir(parents=True, exist_ok=False)
        destination = destination_dir / "content"
        digest = hashlib.sha256()
        size = 0
        with source.open("rb") as input_stream, destination.open("wb") as output_stream:
            while True:
                chunk = input_stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                digest.update(chunk)
                output_stream.write(chunk)
        try:
            entity = self.repository.add_artifact(
                artifact_id=artifact_id,
                run_id=run_id,
                task_id=task_id,
                name=name,
                filename=source.name,
                storage_path=str(destination),
                size=size,
                sha256=digest.hexdigest(),
            )
        except Exception:
            shutil.rmtree(destination_dir, ignore_errors=True)
            raise
        return ArtifactRecord.model_validate(entity)

    def open(self, artifact: ArtifactRecord) -> BinaryIO:
        path = artifact.storage_path.resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise ExecutionError("Stored artifact file is unavailable")
        return path.open("rb")
