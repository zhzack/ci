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
        """Create any missing tables.

        Schema *evolution* is owned by Alembic (``alembic upgrade head``);
        this only bootstraps fresh databases so `pip install` + run works
        with zero setup. It never mutates or drops existing tables.
        """
        Base.metadata.create_all(self.engine)

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
