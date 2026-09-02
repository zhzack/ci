"""Run submission and status query application service."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from mini_pipeline.account.service import Principal
from mini_pipeline.database.models import Artifact, PipelineRun, TaskRun, utcnow
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
        permissions=None,
        machine_repository=None,
        plugin_repository=None,
    ) -> None:
        self.pipelines = pipelines
        self.repository = repository
        self.engine = engine
        self.permissions = permissions
        self.machine_repository = machine_repository
        self.plugin_repository = plugin_repository

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------

    def _resolve_machine_id(
        self, principal: Principal | None, machine_ref: str | None
    ) -> Optional[str]:
        """Resolve a run-level / step-level machine reference and enforce
        submit permission. ``None`` = built-in local runner."""
        if machine_ref is None:
            return None
        if self.machine_repository is None:
            raise ValidationError("Machines are not configured on this deployment")
        machine = self._lookup_machine(machine_ref)
        if self.permissions is None or principal is None:
            return machine.id
        self.machine_require_use(principal, machine)
        return machine.id

    def _lookup_machine(self, machine_ref: str):
        for machine in self.machine_repository.list():
            if machine.id == machine_ref or machine.name == machine_ref:
                if machine.status == "revoked":
                    raise ValidationError(
                        f"指定的计算节点 '{machine.name}' 已被删除或不可用，请重新选择执行节点。"
                    )
                return machine
        raise ValidationError(
            f"指定的计算节点 '{machine_ref}' 不存在或已被删除，请重新选择执行节点。"
        )

    def machine_require_use(self, principal: Principal, machine) -> None:
        if self.permissions is None:
            return
        if not self.permissions.machines_can_use(principal, machine):
            from mini_pipeline.domain.exceptions import PermissionDeniedError

            raise PermissionDeniedError(
                f"No permission to run tasks on machine {machine.name!r}"
            )

    def _ensure_can_run_pipeline(
        self, principal: Principal | None, entity
    ) -> None:
        """Only the owner, admins, or operator grantees may run a pipeline."""
        if principal is None or self.permissions is None:
            return
        from mini_pipeline.domain.exceptions import PermissionDeniedError

        if self.permissions.can_manage_resource(
            principal,
            resource_type="pipeline",
            resource_id=entity.id,
            owner_id=entity.owner_id,
        ):
            return
        if self.permissions.has_grant(
            principal,
            resource_type="pipeline",
            resource_id=entity.id,
            permission="operator",
        ):
            return
        raise PermissionDeniedError(
            f"No permission to run pipeline {entity.name!r}"
        )

    def _check_plugins_usable(
        self, principal: Principal | None, definition, entity=None
    ) -> None:
        """Every referenced plugin must be usable by the submitter.

        Running an authorized pipeline implicitly authorizes the plugins it
        wires: otherwise sharing a pipeline would be pointless unless every
        referenced plugin were shared separately.
        """
        if principal is None or self.plugin_repository is None:
            return
        if self.permissions is None:
            return
        if entity is not None and not self.permissions.can_manage_resource(
            principal,
            resource_type="pipeline",
            resource_id=entity.id,
            owner_id=entity.owner_id,
        ):
            # The pipeline is shared to this user; its plugin references are
            # covered by that grant.
            return
        from mini_pipeline.domain.exceptions import PermissionDeniedError

        seen = set()
        for step in definition.steps:
            ref = step.plugin_reference
            if ref in seen:
                continue
            seen.add(ref)
            version = self.plugin_repository.get_version(*ref)
            if not self.permissions.plugins_can_use(principal, version):
                raise PermissionDeniedError(
                    f"No permission to use plugin {ref[0]}@{ref[1]}"
                )

    def _task_machines(
        self, principal: Principal | None, definition, run_machine_id: Optional[str]
    ) -> Optional[dict[str, str]]:
        mapping: dict[str, str] = {}
        for step in definition.steps:
            ref = step.machine
            if ref is None:
                continue
            mapping[step.name] = self._resolve_machine_id(principal, ref)
        return mapping or None

    def submit(
        self,
        pipeline_identifier: str,
        params: dict[str, Any],
        *,
        principal: Principal | None = None,
        machine: str | None = None,
        parent_run_id: str | None = None,
        reuse_uploads: bool = True,
    ) -> PipelineRun:
        entity, definition = self.pipelines.get_parsed(pipeline_identifier)
        self._ensure_can_run_pipeline(principal, entity)
        self._check_plugins_usable(principal, definition, entity)
        machine_id = self._resolve_machine_id(principal, machine)

        inherited_uploads: dict[str, Path] = {}
        if parent_run_id and reuse_uploads:
            try:
                parent = self.repository.get(parent_run_id)
                for ukey, uinfo in (parent.uploads or {}).items():
                    upath_str = uinfo.get("path") if isinstance(uinfo, dict) else str(uinfo)
                    if upath_str:
                        upath = Path(upath_str)
                        if upath.exists():
                            inherited_uploads[ukey] = upath
            except Exception:
                pass

        return self.engine.submit(
            pipeline_id=entity.id,
            definition=definition,
            params=params,
            uploads=inherited_uploads or None,
            machine_id=machine_id,
            task_machines=self._task_machines(principal, definition, machine_id),
            owner_id=principal.user_id if principal else None,
        )

    def submit_with_uploads(
        self,
        pipeline_identifier: str,
        params: dict[str, Any],
        uploads: dict[str, Path],
        *,
        principal: Principal | None = None,
        machine: str | None = None,
        parent_run_id: str | None = None,
        reuse_uploads: bool = True,
    ) -> PipelineRun:
        entity, definition = self.pipelines.get_parsed(pipeline_identifier)
        self._ensure_can_run_pipeline(principal, entity)
        self._check_plugins_usable(principal, definition, entity)
        machine_id = self._resolve_machine_id(principal, machine)

        final_uploads: dict[str, Path] = dict(uploads or {})
        if parent_run_id and reuse_uploads:
            try:
                parent = self.repository.get(parent_run_id)
                for ukey, uinfo in (parent.uploads or {}).items():
                    if ukey not in final_uploads:
                        upath_str = uinfo.get("path") if isinstance(uinfo, dict) else str(uinfo)
                        if upath_str:
                            upath = Path(upath_str)
                            if upath.exists():
                                final_uploads[ukey] = upath
            except Exception:
                pass

        return self.engine.submit(
            pipeline_id=entity.id,
            definition=definition,
            params=params,
            uploads=final_uploads or None,
            machine_id=machine_id,
            task_machines=self._task_machines(principal, definition, machine_id),
            owner_id=principal.user_id if principal else None,
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
                        finished_at=utcnow(),
                    )
            self.repository.set_run_state(
                run_id,
                PipelineStatus.CANCELLED,
                message="Run cancelled before start",
                finished_at=utcnow(),
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
        *,
        reuse_uploads: bool = True,
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

        if parent.machine_id:
            try:
                self._lookup_machine(parent.machine_id)
            except ValidationError as exc:
                raise ValidationError(
                    f"原流水线使用的计算节点已被删除（{exc}），请重新选择可用节点发起新运行。"
                ) from exc

        parent_uploads: dict[str, Path] = {}
        if reuse_uploads and parent.uploads:
            for ukey, uinfo in parent.uploads.items():
                upath_str = uinfo.get("path") if isinstance(uinfo, dict) else str(uinfo)
                if upath_str:
                    upath = Path(upath_str)
                    if upath.exists():
                        parent_uploads[ukey] = upath

        ordered_task_specs = [(name, *steps[name].plugin_reference) for name in ordered]
        new_run = self.repository.create(
            pipeline_id=parent_entity.id,
            pipeline_name=parent_entity.name,
            params=merged_params,
            tasks=ordered_task_specs,
            uploads=parent.uploads if reuse_uploads else {},
            parent_run_id=parent.id,
            branched_from_step=from_step,
            machine_id=parent.machine_id,
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
                        finished_at=utcnow(),
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

        # Coordinates the live execution (downstream of from_step)
        self.engine.execute_subgraph(
            run_id=new_run.id,
            definition=definition,
            from_step=from_step,
            params=merged_params,
            uploads=parent_uploads or None,
        )
        return new_run

