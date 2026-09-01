import hashlib
import io
from pathlib import Path
from types import SimpleNamespace

import pytest

from mini_pipeline.artifact import s3 as s3_module
from mini_pipeline.artifact.s3 import S3ArtifactStore
from mini_pipeline.core.config import ArtifactStorageConfig, S3PackageStorageConfig
from mini_pipeline.database.models import utcnow
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord


class FakeS3Driver:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.fail_delete = False

    def write_file(self, key: str, stream: io.BufferedIOBase) -> None:
        self.objects[key] = stream.read()

    def get_file_stream(self, key: str) -> tuple[io.BytesIO, str, int]:
        if key not in self.objects:
            raise KeyError(key)
        data = self.objects[key]
        return io.BytesIO(data), "application/octet-stream", len(data)

    def delete(self, key: str) -> bool:
        if self.fail_delete:
            raise RuntimeError("s3 unavailable")
        self.deleted.append(key)
        self.objects.pop(key, None)
        return True


class FakeRepository:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.added: list[dict] = []

    def add_artifact(self, **kwargs: object) -> SimpleNamespace:
        if self.fail:
            raise RuntimeError("database write failed")
        self.added.append(kwargs)
        return SimpleNamespace(
            id=kwargs["artifact_id"],
            run_id=kwargs["run_id"],
            task_id=kwargs["task_id"],
            name=kwargs["name"],
            storage_path=kwargs["storage_path"],
            size=kwargs["size"],
            sha256=kwargs["sha256"],
            created_at=utcnow(),
        )


@pytest.fixture()
def fake_driver(monkeypatch: pytest.MonkeyPatch) -> FakeS3Driver:
    driver = FakeS3Driver()
    monkeypatch.setattr(s3_module, "S3StorageDriver", lambda **kw: driver)
    return driver


def _config() -> ArtifactStorageConfig:
    return ArtifactStorageConfig(
        driver="s3",
        prefix="artifacts",
        s3=S3PackageStorageConfig(
            bucket_name="mini-pipeline",
            endpoint_url="http://localhost:9000",
            access_key="ak",
            secret_key="sk",
            region="us-east-1",
        ),
    )


def _store(tmp_path: Path, repo: FakeRepository, driver: FakeS3Driver) -> S3ArtifactStore:
    _ = driver
    return S3ArtifactStore(_config(), repo)  # type: ignore[arg-type]


def test_s3_store_uploads_and_records_artifact(
    tmp_path: Path, fake_driver: FakeS3Driver
) -> None:
    repo = FakeRepository()
    store = _store(tmp_path, repo, fake_driver)
    source = tmp_path / "build.tar.gz"
    payload = b"artifact payload"
    source.write_bytes(payload)

    record = store.store(run_id="run-1", task_id="task-1", name="build.tar.gz", source=source)

    assert isinstance(record, ArtifactRecord)
    key = f"artifacts/run-1/task-1/{record.id}/content"
    assert fake_driver.objects[key] == payload
    assert record.storage_path == Path(key)
    assert record.size == len(payload)
    assert record.sha256 == hashlib.sha256(payload).hexdigest()
    assert repo.added[0]["storage_path"] == key


def test_s3_store_rejects_directory(tmp_path: Path, fake_driver: FakeS3Driver) -> None:
    repo = FakeRepository()
    store = _store(tmp_path, repo, fake_driver)
    source = tmp_path / "dir"
    source.mkdir()

    with pytest.raises(ExecutionError):
        store.store(run_id="run-1", task_id="task-1", name="x", source=source)
    assert fake_driver.objects == {}


def test_s3_store_cleans_object_when_db_write_fails(
    tmp_path: Path, fake_driver: FakeS3Driver
) -> None:
    repo = FakeRepository(fail=True)
    store = _store(tmp_path, repo, fake_driver)
    source = tmp_path / "file.bin"
    source.write_bytes(b"data")

    with pytest.raises(RuntimeError, match="database write failed"):
        store.store(run_id="run-1", task_id="task-1", name="file.bin", source=source)

    assert fake_driver.objects == {}
    assert len(fake_driver.deleted) == 1
    assert fake_driver.deleted[0].startswith("artifacts/run-1/task-1/")


def test_s3_open_returns_stream_for_known_key(
    tmp_path: Path, fake_driver: FakeS3Driver
) -> None:
    repo = FakeRepository()
    store = _store(tmp_path, repo, fake_driver)
    source = tmp_path / "file.bin"
    source.write_bytes(b"hello world")
    record = store.store(run_id="r", task_id="t", name="file.bin", source=source)

    stream = store.open(record)

    assert stream.read() == b"hello world"


def test_s3_open_rejects_foreign_keys(
    tmp_path: Path, fake_driver: FakeS3Driver
) -> None:
    repo = FakeRepository()
    store = _store(tmp_path, repo, fake_driver)
    _ = repo
    foreign = ArtifactRecord(
        id="a1",
        run_id="r",
        task_id="t",
        name="evil",
        storage_path=Path("../../etc/passwd"),
        size=3,
        sha256="x" * 64,
        created_at=utcnow(),
    )

    with pytest.raises(ExecutionError, match="unavailable"):
        store.open(foreign)
