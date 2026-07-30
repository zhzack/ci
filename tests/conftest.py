"""Reusable fixtures for integration tests."""

import io
import zipfile
from pathlib import Path
from typing import Callable

import pytest
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


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        app=AppConfig(),
        database=DatabaseConfig(url=f"sqlite:///{tmp_path / 'pipeline.db'}"),
        storage=StorageConfig(
            root=tmp_path,
            plugins=tmp_path / "plugins",
            workspaces=tmp_path / "workspaces",
            logs=tmp_path / "logs",
            artifacts=tmp_path / "artifacts",
            temp=tmp_path / "tmp",
        ),
        execution=ExecutionConfig(
            coordinator_workers=2,
            task_workers=4,
            task_timeout_seconds=10,
        ),
        sources=SourceConfig(
            http_timeout_seconds=2,
            max_archive_bytes=1024 * 1024,
            max_extracted_bytes=2 * 1024 * 1024,
            max_archive_files=100,
        ),
    )


@pytest.fixture
def client(settings: Settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def plugin_zip() -> Callable[..., bytes]:
    def build(
        *,
        name: str = "hello",
        version: str = "1.0.0",
        script: str = '#!/bin/sh\necho ok\nprintf \'{"status":"success"}\' > output.json\n',
    ) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr(
                "plugin.yaml",
                f"""name: {name}
version: {version}
description: test plugin
runtime:
  type: shell
entry: run.sh
inputs: {{}}
outputs: {{}}
""",
            )
            info = zipfile.ZipInfo("run.sh")
            info.external_attr = 0o755 << 16
            archive.writestr(info, script)
        return output.getvalue()

    return build
