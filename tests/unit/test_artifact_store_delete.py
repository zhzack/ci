"""Retention GC support: ArtifactStore.delete removes stored content."""

from datetime import datetime
from pathlib import Path

import pytest

from mini_pipeline.artifact import s3 as s3_module
from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.artifact.s3 import S3ArtifactStore
from mini_pipeline.core.config import (
    ArtifactStorageConfig,
    S3PackageStorageConfig,
    StorageConfig,
)
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord


def _record(path: Path) -> ArtifactRecord:
    return ArtifactRecord(
        id="a1",
        run_id="r1",
        task_id="t1",
        name="out.bin",
        storage_path=path,
        size=1,
        sha256="x" * 64,
        created_at=datetime.utcnow(),
    )


class FakeS3Driver:
    def __init__(self, **kwargs: object) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def delete(self, key: str) -> bool:
        self.deleted.append(key)
        self.objects.pop(key, None)
        return True


def test_local_store_delete_removes_file_and_empty_parents(tmp_path: Path) -> None:
    storage = StorageConfig(
        root=tmp_path,
        plugins=tmp_path / "p",
        workspaces=tmp_path / "w",
        logs=tmp_path / "l",
        artifacts=tmp_path / "a",
        temp=tmp_path / "t",
    )
    store = LocalArtifactStore(storage, repository=None)  # type: ignore[arg-type]
    content = tmp_path / "a" / "r1" / "t1" / "aid" / "content"
    content.parent.mkdir(parents=True)
    content.write_bytes(b"data")

    store.delete(_record(content))

    assert not content.exists()
    # Empty parent chain pruned back to the storage root.
    assert not (tmp_path / "a" / "r1").exists()
    assert (tmp_path / "a").exists()  # root-level dir untouched


def test_local_store_delete_rejects_escape(tmp_path: Path) -> None:
    storage = StorageConfig(
        root=tmp_path / "root",
        plugins=tmp_path / "p",
        workspaces=tmp_path / "w",
        logs=tmp_path / "l",
        artifacts=tmp_path / "a",
        temp=tmp_path / "t",
    )
    store = LocalArtifactStore(storage, repository=None)  # type: ignore[arg-type]

    with pytest.raises(ExecutionError):
        store.delete(_record(tmp_path / "outside" / "content"))


def test_s3_store_deletes_object_under_prefix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    driver = FakeS3Driver()
    monkeypatch.setattr(s3_module, "S3StorageDriver", lambda **kw: driver)
    config = ArtifactStorageConfig(
        driver="s3",
        prefix="artifacts",
        s3=S3PackageStorageConfig(bucket_name="mini-pipeline"),
    )
    store = S3ArtifactStore(config, repository=None)  # type: ignore[arg-type]
    key = "artifacts/r1/t1/aid/content"
    driver.objects[key] = b"data"

    store.delete(_record(Path(key)))

    assert driver.deleted == [key]
    assert key not in driver.objects


def test_s3_store_delete_rejects_foreign_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    driver = FakeS3Driver()
    monkeypatch.setattr(s3_module, "S3StorageDriver", lambda **kw: driver)
    config = ArtifactStorageConfig(
        driver="s3",
        prefix="artifacts",
        s3=S3PackageStorageConfig(bucket_name="mini-pipeline"),
    )
    store = S3ArtifactStore(config, repository=None)  # type: ignore[arg-type]

    with pytest.raises(ExecutionError):
        store.delete(_record(Path("../../etc/passwd")))
    assert driver.deleted == []
