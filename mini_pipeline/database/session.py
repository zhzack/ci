"""Database engine and per-operation session management."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from mini_pipeline.core.config import DatabaseConfig
from mini_pipeline.database.models import Base


class Database:
    def __init__(self, config: DatabaseConfig) -> None:
        connect_args = {"check_same_thread": False} if config.url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(
            config.url,
            echo=config.echo,
            future=True,
            pool_pre_ping=True,
            connect_args=connect_args,
        )
        if config.url.startswith("sqlite"):
            event.listen(self.engine, "connect", self._enable_sqlite_foreign_keys)
        self._session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )

    @staticmethod
    def _enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    def create_schema(self) -> None:
        """Create any missing tables and ensure backward-compatible column migrations.

        This bootstraps fresh databases and safely patches new columns on existing
        databases so zero manual migrations are needed across upgrades.
        """
        Base.metadata.create_all(self.engine)
        self._ensure_compatible_columns()

    def _ensure_compatible_columns(self) -> None:
        """Ensure newly added model columns exist in already initialized databases."""
        try:
            with self.engine.begin() as conn:
                is_pg = self.engine.dialect.name == "postgresql"
                is_sqlite = self.engine.dialect.name == "sqlite"

                if is_pg:
                    conn.exec_driver_sql(
                        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
                        "must_change_password BOOLEAN NOT NULL DEFAULT FALSE;"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE credentials ADD COLUMN IF NOT EXISTS "
                        "domain_patterns JSON NOT NULL DEFAULT '[]';"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS "
                        "uploads JSON NOT NULL DEFAULT '{}';"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS "
                        "parent_run_id VARCHAR(36);"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS "
                        "branched_from_step VARCHAR(128);"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS "
                        "filename VARCHAR(255) NOT NULL DEFAULT '';"
                    )
                    conn.exec_driver_sql(
                        "ALTER TABLE artifacts ALTER COLUMN size TYPE BIGINT;"
                    )
                elif is_sqlite:
                    cursor = conn.connection.cursor()
                    try:
                        cursor.execute("SELECT email FROM users LIMIT 1")
                    except Exception:
                        cursor.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
                    try:
                        cursor.execute("SELECT must_change_password FROM users LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE users ADD COLUMN must_change_password "
                            "BOOLEAN NOT NULL DEFAULT 0"
                        )
                    try:
                        cursor.execute("SELECT domain_patterns FROM credentials LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE credentials ADD COLUMN domain_patterns "
                            "JSON NOT NULL DEFAULT '[]'"
                        )
                    try:
                        cursor.execute("SELECT uploads FROM pipeline_runs LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE pipeline_runs ADD COLUMN uploads "
                            "JSON NOT NULL DEFAULT '{}'"
                        )
                    try:
                        cursor.execute("SELECT parent_run_id FROM pipeline_runs LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE pipeline_runs ADD COLUMN parent_run_id VARCHAR(36)"
                        )
                    try:
                        cursor.execute("SELECT secret_values FROM pipeline_runs LIMIT 1")
                    except Exception:
                        if is_pg:
                            cursor.execute(
                                "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS "
                                "secret_values JSON NOT NULL DEFAULT '{}';"
                            )
                        else:
                            cursor.execute(
                                "ALTER TABLE pipeline_runs ADD COLUMN secret_values JSON "
                                "NOT NULL DEFAULT '{}'"
                            )
                    try:
                        cursor.execute("SELECT branched_from_step FROM pipeline_runs LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE pipeline_runs ADD COLUMN branched_from_step VARCHAR(128)"
                        )
                    try:
                        cursor.execute("SELECT filename FROM artifacts LIMIT 1")
                    except Exception:
                        cursor.execute(
                            "ALTER TABLE artifacts ADD COLUMN filename "
                            "VARCHAR(255) NOT NULL DEFAULT ''"
                        )
                    cursor.close()
        except Exception:
            pass

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def close(self) -> None:
        self.engine.dispose()
