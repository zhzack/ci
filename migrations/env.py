"""Alembic environment: resolves the database URL from the YAML config.

Run with::

    alembic upgrade head

The URL comes from the same ``MINI_PIPELINE_CONFIG`` file the app uses, so
migrations and the application always target the same database.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from mini_pipeline.core.config import load_settings
from mini_pipeline.database.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    try:
        settings = load_settings()
    except Exception:
        # Fall back to the URL baked into alembic.ini when no app config
        # is reachable (e.g. CI running alembic in an isolated checkout).
        return config.get_main_option("sqlalchemy.url")
    url = settings.database.url
    if url.startswith("sqlite:///./"):
        # Make relative SQLite paths stable regardless of the invocation cwd.
        from pathlib import Path

        path = url.removeprefix("sqlite:///./")
        url = f"sqlite:///{(Path.cwd() / path).as_posix()}"
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
