from pathlib import Path

import pytest
from sqlalchemy import inspect

from mini_pipeline.core.config import load_settings
from mini_pipeline.database.session import Database
from mini_pipeline.domain.exceptions import ConfigurationError


def test_load_settings_resolves_paths(tmp_path: Path) -> None:
    config = tmp_path / "settings.yaml"
    config.write_text(
        """
app: {name: Test, host: 127.0.0.1, port: 9000, api_prefix: /api}
database: {url: 'sqlite:///:memory:', echo: false}
storage:
  root: data
  plugins: data/plugins
  workspaces: data/workspaces
  logs: data/logs
  artifacts: data/artifacts
  temp: data/tmp
execution: {coordinator_workers: 1, task_workers: 2, task_timeout_seconds: 10}
sources:
  http_timeout_seconds: 2
  max_archive_bytes: 100
  max_extracted_bytes: 200
  max_archive_files: 10
""",
        encoding="utf-8",
    )

    settings = load_settings(config, working_directory=tmp_path)

    assert settings.app.port == 9000
    assert settings.storage.plugins == (tmp_path / "data/plugins").resolve()


def test_missing_environment_variable_is_rejected(tmp_path: Path) -> None:
    config = tmp_path / "settings.yaml"
    config.write_text("database: {url: '${DOES_NOT_EXIST}'}", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="DOES_NOT_EXIST"):
        load_settings(config, working_directory=tmp_path)


def test_database_creates_schema(tmp_path: Path) -> None:
    from mini_pipeline.core.config import DatabaseConfig

    database = Database(DatabaseConfig(url="sqlite:///{}".format(tmp_path / "test.db")))
    database.create_schema()

    assert "pipeline_runs" in inspect(database.engine).get_table_names()
    assert (tmp_path / "test.db").exists()
    database.close()
