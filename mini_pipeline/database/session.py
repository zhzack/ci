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
        # For SQLite dev convenience: if the model defines a column that the
        # existing DB doesn't have, drop and recreate. In production this is a
        # no-op because the schema starts in sync.
        self._upgrade_schema()
        Base.metadata.create_all(self.engine)

    def _upgrade_schema(self) -> None:
        from sqlalchemy import inspect, text

        if not self.engine.url.drivername.startswith("sqlite"):
            return
        inspector = inspect(self.engine)
        existing = set(inspector.get_table_names())
        for table in Base.metadata.sorted_tables:
            if table.name not in existing:
                continue
            model_cols = {c.name: bool(c.nullable) for c in table.columns}
            db_cols = {
                c["name"]: bool(c.get("nullable", True))
                for c in inspector.get_columns(table.name)
            }
            needs_rebuild = False
            for name, nullable in model_cols.items():
                if name not in db_cols:
                    needs_rebuild = True
                    break
                if db_cols[name] != nullable:
                    needs_rebuild = True
                    break
            if not needs_rebuild:
                continue
            # Rebuild by dropping then recreating. The user has been told
            # that the DB is dev-only; data loss here is acceptable.
            Base.metadata.drop_all(self.engine, tables=[table])
            Base.metadata.create_all(self.engine, tables=[table])

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
