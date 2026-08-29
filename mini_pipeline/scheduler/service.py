"""Run submission and status query application service."""

from datetime import datetime
from pathlib import Path
from typing import Any

from mini_pipeline.database.models import Artifact, PipelineRun, TaskRun
from mini_pipeline.database.repositories import RunRepository
from mini_pipeline.domain.exceptions import ConflictError, NotFoundError, ValidationError
from mini_pipeline.domain.states import (
    TERMINAL_RUN_STATUSES,
    PipelineStatus,
    TaskStatus,
)
from mini_pipeline.pipeline.dag import topological_order
from mini_pipeline.pipeline.service import PipelineService
from mini_pipeline.scheduler.engine import PipelineEngine


class RunService:
    def __init__(
        self,
        *,
        pipelines: PipelineService,
        repository: RunRepository,
        engine: PipelineEngine,
    ) -> None:
        self.pipelines = pipelines
        self.repository = repository
        self.engine = engine

    def submit(self, pipeline_identifier: str, params: dict[str, Any]) -> PipelineRun:
        entity, definition = self.pipelines.get_parsed(pipeline_identifier)
        return self.engine.submit(
            pipeline_id=entity.id,
            definition=definition,
            params=params,
        )

    def submit_with_uploads(
        self,
        pipeline_identifier: str,
        params: dict[str, Any],
        uploads: dict[str, Path],
    ) -> PipelineRun:
        entity, definition = self.pipelines.get_parsed(pipeline_identifier)
        return self.engine.submit(
            pipeline_id=entity.id,
            definition=definition,
            params=params,
            uploads=uploads,
        )

    def get(self, run_id: str) -> PipelineRun:
        return self.repository.get(run_id)

    def get_task(self, run_id: str, step_name: str) -> TaskRun:
        return self.repository.get_task(run_id, step_name)

    def read_log(self, run_id: str, step_name: str) -> str:
        task = self.get_task(run_id, step_name)
        if not task.log_path:
            return ""
        path = Path(task.log_path)
        if not path.is_file():
            return ""
        return path.read_text(encoding="utf-8", errors="replace")

    def read_aggregated_log(self, run_id: str) -> str:
        """Concatenate all task logs in chronological order, prefixed with step name."""
        run = self.repository.get(run_id)
        tasks = sorted(run.tasks, key=lambda t: (t.started_at or datetime.max, t.position))
        chunks: list[str] = []
        for task in tasks:
            if not task.log_path:
                continue
            path = Path(task.log_path)
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            ts = task.started_at.isoformat(timespec="milliseconds") if task.started_at else "?"
            chunks.append(f"--- [{ts}] step:{task.step_name} ({task.status}) ---")
            if content:
                chunks.append(content.rstrip("\n"))
            chunks.append("")
        return "\n".join(chunks).rstrip("\n")

    def get_artifact(self, artifact_id: str) -> Artifact:
        return self.repository.get_artifact(artifact_id)

    def list(
        self,
        *,
        offset: int = 0,
        limit: int = 50,
        status: str | None = None,
        pipeline_name: str | None = None,
    ) -> tuple[list[PipelineRun], int]:
        return (
            self.repository.list_runs(
                offset=offset,
                limit=limit,
                status=status,
                pipeline_name=pipeline_name,
            ),
            self.repository.count_runs(
                status=status, pipeline_name=pipeline_name
            ),
        )

    def cancel(self, run_id: str) -> PipelineRun:
        """Cancel a pending or running run.

        Running plugin processes are terminated through the engine's
        cancellation registry; queued steps are marked CANCELLED by the
        coordinator. Cancelling a terminal run is a conflict (409).
        """
        run = self.repository.get(run_id)
        if run.status in {s.value for s in TERMINAL_RUN_STATUSES}:
            raise ConflictError(
                f"Run {run_id!r} already finished (status={run.status})"
            )

        if run.status == PipelineStatus.PENDING.value:
            # The coordinator has not started (or has not flipped the state
            # yet); cancel everything optimistically. If the coordinator
            # starts afterwards it observes the CANCELLED status and stops.
            for task in run.tasks:
                if task.status not in {TaskStatus.SUCCESS.value, TaskStatus.FAILED.value}:
                    self.repository.set_task_state(
                        task.id,
                        TaskStatus.CANCELLED,
                        message="Cancelled before execution",
                        finished_at=datetime.utcnow(),
                    )
            self.repository.set_run_state(
                run_id,
                PipelineStatus.CANCELLED,
                message="Run cancelled before start",
                finished_at=datetime.utcnow(),
            )
            self.engine.cancellations.cancel(run_id)
            self.engine.events.publish_run_status(run_id, PipelineStatus.CANCELLED.value)
            return self.repository.get(run_id)

        # RUNNING: signal the running processes; the coordinator finalizes.
        self.engine.cancellations.cancel(run_id)
        return self.repository.get(run_id)

    def branch_from_step(
        self,
        parent_run_id: str,
        from_step: str,
        params: dict[str, Any],
    ) -> PipelineRun:
        """Create a new run that reuses the parent's outputs for steps before
        `from_step` (inclusive of the chain reaching it) and re-executes the
        sub-graph rooted at `from_step` with the new params.
        """
        parent = self.repository.get(parent_run_id)
        if parent.status not in {
            PipelineStatus.SUCCESS.value,
            PipelineStatus.FAILED.value,
        }:
            raise ValidationError(
                f"Parent run {parent_run_id!r} has not finished yet (status={parent.status})"
            )
        parent_entity, definition = self.pipelines.get_parsed(parent.pipeline_id)
        steps = {step.name: step for step in definition.steps}
        if from_step not in steps:
            raise NotFoundError(f"Step {from_step!r} not in pipeline {parent.pipeline_name!r}")
        # Reachable-from-from_step: BFS forward
        reachable: set[str] = set()
        queue = [from_step]
        while queue:
            current = queue.pop()
            if current in reachable:
                continue
            reachable.add(current)
            for step in definition.steps:
                if current in step.depends and step.name not in reachable:
                    queue.append(step.name)
        ordered = topological_order(definition)
        reusable = [name for name in ordered if name not in reachable]

        # Build merged params: pipeline defaults + parent run's params + new override
        merged_params: dict[str, Any] = dict(definition.params)
        for key, value in (parent.params or {}).items():
            if key in params:
                continue
            if key in reusable:
                continue
            merged_params[key] = value
        merged_params.update(params)

        ordered_task_specs = [(name, *steps[name].plugin_reference) for name in ordered]
        new_run = self.repository.create(
            pipeline_id=parent_entity.id,
            pipeline_name=parent_entity.name,
            params=merged_params,
            tasks=ordered_task_specs,
            parent_run_id=parent.id,
            branched_from_step=from_step,
        )

        # Reuse parent's task outputs for the upstream portion
        parent_tasks_by_name = {task.step_name: task for task in parent.tasks}
        for task in new_run.tasks:
            if task.step_name in reusable:
                source = parent_tasks_by_name.get(task.step_name)
                if source is None or source.status != TaskStatus.SUCCESS.value:
                    self.repository.set_task_state(
                        task.id,
                        TaskStatus.SKIPPED,
                        message="Parent run did not produce a successful result for this step",
                        finished_at=datetime.utcnow(),
                    )
                    continue
                self.repository.set_task_state(
                    task.id,
                    TaskStatus.SUCCESS,
                    message="Reused from parent run",
                    outputs=dict(source.outputs or {}),
                    log_path=source.log_path,
                    started_at=source.started_at,
                    finished_at=source.finished_at,
                )

        # Schedule the engine to actually run the from_step subgraph

        # Coordinates the live execution (downstream of from_step)
        self.engine.execute_subgraph(
            run_id=new_run.id,
            definition=definition,
            from_step=from_step,
            params=merged_params,
        )
        return new_run
