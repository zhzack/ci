"""S3-compatible artifact storage (AWS S3, MinIO, OSS, COS, R2).

Stores run artifacts under ``<prefix>/<run_id>/<task_id>/<artifact_id>/content``
in an S3 bucket, delegating transfer and AWS SigV4 signing to the existing
:class:`S3StorageDriver` (no boto3 dependency). The database ``storage_path``
column holds the object key, so the same opaque ``artifact_id`` download API
works unchanged regardless of the configured backend.
"""

from __future__ import annotations

import hashlib
import io
import uuid
from pathlib import Path
from typing import BinaryIO

from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.core.config import ArtifactStorageConfig
from mini_pipeline.database.repositories import RunRepository
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord
from mini_pipeline.storage.s3 import S3StorageDriver


class S3ArtifactStore:
    def __init__(self, config: ArtifactStorageConfig, repository: RunRepository) -> None:
        self.prefix = (config.prefix or "artifacts").strip("/")
        self.repository = repository
        self._driver = S3StorageDriver(
            bucket_name=config.s3.bucket_name,
            endpoint_url=config.s3.endpoint_url,
            access_key=config.s3.access_key,
            secret_key=config.s3.secret_key,
            region=config.s3.region,
        )

    def _object_key(self, run_id: str, task_id: str, artifact_id: str) -> str:
        return f"{self.prefix}/{run_id}/{task_id}/{artifact_id}/content"

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
        key = self._object_key(run_id, task_id, artifact_id)

        digest = hashlib.sha256()
        size = 0
        with source.open("rb") as input_stream:
            while chunk := input_stream.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)

        with source.open("rb") as input_stream:
            self._driver.write_file(key, input_stream)

        try:
            entity = self.repository.add_artifact(
                artifact_id=artifact_id,
                run_id=run_id,
                task_id=task_id,
                name=name,
                storage_path=key,
                size=size,
                sha256=digest.hexdigest(),
            )
        except Exception:
            self._driver.delete(key)
            raise
        return ArtifactRecord.model_validate(entity)

    def open(self, artifact: ArtifactRecord) -> BinaryIO:
        key = str(artifact.storage_path).replace("\\", "/").lstrip("/")
        if not key.startswith(f"{self.prefix}/"):
            raise ExecutionError("Stored artifact file is unavailable")
        stream, _, _ = self._driver.get_file_stream(key)
        return stream


# Re-exported so callers can keep a single import site for both backends.
__all__ = ["LocalArtifactStore", "S3ArtifactStore"]
