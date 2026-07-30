from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.core.config import (
    AppConfig,
    DatabaseConfig,
    ExecutionConfig,
    Settings,
    SourceConfig,
    StorageConfig,
)
from mini_pipeline.server.app import create_app


def build_settings(tmp_path: Path) -> Settings:
    return Settings(
        app=AppConfig(),
        database=DatabaseConfig(url=f"sqlite:///{tmp_path / 'test.db'}"),
        storage=StorageConfig(
            root=tmp_path,
            plugins=tmp_path / "plugins",
            workspaces=tmp_path / "workspaces",
            logs=tmp_path / "logs",
            artifacts=tmp_path / "artifacts",
            temp=tmp_path / "tmp",
        ),
        execution=ExecutionConfig(),
        sources=SourceConfig(),
    )


def test_health(tmp_path: Path) -> None:
    with TestClient(create_app(build_settings(tmp_path))) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
