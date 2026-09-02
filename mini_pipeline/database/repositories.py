"""Persistence repositories. Each method owns its database session."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from mini_pipeline.database.models import (
    Artifact,
    PipelineDefinition,
    PipelineRun,
    Plugin,
    PluginVersion,
    TaskCacheRecord,
    TaskRun,
    utcnow,
)
from mini_pipeline.database.session import Database
from mini_pipeline.domain.exceptions import ConflictError, NotFoundError, ValidationError
from mini_pipeline.domain.states import PipelineStatus, TaskStatus


class PluginRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create_version(
        self,
        *,
        name: str,
        version: str,
        description: str,
        source_type: str,
        source_url: str | None,
        source_revision: str | None,
        install_path: str,
        runtime_type: str,
        entry: str,
        manifest: dict[str, Any],
        owner_id: str | None = None,
    ) -> PluginVersion:
        try:
            with self.database.session() as session:
                plugin = session.scalar(select(Plugin).where(Plugin.name == name))
                if plugin is None:
                    plugin = Plugin(
                        name=name,
                        description=description,
                        owner_id=owner_id,
                        # First version of a user plugin stays private until a
                        # store review approves it; platform plugins (owner
                        # NULL) are public by definition.
                        visibility="public" if owner_id is None else "private",
                    )
                    session.add(plugin)
                    session.flush()
                elif description and plugin.description != description:
                    plugin.description = description

                item = PluginVersion(
                    plugin_id=plugin.id,
                    name=name,
                    version=version,
                    description=description,
                    source_type=source_type,
                    source_url=source_url,
                    source_revision=source_revision,
                    install_path=install_path,
                    runtime_type=runtime_type,
                    entry=entry,
                    manifest=manifest,
                )
                session.add(item)
                session.flush()
                # Touch the relationship while still attached so the response
                # layer can read plugin.owner_id after expunge.
                _ = item.plugin
                session.expunge(item)
                return item
        except IntegrityError as exc:
            raise ConflictError(f"Plugin {name}@{version} already exists") from exc

    def get(self, plugin_id: str) -> Plugin:
        with self.database.session() as session:
            plugin = session.get(Plugin, plugin_id)
            if plugin is None:
                raise NotFoundError(f"Plugin {plugin_id!r} was not found")
            session.expunge(plugin)
            return plugin

    def list_plugins(self) -> list[Plugin]:
        with self.database.session() as session:
            rows = list(session.scalars(select(Plugin).order_by(Plugin.name)))
            for row in rows:
                session.expunge(row)
            return rows

    def get_version(self, name: str, version: str) -> PluginVersion:
        with self.database.session() as session:
            item = session.scalar(
                select(PluginVersion)
                .options(selectinload(PluginVersion.plugin))
                .where(
                    PluginVersion.name == name,
                    PluginVersion.version == version,
                )
            )
            if item is None:
                raise NotFoundError(f"Plugin {name}@{version} was not found")
            session.expunge(item)
            return item

    def version_exists(self, name: str, version: str) -> bool:
        with self.database.session() as session:
            return (
                session.scalar(
                    select(PluginVersion.id).where(
                        PluginVersion.name == name,
                        PluginVersion.version == version,
                    )
                )
                is not None
            )

    def list_versions(self) -> list[PluginVersion]:
        with self.database.session() as session:
            items = list(
                session.scalars(
                    select(PluginVersion)
                    .options(selectinload(PluginVersion.plugin))
                    .order_by(PluginVersion.name, PluginVersion.created_at)
                )
            )
            for item in items:
                session.expunge(item)
            return items

    def list_versions_paged(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        search: str | None = None,
    ) -> list[PluginVersion]:
        with self.database.session() as session:
            query = (
                select(PluginVersion)
                .options(selectinload(PluginVersion.plugin))
                .order_by(PluginVersion.name, PluginVersion.created_at)
            )
            if search:
                query = query.where(PluginVersion.name.contains(search))
            items = list(session.scalars(query.offset(offset).limit(limit)))
            for item in items:
                session.expunge(item)
            return items

    def count_versions(self, *, search: str | None = None) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            query = select(func.count(PluginVersion.id))
            if search:
                query = query.where(PluginVersion.name.contains(search))
            return int(session.scalar(query) or 0)

    def delete_version(self, name: str, version: str) -> None:
        with self.database.session() as session:
            item = session.scalar(
                select(PluginVersion).where(
                    PluginVersion.name == name,
                    PluginVersion.version == version,
                )
            )
            if item is not None:
                session.delete(item)


class PipelineRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self, *, name: str, definition: str, owner_id: str | None = None
    ) -> PipelineDefinition:
        try:
            with self.database.session() as session:
                pipeline = PipelineDefinition(
                    name=name, definition=definition, owner_id=owner_id
                )
                session.add(pipeline)
                session.flush()
                session.expunge(pipeline)
                return pipeline
        except IntegrityError as exc:
            raise ConflictError(f"Pipeline {name!r} already exists") from exc

    def get(self, identifier: str) -> PipelineDefinition:
        with self.database.session() as session:
            pipeline = session.scalar(
                select(PipelineDefinition).where(
                    (PipelineDefinition.id == identifier) | (PipelineDefinition.name == identifier)
                )
            )
            if pipeline is None:
                raise NotFoundError(f"Pipeline {identifier!r} was not found")
            session.expunge(pipeline)
            return pipeline

    def list(self) -> list[PipelineDefinition]:
        with self.database.session() as session:
            pipelines = list(
                session.scalars(select(PipelineDefinition).order_by(PipelineDefinition.name))
            )
            for pipeline in pipelines:
                session.expunge(pipeline)
            return pipelines

    def list_paged(self, *, offset: int = 0, limit: int = 50) -> list[PipelineDefinition]:
        with self.database.session() as session:
            items = list(
                session.scalars(
                    select(PipelineDefinition)
                    .order_by(PipelineDefinition.name)
                    .offset(offset)
                    .limit(limit)
                )
            )
            for pipeline in items:
                session.expunge(pipeline)
            return items

    def count_pipelines(self) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            return int(session.scalar(select(func.count(PipelineDefinition.id))) or 0)

    def update(self, identifier: str, *, definition: str) -> PipelineDefinition:
        with self.database.session() as session:
            pipeline = session.scalar(
                select(PipelineDefinition).where(
                    (PipelineDefinition.id == identifier)
                    | (PipelineDefinition.name == identifier)
                )
            )
            if pipeline is None:
                raise NotFoundError(f"Pipeline {identifier!r} was not found")
            pipeline.definition = definition
            session.flush()
            session.expunge(pipeline)
            return pipeline

    def delete(self, identifier: str) -> None:
        with self.database.session() as session:
            pipeline = session.scalar(
                select(PipelineDefinition).where(
                    (PipelineDefinition.id == identifier)
                    | (PipelineDefinition.name == identifier)
                )
            )
            if pipeline is None:
                raise NotFoundError(f"Pipeline {identifier!r} was not found")
            session.delete(pipeline)


class RunRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        pipeline_id: str,
        pipeline_name: str,
        params: dict[str, Any],
        tasks: Sequence[tuple[str, str, str]],
        uploads: dict[str, Any] | None = None,
        parent_run_id: str | None = None,
        branched_from_step: str | None = None,
        machine_id: str | None = None,
        task_machines: dict[str, str] | None = None,
        owner_id: str | None = None,
    ) -> PipelineRun:
        task_machines = task_machines or {}
        try:
            with self.database.session() as session:
                run = PipelineRun(
                    pipeline_id=pipeline_id,
                    pipeline_name=pipeline_name,
                    params=params,
                    uploads=uploads or {},
                    parent_run_id=parent_run_id,
                    branched_from_step=branched_from_step,
                    machine_id=machine_id,
                    owner_id=owner_id,
                )

                session.add(run)
                session.flush()
                for position, (step_name, plugin_name, plugin_version) in enumerate(tasks):
                    session.add(
                        TaskRun(
                            run_id=run.id,
                            step_name=step_name,
                            position=position,
                            plugin_name=plugin_name,
                            plugin_version=plugin_version,
                            machine_id=task_machines.get(step_name) or machine_id,
                        )
                    )
                session.flush()
                run_id = run.id
        except IntegrityError as exc:
            detail = (str(exc) + " " + str(getattr(exc, "orig", ""))).lower()
            if "foreign key" in detail:
                if "plugin" in detail:
                    raise ValidationError(
                        "Pipeline references plugin that is no longer registered"
                    ) from exc
                raise NotFoundError(
                    f"Pipeline {pipeline_id!r} was not found"
                ) from exc
            raise
        return self.get(run_id)

    def get_task_by_id(self, task_id: str) -> TaskRun:
        with self.database.session() as session:
            task = session.scalar(
                select(TaskRun)
                .options(selectinload(TaskRun.artifacts))
                .where(TaskRun.id == task_id)
            )
            if task is None:
                raise NotFoundError(f"Task run {task_id!r} was not found")
            session.expunge(task)
            return task

    def get(self, run_id: str) -> PipelineRun:
        with self.database.session() as session:
            run = session.scalar(
                select(PipelineRun)
                .options(selectinload(PipelineRun.tasks).selectinload(TaskRun.artifacts))
                .where(PipelineRun.id == run_id)
            )
            if run is None:
                raise NotFoundError(f"Pipeline run {run_id!r} was not found")
            session.expunge_all()
            return run

    def get_task(self, run_id: str, step_name: str) -> TaskRun:
        with self.database.session() as session:
            task = session.scalar(
                select(TaskRun)
                .options(selectinload(TaskRun.artifacts))
                .where(TaskRun.run_id == run_id, TaskRun.step_name == step_name)
            )
            if task is None:
                raise NotFoundError(f"Task {step_name!r} in run {run_id!r} was not found")
            session.expunge_all()
            return task

    def set_run_state(
        self,
        run_id: str,
        status: PipelineStatus,
        *,
        message: str | None = None,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
    ) -> None:
        with self.database.session() as session:
            run = session.get(PipelineRun, run_id)
            if run is None:
                raise NotFoundError(f"Pipeline run {run_id!r} was not found")
            run.status = status.value
            if message is not None:
                run.message = message
            if started_at is not None:
                run.started_at = started_at
            if finished_at is not None:
                run.finished_at = finished_at

    def update_uploads(self, run_id: str, uploads: dict[str, Any]) -> None:
        with self.database.session() as session:
            run = session.get(PipelineRun, run_id)
            if run is None:
                raise NotFoundError(f"Pipeline run {run_id!r} was not found")
            run.uploads = uploads


    def set_task_state(
        self,
        task_id: str,
        status: TaskStatus,
        *,
        message: str | None = None,
        outputs: dict[str, Any] | None = None,
        log_path: str | None = None,
        started_at: datetime | None = None,
        finished_at: datetime | None = None,
        attempt: int | None = None,
    ) -> None:
        with self.database.session() as session:
            task = session.get(TaskRun, task_id)
            if task is None:
                raise NotFoundError(f"Task run {task_id!r} was not found")
            task.status = status.value
            if message is not None:
                task.message = message
            if outputs is not None:
                task.outputs = outputs
            if log_path is not None:
                task.log_path = log_path
            if started_at is not None:
                task.started_at = started_at
            if finished_at is not None:
                task.finished_at = finished_at
            if attempt is not None:
                task.attempt = attempt

    def add_artifact(
        self,
        *,
        artifact_id: str,
        run_id: str,
        task_id: str,
        name: str,
        filename: str = "",
        storage_path: str,
        size: int,
        sha256: str,
    ) -> Artifact:
        with self.database.session() as session:
            artifact = Artifact(
                id=artifact_id,
                run_id=run_id,
                task_id=task_id,
                name=name,
                filename=filename or name,
                storage_path=storage_path,
                size=size,
                sha256=sha256,
            )
            session.add(artifact)
            session.flush()
            session.expunge(artifact)
            return artifact

    def get_artifact(self, artifact_id: str) -> Artifact:
        with self.database.session() as session:
            artifact = session.get(Artifact, artifact_id)
            if artifact is None:
                raise NotFoundError(f"Artifact {artifact_id!r} was not found")
            session.expunge(artifact)
            return artifact

    def delete_artifact(self, artifact_id: str) -> None:
        with self.database.session() as session:
            artifact = session.get(Artifact, artifact_id)
            if artifact is not None:
                session.delete(artifact)

    def list_artifacts(
        self, *, offset: int = 0, limit: int = 50, run_id: str | None = None
    ) -> list[Artifact]:
        with self.database.session() as session:
            query = (
                select(Artifact)
                .join(TaskRun, Artifact.task_id == TaskRun.id)
                .order_by(Artifact.created_at.desc())
            )
            if run_id:
                query = query.where(Artifact.run_id == run_id)
            rows = list(session.scalars(query.offset(offset).limit(limit)))
            for row in rows:
                session.expunge(row)
            return rows

    def count_artifacts(self, *, run_id: str | None = None) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            query = select(func.count(Artifact.id))
            if run_id:
                query = query.where(Artifact.run_id == run_id)
            return int(session.scalar(query) or 0)

    def count_active_runs(self) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            return int(
                session.scalar(
                    select(func.count(PipelineRun.id)).where(
                        PipelineRun.status.in_(
                            [PipelineStatus.PENDING.value, PipelineStatus.RUNNING.value]
                        )
                    )
                )
                or 0
            )

    def list_recent_runs(self, limit: int = 10) -> list[PipelineRun]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(PipelineRun)
                    .options(selectinload(PipelineRun.tasks).selectinload(TaskRun.artifacts))
                    .order_by(PipelineRun.created_at.desc())
                    .limit(limit)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def count_failed_tasks(self) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            return int(
                session.scalar(
                    select(func.count(TaskRun.id)).where(
                        TaskRun.status.in_(
                            [TaskStatus.FAILED.value, TaskStatus.SKIPPED.value]
                        )
                    )
                )
                or 0
            )

    def list_children(self, parent_run_id: str) -> list[PipelineRun]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(PipelineRun)
                    .where(PipelineRun.parent_run_id == parent_run_id)
                    .order_by(PipelineRun.created_at)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def list_runs(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        status: str | None = None,
        pipeline_name: str | None = None,
    ) -> list[PipelineRun]:
        with self.database.session() as session:
            query = (
                select(PipelineRun)
                .options(selectinload(PipelineRun.tasks).selectinload(TaskRun.artifacts))
                .order_by(PipelineRun.created_at.desc())
            )
            if status:
                query = query.where(PipelineRun.status == status)
            if pipeline_name:
                query = query.where(PipelineRun.pipeline_name == pipeline_name)
            rows = list(session.scalars(query.offset(offset).limit(limit)))
            for row in rows:
                session.expunge(row)
            return rows

    def count_runs(
        self,
        *,
        status: str | None = None,
        pipeline_name: str | None = None,
    ) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            query = select(func.count(PipelineRun.id))
            if status:
                query = query.where(PipelineRun.status == status)
            if pipeline_name:
                query = query.where(PipelineRun.pipeline_name == pipeline_name)
            return int(session.scalar(query) or 0)

    def reap_orphan_runs(self, *, message: str) -> int:
        """Fail every run still pending/running (crash recovery on startup).

        Returns the number of runs reaped.
        """
        from sqlalchemy import update

        active = [PipelineStatus.PENDING.value, PipelineStatus.RUNNING.value]
        unfinished_tasks = [
            TaskStatus.PENDING.value,
            TaskStatus.READY.value,
            TaskStatus.QUEUED.value,
            TaskStatus.RUNNING.value,
        ]
        with self.database.session() as session:
            run_ids = list(
                session.scalars(
                    select(PipelineRun.id).where(PipelineRun.status.in_(active))
                )
            )
            if not run_ids:
                return 0
            session.execute(
                update(TaskRun)
                .where(TaskRun.run_id.in_(run_ids), TaskRun.status.in_(unfinished_tasks))
                .values(status=TaskStatus.FAILED.value, message=message)
            )
            session.execute(
                update(PipelineRun)
                .where(PipelineRun.id.in_(run_ids))
                .values(status=PipelineStatus.FAILED.value, message=message)
            )
            return len(run_ids)

    def fail_expired_leases(self, *, cutoff: datetime, message: str) -> int:
        """Mark RUNNING remote tasks whose lease expired as FAILED.

        Returns the number of tasks reaped.
        """
        from sqlalchemy import update

        with self.database.session() as session:
            result = session.execute(
                update(TaskRun)
                .where(
                    TaskRun.status == TaskStatus.RUNNING.value,
                    TaskRun.machine_id.isnot(None),
                    TaskRun.lease_expires_at.isnot(None),
                    TaskRun.lease_expires_at < cutoff,
                )
                .values(
                    status=TaskStatus.FAILED.value,
                    message=message,
                    finished_at=utcnow(),
                )
            )
            return int(result.rowcount or 0)

    def claim_next_task(
        self, *, machine_id: str, lease_seconds: int
    ) -> TaskRun | None:
        """Atomically claim the oldest QUEUED task for this machine.

        Transitions QUEUED → RUNNING and sets the heartbeat lease. The
        status guard in the UPDATE makes concurrent claims safe.
        """
        from sqlalchemy import update

        with self.database.session() as session:
            task_id = session.scalar(
                select(TaskRun.id)
                .where(
                    TaskRun.machine_id == machine_id,
                    TaskRun.status == TaskStatus.QUEUED.value,
                )
                .order_by(TaskRun.position)
                .limit(1)
            )
            if task_id is None:
                return None
            result = session.execute(
                update(TaskRun)
                .where(
                    TaskRun.id == task_id,
                    TaskRun.status == TaskStatus.QUEUED.value,
                )
                .values(
                    status=TaskStatus.RUNNING.value,
                    started_at=utcnow(),
                    lease_expires_at=utcnow()
                    + timedelta(seconds=lease_seconds),
                )
            )
            if not result.rowcount:
                return None
        return self.get_task_by_id(task_id)


class TaskCacheRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def get(self, cache_key: str) -> TaskCacheRecord | None:
        with self.database.session() as session:
            record = session.scalar(
                select(TaskCacheRecord).where(TaskCacheRecord.cache_key == cache_key)
            )
            if record is None:
                return None
            return TaskCacheRecord(
                id=record.id,
                cache_key=record.cache_key,
                plugin_name=record.plugin_name,
                plugin_version=record.plugin_version,
                step_name=record.step_name,
                outputs=dict(record.outputs or {}),
                artifacts=list(record.artifacts or []),
                created_at=record.created_at,
            )

    def set(
        self,
        *,
        cache_key: str,
        plugin_name: str,
        plugin_version: str,
        step_name: str,
        outputs: dict[str, Any],
        artifacts: list[dict[str, Any]],
    ) -> TaskCacheRecord:
        with self.database.session() as session:
            record = session.scalar(
                select(TaskCacheRecord).where(TaskCacheRecord.cache_key == cache_key)
            )
            if record is None:
                record = TaskCacheRecord(
                    cache_key=cache_key,
                    plugin_name=plugin_name,
                    plugin_version=plugin_version,
                    step_name=step_name,
                    outputs=outputs,
                    artifacts=artifacts,
                )
                session.add(record)
            else:
                record.outputs = outputs
                record.artifacts = artifacts
                record.created_at = utcnow()
            session.commit()
            return TaskCacheRecord(
                id=record.id,
                cache_key=record.cache_key,
                plugin_name=record.plugin_name,
                plugin_version=record.plugin_version,
                step_name=record.step_name,
                outputs=dict(record.outputs or {}),
                artifacts=list(record.artifacts or []),
                created_at=record.created_at,
            )

    def count(self) -> int:
        from sqlalchemy import func

        with self.database.session() as session:
            return session.scalar(select(func.count(TaskCacheRecord.id))) or 0

