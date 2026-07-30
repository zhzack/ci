"""Persistence repositories. Each method owns its database session."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from mini_pipeline.database.models import (
    Artifact,
    PipelineDefinition,
    PipelineRun,
    Plugin,
    PluginVersion,
    RunNode,
    TaskRun,
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
        source_url: Optional[str],
        source_revision: Optional[str],
        install_path: str,
        runtime_type: str,
        entry: str,
        manifest: dict[str, Any],
    ) -> PluginVersion:
        try:
            with self.database.session() as session:
                plugin = session.scalar(select(Plugin).where(Plugin.name == name))
                if plugin is None:
                    plugin = Plugin(name=name, description=description)
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
                session.expunge(item)
                return item
        except IntegrityError as exc:
            raise ConflictError(f"Plugin {name}@{version} already exists") from exc

    def get_version(self, name: str, version: str) -> PluginVersion:
        with self.database.session() as session:
            item = session.scalar(
                select(PluginVersion).where(
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
                    select(PluginVersion).order_by(PluginVersion.name, PluginVersion.created_at)
                )
            )
            for item in items:
                session.expunge(item)
            return items

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

    def create(self, *, name: str, definition: str) -> PipelineDefinition:
        try:
            with self.database.session() as session:
                pipeline = PipelineDefinition(name=name, definition=definition)
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
        parent_run_id: Optional[str] = None,
        branched_from_step: Optional[str] = None,
    ) -> PipelineRun:
        try:
            with self.database.session() as session:
                run = PipelineRun(
                    pipeline_id=pipeline_id,
                    pipeline_name=pipeline_name,
                    params=params,
                    parent_run_id=parent_run_id,
                    branched_from_step=branched_from_step,
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
        message: Optional[str] = None,
        started_at: Optional[datetime] = None,
        finished_at: Optional[datetime] = None,
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

    def set_task_state(
        self,
        task_id: str,
        status: TaskStatus,
        *,
        message: Optional[str] = None,
        outputs: Optional[dict[str, Any]] = None,
        log_path: Optional[str] = None,
        started_at: Optional[datetime] = None,
        finished_at: Optional[datetime] = None,
        node_id: Optional[str] = None,
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
            if node_id is not None:
                task.node_id = node_id

    def add_artifact(
        self,
        *,
        artifact_id: str,
        run_id: str,
        task_id: str,
        name: str,
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

    def list_artifacts(self) -> list[Artifact]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(Artifact)
                    .join(TaskRun, Artifact.task_id == TaskRun.id)
                    .order_by(Artifact.created_at.desc())
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

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


class RunNodeRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def find_by_hash(self, hash_value: str) -> Optional[RunNode]:
        with self.database.session() as session:
            node = session.scalar(select(RunNode).where(RunNode.hash == hash_value))
            if node is None:
                return None
            session.expunge(node)
            return node

    def create(
        self,
        *,
        pipeline_definition_id: str,
        step_name: str,
        plugin_name: str,
        plugin_version: str,
        hash_value: str,
        resolved_params: dict[str, Any],
        inputs_snapshot: dict[str, Any],
    ) -> RunNode:
        with self.database.session() as session:
            node = RunNode(
                pipeline_definition_id=pipeline_definition_id,
                step_name=step_name,
                plugin_name=plugin_name,
                plugin_version=plugin_version,
                hash=hash_value,
                resolved_params=resolved_params,
                inputs_snapshot=inputs_snapshot,
                outputs={},
                status=TaskStatus.READY.value,
            )
            session.add(node)
            session.flush()
            session.expunge(node)
            return node

    def update_result(
        self,
        node_id: str,
        *,
        outputs: dict[str, Any],
        log_path: Optional[str],
        status: str,
        message: Optional[str],
        started_at: Optional[datetime],
        finished_at: Optional[datetime],
    ) -> None:
        with self.database.session() as session:
            node = session.get(RunNode, node_id)
            if node is None:
                return
            node.outputs = outputs
            node.log_path = log_path
            node.status = status
            node.message = message
            node.started_at = started_at
            node.finished_at = finished_at

    def get(self, node_id: str) -> RunNode:
        with self.database.session() as session:
            node = session.get(RunNode, node_id)
            if node is None:
                raise NotFoundError(f"Run node {node_id!r} was not found")
            session.expunge(node)
            return node
