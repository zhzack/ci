"""Repositories for Runtime Environments and Remote Deployment Tasks."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, desc, select, update
from sqlalchemy.orm import selectinload

from mini_pipeline.database.models import EnvironmentDeployTask, RuntimeEnvironment
from mini_pipeline.database.session import Database
from mini_pipeline.domain.exceptions import ConflictError, NotFoundError


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EnvironmentRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        name: str,
        env_type: str = "python",
        version: str,
        os_arch: str = "linux-x86_64",
        package_path: str | None = None,
        download_url: str | None = None,
        description: str = "",
        is_default: bool = False,
    ) -> RuntimeEnvironment:
        with self.database.session() as session:
            existing = session.scalar(
                select(RuntimeEnvironment).where(RuntimeEnvironment.name == name)
            )
            if existing:
                raise ConflictError(f"Runtime environment with name {name!r} already exists")

            if is_default:
                # Unset previous defaults with same env_type and os_arch
                session.execute(
                    update(RuntimeEnvironment)
                    .where(
                        RuntimeEnvironment.env_type == env_type,
                        RuntimeEnvironment.os_arch == os_arch,
                    )
                    .values(is_default=False)
                )

            env = RuntimeEnvironment(
                name=name,
                env_type=env_type,
                version=version,
                os_arch=os_arch,
                package_path=package_path,
                download_url=download_url,
                description=description,
                is_default=is_default,
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            session.add(env)
            session.flush()
            session.expunge(env)
            return env

    def get(self, env_id: str) -> RuntimeEnvironment:
        with self.database.session() as session:
            env = session.scalar(
                select(RuntimeEnvironment).where(RuntimeEnvironment.id == env_id)
            )
            if not env:
                raise NotFoundError(f"Runtime environment {env_id!r} not found")
            session.expunge(env)
            return env

    def get_by_name(self, name: str) -> RuntimeEnvironment | None:
        with self.database.session() as session:
            env = session.scalar(
                select(RuntimeEnvironment).where(RuntimeEnvironment.name == name)
            )
            if env:
                session.expunge(env)
            return env

    def get_default(
        self, env_type: str = "python", os_arch: str = "linux-x86_64"
    ) -> RuntimeEnvironment | None:
        with self.database.session() as session:
            env = session.scalar(
                select(RuntimeEnvironment).where(
                    RuntimeEnvironment.env_type == env_type,
                    RuntimeEnvironment.os_arch == os_arch,
                    RuntimeEnvironment.is_default.is_(True),
                )
            )
            if not env:
                env = session.scalar(
                    select(RuntimeEnvironment)
                    .where(
                        RuntimeEnvironment.env_type == env_type,
                        RuntimeEnvironment.os_arch == os_arch,
                    )
                    .order_by(desc(RuntimeEnvironment.created_at))
                )
            if env:
                session.expunge(env)
            return env

    def list(self) -> list[RuntimeEnvironment]:
        with self.database.session() as session:
            items = list(
                session.scalars(
                    select(RuntimeEnvironment).order_by(
                        desc(RuntimeEnvironment.is_default),
                        RuntimeEnvironment.name,
                    )
                )
            )
            for item in items:
                session.expunge(item)
            return items

    def update(self, env_id: str, **kwargs: Any) -> RuntimeEnvironment:
        with self.database.session() as session:
            env = session.scalar(
                select(RuntimeEnvironment).where(RuntimeEnvironment.id == env_id)
            )
            if not env:
                raise NotFoundError(f"Runtime environment {env_id!r} not found")

            if kwargs.get("is_default"):
                env_type = kwargs.get("env_type", env.env_type)
                os_arch = kwargs.get("os_arch", env.os_arch)
                session.execute(
                    update(RuntimeEnvironment)
                    .where(
                        RuntimeEnvironment.id != env_id,
                        RuntimeEnvironment.env_type == env_type,
                        RuntimeEnvironment.os_arch == os_arch,
                    )
                    .values(is_default=False)
                )

            for k, v in kwargs.items():
                if v is not None and hasattr(env, k):
                    setattr(env, k, v)
            env.updated_at = _utcnow()
            session.flush()
            session.expunge(env)
            return env

    def delete(self, env_id: str) -> None:
        with self.database.session() as session:
            session.execute(
                delete(RuntimeEnvironment).where(RuntimeEnvironment.id == env_id)
            )

    def seed_defaults(self) -> None:
        """Seed default recommended runtime environments if empty."""
        with self.database.session() as session:
            count = session.scalar(select(RuntimeEnvironment.id).limit(1))
            if count:
                return

        presets = [
            {
                "name": "python-3.10-standalone",
                "env_type": "python",
                "version": "3.10.14",
                "os_arch": "linux-x86_64",
                "package_path": "environments/python-3.10.14-linux-x86_64.tar.gz",
                "description": "Python 3.10 跨平台独立绿色版运行时，开箱即用",
                "is_default": True,
            },
            {
                "name": "python-3.11-standalone",
                "env_type": "python",
                "version": "3.11.9",
                "os_arch": "linux-x86_64",
                "package_path": "environments/python-3.11.9-linux-x86_64.tar.gz",
                "description": "Python 3.11 高性能运行时",
                "is_default": False,
            },
            {
                "name": "node-20-lts",
                "env_type": "node",
                "version": "20.12.2",
                "os_arch": "linux-x86_64",
                "package_path": "environments/node-v20.12.2-linux-x64.tar.gz",
                "description": "Node.js 20 LTS JavaScript/TypeScript 运行时",
                "is_default": True,
            },
        ]
        for p in presets:
            try:
                self.create(**p)
            except Exception:
                pass


class EnvironmentDeployTaskRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        environment_id: str,
        machine_id: str,
        triggered_by: str | None = None,
    ) -> EnvironmentDeployTask:
        with self.database.session() as session:
            task = EnvironmentDeployTask(
                environment_id=environment_id,
                machine_id=machine_id,
                status="pending",
                progress=0,
                message="部署任务已创建，等待调度",
                logs=f"[{_utcnow().isoformat()}] 部署任务初始化完成\n",
                triggered_by=triggered_by,
                created_at=_utcnow(),
            )
            session.add(task)
            session.flush()
            task = session.scalar(
                select(EnvironmentDeployTask)
                .options(
                    selectinload(EnvironmentDeployTask.environment),
                    selectinload(EnvironmentDeployTask.machine),
                )
                .where(EnvironmentDeployTask.id == task.id)
            )
            session.expunge(task)
            return task

    def get(self, task_id: str) -> EnvironmentDeployTask:
        with self.database.session() as session:
            task = session.scalar(
                select(EnvironmentDeployTask)
                .options(
                    selectinload(EnvironmentDeployTask.environment),
                    selectinload(EnvironmentDeployTask.machine),
                )
                .where(EnvironmentDeployTask.id == task_id)
            )
            if not task:
                raise NotFoundError(f"Deploy task {task_id!r} not found")
            session.expunge(task)
            return task

    def update_progress(
        self,
        task_id: str,
        *,
        status: str,
        progress: int,
        message: str,
        append_log: str = "",
        is_finished: bool = False,
    ) -> EnvironmentDeployTask:
        with self.database.session() as session:
            task = session.scalar(
                select(EnvironmentDeployTask)
                .options(
                    selectinload(EnvironmentDeployTask.environment),
                    selectinload(EnvironmentDeployTask.machine),
                )
                .where(EnvironmentDeployTask.id == task_id)
            )
            if not task:
                raise NotFoundError(f"Deploy task {task_id!r} not found")

            task.status = status
            task.progress = min(100, max(0, progress))
            task.message = message
            if append_log:
                timestamp = _utcnow().strftime("%H:%M:%S")
                task.logs += f"[{timestamp}] {append_log}\n"
            if is_finished:
                task.finished_at = _utcnow()
            session.flush()
            session.expunge(task)
            return task

    def list_recent(self, limit: int = 50) -> list[EnvironmentDeployTask]:
        with self.database.session() as session:
            tasks = list(
                session.scalars(
                    select(EnvironmentDeployTask)
                    .options(
                        selectinload(EnvironmentDeployTask.environment),
                        selectinload(EnvironmentDeployTask.machine),
                    )
                    .order_by(desc(EnvironmentDeployTask.created_at))
                    .limit(limit)
                )
            )
            for t in tasks:
                session.expunge(t)
            return tasks

    def list_by_environment(self, environment_id: str) -> list[EnvironmentDeployTask]:
        with self.database.session() as session:
            tasks = list(
                session.scalars(
                    select(EnvironmentDeployTask)
                    .options(
                        selectinload(EnvironmentDeployTask.environment),
                        selectinload(EnvironmentDeployTask.machine),
                    )
                    .where(EnvironmentDeployTask.environment_id == environment_id)
                    .order_by(desc(EnvironmentDeployTask.created_at))
                )
            )
            for t in tasks:
                session.expunge(t)
            return tasks
