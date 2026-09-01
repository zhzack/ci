"""Asynchronous in-process DAG pipeline engine.

The coordinator advances the DAG, schedules task executions on the
dispatcher's task pool, and finalizes run/task states. It also:

* supports **run cancellation** — a per-run ``threading.Event`` is checked
  by the runtime so plugin processes get terminated;
* applies **automatic retries** declared per step (``retries: n``) with
  exponential backoff;
* publishes state changes to the :class:`EventBus` for SSE consumers.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, wait
from pathlib import Path
from typing import Any

from mini_pipeline.core.events import CancellationRegistry, EventBus, RunEvent
from mini_pipeline.database.models import PipelineRun, TaskRun, utcnow
from mini_pipeline.database.repositories import PluginRepository, RunRepository, TaskCacheRepository
from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.domain.states import PipelineStatus, TaskStatus
from mini_pipeline.executor.dependencies import DependencyResult
from mini_pipeline.executor.task_executor import TaskExecutionResult, TaskExecutor
from mini_pipeline.pipeline.dag import topological_order
from mini_pipeline.pipeline.resolver import resolve_parameters
from mini_pipeline.pipeline.schema import PipelineDefinition, PipelineStep
from mini_pipeline.scheduler.dispatcher import Dispatcher

logger = logging.getLogger(__name__)

# Patterns for pre-flight; engine doesn't depend on resolver internals.
_STEP_OUTPUT_EXPR = re.compile(
    r"^\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)"
    r"\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}\s*$"
)
_ALL_DEPS_EXPR = re.compile(
    r"^\s*\$\{\{\s*all\.deps\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}\s*$"
)

_MAX_BACKOFF_SECONDS = 60.0


class RemoteTaskInputs:
    """Resolved inputs for a task dispatched to a remote runner, kept until
    the runner claims it (then used to build the download bundle)."""

    __slots__ = (
        "run_id", "task_id", "step_name", "plugin", "params", "run_params",
        "dependencies", "uploads", "timeout_seconds", "machine_id",
        "bundle_path",
    )

    def __init__(
        self,
        *,
        run_id: str,
        task_id: str,
        step_name: str,
        plugin: Any,
        params: dict[str, Any],
        run_params: dict[str, Any] | None,
        dependencies: dict[str, Any],
        uploads: dict[str, Path] | None,
        timeout_seconds: int,
        machine_id: str,
    ) -> None:
        self.run_id = run_id
        self.task_id = task_id
        self.step_name = step_name
        self.plugin = plugin
        self.params = params
        self.run_params = run_params or {}
        self.dependencies = dependencies
        self.uploads = uploads
        self.timeout_seconds = timeout_seconds
        self.machine_id = machine_id
        self.bundle_path: Path | None = None


class PipelineEngine:
    def __init__(
        self,
        *,
        plugins: PluginRepository,
        runs: RunRepository,
        executor: TaskExecutor,
        dispatcher: Dispatcher,
        events: EventBus | None = None,
        retry_backoff_seconds: float = 2.0,
        storage: Any | None = None,
        poll_interval_seconds: float = 0.5,
        task_timeout_seconds: int = 3600,
        ssh_executor: Any | None = None,
        email_service: Any | None = None,
        users: Any | None = None,
        task_cache: TaskCacheRepository | None = None,
    ) -> None:
        self.plugins = plugins
        self.runs = runs
        self.executor = executor
        self.dispatcher = dispatcher
        self.events = events or EventBus()
        self.retry_backoff_seconds = retry_backoff_seconds
        self.storage = storage
        self.poll_interval_seconds = poll_interval_seconds
        self.ssh_executor = ssh_executor
        self.task_timeout_seconds = task_timeout_seconds
        self.email_service = email_service
        self.users = users
        self.task_cache = task_cache
        self.cancellations = CancellationRegistry()
        # Set on service shutdown so remote-task wait loops exit instead of
        # blocking dispatcher shutdown forever.
        self.shutdown_event = threading.Event()
        # Last resolved inputs per (run, step) so retry submissions reuse them.
        # The coordinator is single-threaded per run; a plain dict is enough.
        self._resolved_params_cache: dict[tuple[str, str], dict[str, Any]] = {}
        self._dependency_results_cache: dict[tuple[str, str], dict[str, Any]] = {}
        self._step_cache_keys: dict[tuple[str, str], str] = {}
        # Remote tasks awaiting runner pickup, keyed by task id.
        self.remote_inputs: dict[str, RemoteTaskInputs] = {}

    def _compute_cache_key(
        self,
        step: PipelineStep,
        plugin,
        params: dict[str, Any],
        dependencies: dict[str, Any],
    ) -> str:
        import hashlib

        hasher = hashlib.sha256()
        hasher.update(str(plugin.name).encode("utf-8"))
        hasher.update(str(plugin.version).encode("utf-8"))
        try:
            install_path = Path(plugin.install_path)
            if install_path.is_dir():
                manifest_file = install_path / "plugin.yaml"
                if manifest_file.is_file():
                    hasher.update(manifest_file.read_bytes())
        except Exception:
            pass
        hasher.update(json.dumps(params or {}, sort_keys=True, default=str).encode("utf-8"))
        dep_dict = {}
        for dep_name, dep_res in (dependencies or {}).items():
            if hasattr(dep_res, "model_dump"):
                dep_dict[dep_name] = dep_res.model_dump()
            elif isinstance(dep_res, dict):
                dep_dict[dep_name] = dep_res
            else:
                dep_dict[dep_name] = str(dep_res)
        hasher.update(json.dumps(dep_dict, sort_keys=True, default=str).encode("utf-8"))
        return hasher.hexdigest()

    def _dispatch_email_notification(
        self, run_id: str, status: PipelineStatus, message: str = ""
    ) -> None:
        """Trigger background email notification if the run owner has an email address."""
        if not self.email_service or not self.users:
            return
        try:
            run_record = self.runs.get(run_id)
            if run_record and run_record.owner_id:
                user = self.users.get(run_record.owner_id)
                if user and user.email:
                    duration = (
                        (run_record.finished_at - run_record.started_at).total_seconds()
                        if run_record.finished_at and run_record.started_at
                        else 0.0
                    )
                    self.email_service.send_pipeline_notification(
                        to_email=user.email,
                        pipeline_name=run_record.pipeline_name,
                        run_id=run_id,
                        status=status.value,
                        duration_s=duration,
                        trigger_by=user.display_name or user.username,
                        web_url=f"/runs/{run_id}",
                        error_summary=message if status == PipelineStatus.FAILED else "",
                    )
        except Exception as e:
            logger.warning(
                "Failed to dispatch pipeline completion email for run %s: %s", run_id, e
            )

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------

    def submit(
        self,
        *,
        pipeline_id: str,
        definition: PipelineDefinition,
        params: dict[str, Any],
        uploads: dict[str, Path] | None = None,
        machine_id: str | None = None,
        task_machines: dict[str, str] | None = None,
        owner_id: str | None = None,
    ) -> PipelineRun:
        merged_params = dict(definition.params)
        merged_params.update(params)
        ordered = topological_order(definition)
        steps = {step.name: step for step in definition.steps}
        for step in definition.steps:
            plugin_name, plugin_version = step.plugin_reference
            if not self.plugins.version_exists(plugin_name, plugin_version):
                raise ValidationError(
                    f"Pipeline references missing plugin {plugin_name}@{plugin_version}"
                )
        # Pre-flight: every required input that resolves through ${{ params.* }}
        # or ${{ all.deps.outputs.* }} must be satisfied by `merged_params`.
        self._preflight_required(definition, merged_params)
        run = self.runs.create(
            pipeline_id=pipeline_id,
            pipeline_name=definition.name,
            params=merged_params,
            tasks=[(name, *steps[name].plugin_reference) for name in ordered],
            machine_id=machine_id,
            task_machines=task_machines,
            owner_id=owner_id,
        )
        self.dispatcher.submit_run(
            lambda run_id, defn, prms: self._coordinate(run_id, defn, prms, uploads=uploads),
            run.id, definition, merged_params,
        )
        return run

    # ------------------------------------------------------------------
    # Pre-flight validation
    # ------------------------------------------------------------------

    def _preflight_required(
        self,
        definition: PipelineDefinition,
        params: dict[str, Any],
    ) -> None:
        """Reject the run if any required input can't be filled by `params`.

        The check covers two cases:
        1. The step's `with.<key>` is a literal `${{ params.<key> }}` and that
           key is missing from the merged pipeline-level + run params.
        2. The step's `with.<key>` is `${{ all.deps.outputs.<key> }}` and the
           key is missing from the merged params (fan-in requires the
           pipeline-level input to be supplied at run time).
        Per-step overrides (e.g. `with` values that are not ${{}} expressions
        pointing at params) are accepted because they are constants.

        Steps whose required inputs come from `steps.<dep>.outputs.<key>` are
        not checked here: their values arrive at execution time from the
        upstream step's outputs, not from `params`.
        """
        from mini_pipeline.plugin.manifest import load_manifest

        # Build output-key index from all installed manifests.
        # This lets us verify wiring before any step has run.
        dep_outputs: dict[str, set[str]] = {}
        for step in definition.steps:
            install_path = self._plugin_install_path(step.plugin_reference)
            if install_path is None:
                continue
            try:
                step_manifest = load_manifest(install_path)
                outputs = step_manifest.contract.outputs
                if isinstance(outputs, list):
                    dep_outputs[step.name] = {o.name for o in outputs}
                else:
                    dep_outputs[step.name] = set(outputs.keys())
            except Exception:
                dep_outputs[step.name] = set()

        missing_steps: dict[str, list[str]] = {}
        for step in definition.steps:
            install_path = self._plugin_install_path(step.plugin_reference)
            if install_path is None:
                continue
            try:
                manifest = load_manifest(install_path)
            except Exception:
                continue
            inputs = manifest.contract.inputs
            if isinstance(inputs, list):
                required = {r.name for r in inputs if getattr(r, "required", False)}
            else:
                required = {
                    k for k, spec in inputs.items()
                    if getattr(spec, "required", False)
                }
            if not required:
                continue
            for key in required:
                # v2 contract: if the resource is declared with source=artifact
                # and `from: <dep>.<output>`, the value will be supplied by the
                # executor at runtime — skip the params check.
                if isinstance(inputs, list):
                    res_obj = next((r for r in inputs if r.name == key), None)
                    if res_obj is not None and getattr(res_obj, "source", "") in (
                        "artifact",
                        "upload",
                    ):
                        continue
                value = (step.parameters or {}).get(key)
                if value is None:
                    missing_steps.setdefault(step.name, []).append(key)
                    continue
                if not isinstance(value, str):
                    continue  # literal scalar → OK
                s_match = _STEP_OUTPUT_EXPR.fullmatch(value)
                if s_match:
                    dep = s_match.group(1)
                    out_key = s_match.group(2)
                    if dep not in dep_outputs or out_key not in dep_outputs[dep]:
                        missing_steps.setdefault(step.name, []).append(
                            f"{key} (step {dep} has no output {out_key})"
                        )
                    continue
                a_match = _ALL_DEPS_EXPR.fullmatch(value)
                if a_match:
                    out_key = a_match.group(1)
                    any_has = any(
                        out_key in dep_outputs[d] for d in step.depends
                    )
                    if not any_has:
                        missing_steps.setdefault(step.name, []).append(
                            f"{key} (no dependency declares output {out_key})"
                        )
                    continue
                # All other ${{ }} forms are treated as params
                params_only = {key: value}
                try:
                    resolved = resolve_parameters(params_only, params=params, steps={})
                    if key not in resolved:
                        missing_steps.setdefault(step.name, []).append(key)
                except ValidationError:
                    missing_steps.setdefault(step.name, []).append(key)
        if missing_steps:
            problems: list[str] = []
            for step_name, keys in missing_steps.items():
                if keys:
                    problems.append(f"{step_name}: {', '.join(keys)}")
            raise ValidationError(
                "Required inputs are not provided in pipeline params or run request: "
                + "; ".join(problems)
            )

    def _plugin_install_path(
        self, plugin_ref: tuple[str, str]
    ) -> Path | None:
        # The authoritative install location lives on the plugin version row;
        # reading settings here would guess the wrong storage root whenever
        # the engine runs against a non-default configuration (e.g. tests).
        try:
            version = self.plugins.get_version(plugin_ref[0], plugin_ref[1])
        except Exception:
            return None
        path = Path(version.install_path)
        return path if path.is_dir() else None

    # ------------------------------------------------------------------
    # Coordination
    # ------------------------------------------------------------------

    def _publish(
        self,
        run_id: str,
        event_type: str,
        *,
        task_id: str | None = None,
        step_name: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        event = RunEvent(
            run_id=run_id,
            type=event_type,
            data=data or {},
            timestamp=time.time(),
            task_id=task_id,
            step_name=step_name,
        )
        try:
            self.events.publish(event)
        except Exception:  # Event delivery must never break execution.
            logger.exception("Failed to publish event for run %s", run_id)

    @staticmethod
    def _observe_run(status: str) -> None:
        try:
            from mini_pipeline.server.metrics import observe_run_status

            observe_run_status(status)
        except Exception:
            pass

    @staticmethod
    def _observe_task(plugin_name: str, started_at: Any) -> None:
        try:
            from mini_pipeline.server.metrics import observe_task_duration

            if started_at is not None:
                observe_task_duration(
                    plugin_name, max(0.0, time.time() - started_at.timestamp())
                )
        except Exception:
            pass

    @staticmethod
    def _observe_retry(plugin_name: str) -> None:
        try:
            from mini_pipeline.server.metrics import observe_task_retry

            observe_task_retry(plugin_name)
        except Exception:
            pass

    def _coordinate(
        self,
        run_id: str,
        definition: PipelineDefinition,
        params: dict[str, Any],
        uploads: dict[str, Path] | None = None,
    ) -> None:
        run_cancel = self.cancellations.register(run_id)
        try:
            self._coordinate_inner(run_id, definition, params, uploads, run_cancel)
        finally:
            self.cancellations.release(run_id)

    def _coordinate_inner(
        self,
        run_id: str,
        definition: PipelineDefinition,
        params: dict[str, Any],
        uploads: dict[str, Path] | None,
        run_cancel,
    ) -> None:
        now = utcnow()
        self.runs.set_run_state(run_id, PipelineStatus.RUNNING, started_at=now)
        self._publish(run_id, "run.status", data={"status": PipelineStatus.RUNNING.value})
        steps = {step.name: step for step in definition.steps}
        task_entities = {task.step_name: task for task in self.runs.get(run_id).tasks}
        # Initialise `states` from the database so branch runs respect the
        # tasks that were already marked SUCCESS / SKIPPED by RunService.
        states = {name: TaskStatus(task.status) for name, task in task_entities.items()}
        results: dict[str, TaskExecutionResult] = {}
        futures: dict[Future, str] = {}
        attempts: dict[str, int] = {}
        cancelled = False
        try:
            terminal = {
                TaskStatus.SUCCESS,
                TaskStatus.FAILED,
                TaskStatus.SKIPPED,
                TaskStatus.CANCELLED,
            }
            while any(state not in terminal for state in states.values()):
                progressed = self._advance_ready(
                    run_id=run_id,
                    params=params,
                    steps=steps,
                    tasks=task_entities,
                    states=states,
                    results=results,
                    futures=futures,
                    attempts=attempts,
                    uploads=uploads,
                    run_cancel=run_cancel,
                )
                if not futures:
                    if not progressed:
                        raise RuntimeError("Pipeline scheduler could not make progress")
                    continue
                completed, _ = wait(list(futures), return_when=FIRST_COMPLETED)
                for future in completed:
                    step_name = futures.pop(future)
                    task = task_entities[step_name]
                    step = steps[step_name]
                    try:
                        result = future.result()
                    except Exception as exc:  # Keep coordinator alive after worker defects.
                        logger.exception("Task %s failed unexpectedly", step_name)
                        result = TaskExecutionResult(False, f"Internal task error: {exc}")

                    if result.cancelled or run_cancel.is_set():
                        cancelled = True
                        states[step_name] = TaskStatus.CANCELLED
                        self.runs.set_task_state(
                            task.id,
                            TaskStatus.CANCELLED,
                            message="Cancelled",
                            log_path=str(result.log_path) if result.log_path else None,
                            finished_at=utcnow(),
                        )
                        self._publish(
                            run_id, "task.status",
                            task_id=task.id, step_name=step_name,
                            data={"status": TaskStatus.CANCELLED.value},
                        )
                        continue

                    if not result.success and step.retries > 0:
                        attempt = attempts.get(step_name, 1)
                        if attempt < step.retries + 1:
                            attempts[step_name] = attempt + 1
                            self._observe_retry(task.plugin_name)
                            delay = min(
                                self.retry_backoff_seconds * (2 ** (attempt - 1)),
                                _MAX_BACKOFF_SECONDS,
                            )
                            message = (
                                f"Attempt {attempt}/{step.retries + 1} failed: "
                                f"{result.message}; retrying in {delay:.0f}s"
                            )
                            pre_claim = (
                                TaskStatus.QUEUED if task.machine_id else TaskStatus.RUNNING
                            )
                            self.runs.set_task_state(
                                task.id,
                                pre_claim,
                                message=message,
                                attempt=attempt + 1,
                            )
                            self._publish(
                                run_id, "task.retry",
                                task_id=task.id, step_name=step_name,
                                data={"attempt": attempt + 1, "message": message},
                            )
                            if task.machine_id:
                                future = self.dispatcher.submit_task(
                                    self._requeue_remote_with_backoff,
                                    delay=delay,
                                    task=task,
                                    plugin=self.plugins.get_version(*step.plugin_reference),
                                    params=self._resolved_params_cache.get(
                                        (run_id, step_name), {}
                                    ),
                                    dependencies=self._dependency_results_cache.get(
                                        (run_id, step_name), {}
                                    ),
                                    uploads=uploads,
                                    cancel_event=run_cancel,
                                )
                            else:
                                future = self.dispatcher.submit_task(
                                    self._execute_with_backoff,
                                    delay=delay,
                                    run_id=run_id,
                                    task=task,
                                    plugin=self.plugins.get_version(*step.plugin_reference),
                                    params=self._resolved_params_cache.get(
                                        (run_id, step_name), {}
                                    ),
                                    dependencies=self._dependency_results_cache.get(
                                        (run_id, step_name), {}
                                    ),
                                    uploads=uploads,
                                    run_cancel=run_cancel,
                                )
                            futures[future] = step_name
                            continue

                    state = TaskStatus.SUCCESS if result.success else TaskStatus.FAILED
                    results[step_name] = result
                    states[step_name] = state
                    self.runs.set_task_state(
                        task.id,
                        state,
                        message=result.message,
                        outputs=result.outputs,
                        log_path=str(result.log_path) if result.log_path else None,
                        finished_at=utcnow(),
                    )
                    if (
                        result.success
                        and getattr(step, "cache", False)
                        and self.task_cache is not None
                    ):
                        cache_key = self._step_cache_keys.get((run_id, step_name))
                        if not cache_key:
                            plugin_inst = self.plugins.get_version(*step.plugin_reference)
                            cache_key = self._compute_cache_key(
                                step,
                                plugin_inst,
                                self._resolved_params_cache.get((run_id, step_name), {}),
                                self._dependency_results_cache.get((run_id, step_name), {}),
                            )
                        try:
                            self.task_cache.set(
                                cache_key=cache_key,
                                plugin_name=task.plugin_name,
                                plugin_version=task.plugin_version,
                                step_name=step_name,
                                outputs=dict(result.outputs or {}),
                                artifacts=list(result.artifacts or []),
                            )
                        except Exception:
                            logger.exception("Failed to store cache record for step %s", step_name)
                    self._observe_task(task.plugin_name, task.started_at)
                    self._publish(
                        run_id, "task.status",
                        task_id=task.id, step_name=step_name,
                        data={
                            "status": state.value,
                            "message": result.message,
                            "outputs": result.outputs,
                        },
                    )

            if cancelled or run_cancel.is_set():
                # Anything not finished is cancelled: no new work starts.
                for name, state in states.items():
                    if state not in terminal:
                        states[name] = TaskStatus.CANCELLED
                        self.runs.set_task_state(
                            task_entities[name].id,
                            TaskStatus.CANCELLED,
                            message="Cancelled before execution",
                            finished_at=utcnow(),
                        )
                        self._publish(
                            run_id, "task.status",
                            task_id=task_entities[name].id, step_name=name,
                            data={"status": TaskStatus.CANCELLED.value},
                        )
                for future in futures:
                    future.cancel()
                self.runs.set_run_state(
                    run_id,
                    PipelineStatus.CANCELLED,
                    message="Run cancelled",
                    finished_at=utcnow(),
                )
                self._publish(
                    run_id, "run.status",
                    data={"status": PipelineStatus.CANCELLED.value},
                )
                return

            failed = any(state != TaskStatus.SUCCESS for state in states.values())
            status = PipelineStatus.FAILED if failed else PipelineStatus.SUCCESS
            message = "One or more tasks failed or were skipped" if failed else "Pipeline completed"
            self.runs.set_run_state(
                run_id,
                status,
                message=message,
                finished_at=utcnow(),
            )
            self._observe_run(status.value)
            self._publish(run_id, "run.status", data={"status": status.value})
            self._dispatch_email_notification(run_id, status, message)
        except Exception as exc:
            logger.exception("Pipeline run %s failed in coordinator", run_id)
            self.runs.set_run_state(
                run_id,
                PipelineStatus.FAILED,
                message=f"Pipeline coordinator failed: {exc}",
                finished_at=utcnow(),
            )
            self._observe_run(PipelineStatus.FAILED.value)
            self._publish(
                run_id, "run.status",
                data={"status": PipelineStatus.FAILED.value, "message": str(exc)},
            )
            self._dispatch_email_notification(run_id, PipelineStatus.FAILED, str(exc))

    def execute_subgraph(
        self,
        *,
        run_id: str,
        definition: PipelineDefinition,
        from_step: str,
        params: dict[str, Any],
    ) -> None:
        """Schedule execution of just the from_step subgraph for a branch run.

        Upstream tasks must already be marked SUCCESS (or SKIPPED) by the
        caller; this method only progresses tasks that are still PENDING.
        """
        self.dispatcher.submit_run(self._coordinate, run_id, definition, params)

    def _execute_ssh_task(self, *, run_id: str, task, plugin, params, dependencies,
                          uploads, run_params, cancel_event=None):
        if task.machine_id is None or self.ssh_executor is None:
            return TaskExecutionResult(False, "SSH executor unavailable")
        return self.ssh_executor.execute(
            run_id=run_id,
            task=task,
            plugin=plugin,
            params=params,
            dependencies=dependencies,
            uploads=uploads,
            run_params=run_params,
            cancel_event=cancel_event,
        )

    def _execute_with_backoff(self, *, delay: float, run_cancel, **kwargs):
        time.sleep(delay)
        return self.executor.execute(
            run_id=kwargs["run_id"],
            task=kwargs["task"],
            plugin=kwargs["plugin"],
            params=kwargs["params"],
            dependencies=kwargs["dependencies"],
            uploads=kwargs.get("uploads"),
            cancel_event=run_cancel,
        )

    def _requeue_remote_with_backoff(
        self, *, delay: float, task, plugin, params, dependencies, uploads, cancel_event=None
    ):
        """Re-park a retried task in QUEUED so a runner can claim it again."""
        time.sleep(delay)
        requeue = RemoteTaskInputs(
            run_id=task.run_id,
            task_id=task.id,
            step_name=task.step_name,
            plugin=plugin,
            params=params,
            run_params=self._resolved_params_cache.get((task.run_id, task.step_name)),
            dependencies=dependencies,
            uploads=uploads,
            timeout_seconds=self.task_timeout_seconds,
            machine_id=task.machine_id,
        )
        self.remote_inputs[task.id] = requeue
        self._persist_remote_inputs(requeue)
        self.runs.set_task_state(
            task.id,
            TaskStatus.QUEUED,
            started_at=utcnow(),
        )
        self._publish(
            task.run_id, "task.status",
            task_id=task.id, step_name=task.step_name,
            data={"status": TaskStatus.QUEUED.value},
        )
        return self._await_remote_task(task=task, cancel_event=cancel_event)

    def _advance_ready(
        self,
        *,
        run_id: str,
        params: dict[str, Any],
        steps: dict[str, PipelineStep],
        tasks: dict[str, TaskRun],
        states: dict[str, TaskStatus],
        results: dict[str, TaskExecutionResult],
        futures: dict[Future, str],
        attempts: dict[str, int],
        uploads: dict[str, Path] | None = None,
        run_cancel=None,
    ) -> bool:
        progressed = False
        for name, step in steps.items():
            if states[name] != TaskStatus.PENDING:
                continue
            if run_cancel is not None and run_cancel.is_set():
                return progressed
            dependency_states = [states[dependency] for dependency in step.depends]
            if any(
                state in {TaskStatus.FAILED, TaskStatus.SKIPPED, TaskStatus.CANCELLED}
                for state in dependency_states
            ):
                # If the run is being cancelled, downstream tasks are
                # CANCELLED rather than SKIPPED.
                skipped_state = (
                    TaskStatus.CANCELLED
                    if run_cancel is not None and run_cancel.is_set()
                    else TaskStatus.SKIPPED
                )
                states[name] = skipped_state
                self.runs.set_task_state(
                    tasks[name].id,
                    skipped_state,
                    message=(
                        "Cancelled because the run was cancelled"
                        if skipped_state == TaskStatus.CANCELLED
                        else "Skipped because a dependency did not succeed"
                    ),
                    finished_at=utcnow(),
                )
                self._publish(
                    run_id, "task.status",
                    task_id=tasks[name].id, step_name=name,
                    data={"status": skipped_state.value},
                )
                progressed = True
                continue
            if not all(state == TaskStatus.SUCCESS for state in dependency_states):
                continue

            states[name] = TaskStatus.READY
            self.runs.set_task_state(tasks[name].id, TaskStatus.READY)
            dependency_results = {
                dependency: DependencyResult(
                    outputs=self._dependency_outputs(dependency, results, tasks),
                    artifacts=self._dependency_artifacts(dependency, results, tasks),
                )
                for dependency in step.depends
            }
            expression_context = {
                dependency: dependency_results[dependency].model_dump()
                for dependency in dependency_results
            }
            try:
                step_local_params = dict(params)
                # Merge per-step overrides from the run's params dict.
                # The frontend Form mode submits {step_name: {key: value}, ...}.
                step_override = params.get(name)
                if isinstance(step_override, dict):
                    for k, v in step_override.items():
                        if k not in expression_context:
                            step_local_params[k] = v
                resolved_params = resolve_parameters(
                    step.parameters,
                    params=step_local_params,
                    steps=expression_context,
                )
            except ValidationError as exc:
                states[name] = TaskStatus.FAILED
                result = TaskExecutionResult(False, str(exc))
                results[name] = result
                self.runs.set_task_state(
                    tasks[name].id,
                    TaskStatus.FAILED,
                    message=str(exc),
                    finished_at=utcnow(),
                )
                self._publish(
                    run_id, "task.status",
                    task_id=tasks[name].id, step_name=name,
                    data={"status": TaskStatus.FAILED.value, "message": str(exc)},
                )
                progressed = True
                continue

            plugin_name, plugin_version = step.plugin_reference
            plugin = self.plugins.get_version(plugin_name, plugin_version)
            attempts[name] = 1
            self._resolved_params_cache[(run_id, name)] = resolved_params
            self._dependency_results_cache[(run_id, name)] = dependency_results

            is_ssh = (
                tasks[name].machine_id is not None
                and self.ssh_executor is not None
                and self.ssh_executor.handles(tasks[name].machine_id)
            )
            if is_ssh:
                # SSH push machine: execute directly on a task worker thread.
                states[name] = TaskStatus.RUNNING
                self.runs.set_task_state(
                    tasks[name].id,
                    TaskStatus.RUNNING,
                    started_at=utcnow(),
                    attempt=1,
                )
                self._publish(
                    run_id, "task.status",
                    task_id=tasks[name].id, step_name=name,
                    data={"status": TaskStatus.RUNNING.value},
                )
                future = self.dispatcher.submit_task(
                    self._execute_ssh_task,
                    run_id=run_id,
                    task=tasks[name],
                    plugin=plugin,
                    params=resolved_params,
                    dependencies=dependency_results,
                    uploads=uploads,
                    run_params=step_local_params,
                    cancel_event=run_cancel,
                )
                futures[future] = name
                progressed = True
                continue

            if tasks[name].machine_id:
                # Remote execution: park the task in QUEUED until a runner
                # claims it; the coordinator future polls the persisted state.
                states[name] = TaskStatus.QUEUED
                self.runs.set_task_state(
                    tasks[name].id,
                    TaskStatus.QUEUED,
                    started_at=utcnow(),
                    attempt=1,
                )
                self.remote_inputs[tasks[name].id] = RemoteTaskInputs(
                    run_id=run_id,
                    task_id=tasks[name].id,
                    step_name=name,
                    plugin=plugin,
                    params=resolved_params,
                    run_params=step_local_params,
                    dependencies=dependency_results,
                    uploads=uploads,
                    timeout_seconds=self.task_timeout_seconds,
                    machine_id=tasks[name].machine_id,
                )
                self._persist_remote_inputs(self.remote_inputs[tasks[name].id])
                self._publish(
                    run_id, "task.status",
                    task_id=tasks[name].id, step_name=name,
                    data={"status": TaskStatus.QUEUED.value, "machine": plugin_name},
                )
                future = self.dispatcher.submit_task(
                    self._await_remote_task,
                    task=tasks[name],
                    cancel_event=run_cancel,
                )
                futures[future] = name
                progressed = True
                continue

            # Check cache for local execution
            if getattr(step, "cache", False) and self.task_cache is not None:
                cache_key = self._compute_cache_key(
                    step, plugin, resolved_params, dependency_results
                )
                self._step_cache_keys[(run_id, name)] = cache_key
                cached = self.task_cache.get(cache_key)
                if cached is not None:
                    log_path = None
                    if self.storage:
                        log_path = self.storage.logs / run_id / f"{tasks[name].id}.log"
                        try:
                            log_path.parent.mkdir(parents=True, exist_ok=True)
                            msg = (
                                f"[CACHE HIT] Restored outputs and artifacts from "
                                f"cache key {cache_key[:12]}\n"
                            )
                            log_path.write_text(msg, encoding="utf-8")
                        except Exception:
                            pass
                    states[name] = TaskStatus.SUCCESS
                    self.runs.set_task_state(
                        tasks[name].id,
                        TaskStatus.SUCCESS,
                        message="[CACHE HIT] Restored from cache",
                        outputs=dict(cached.outputs or {}),
                        log_path=str(log_path) if log_path else None,
                        started_at=utcnow(),
                        finished_at=utcnow(),
                    )
                    results[name] = TaskExecutionResult(
                        True,
                        message="[CACHE HIT] Restored from cache",
                        outputs=dict(cached.outputs or {}),
                        artifacts=list(cached.artifacts or []),
                        log_path=log_path,
                    )
                    self._publish(
                        run_id,
                        "task.status",
                        task_id=tasks[name].id,
                        step_name=name,
                        data={
                            "status": TaskStatus.SUCCESS.value,
                            "message": "[CACHE HIT] Restored from cache",
                            "outputs": cached.outputs,
                        },
                    )
                    progressed = True
                    continue

            states[name] = TaskStatus.RUNNING
            self.runs.set_task_state(
                tasks[name].id,
                TaskStatus.RUNNING,
                started_at=utcnow(),
                attempt=1,
            )
            self._publish(
                run_id, "task.status",
                task_id=tasks[name].id, step_name=name,
                data={"status": TaskStatus.RUNNING.value},
            )
            future = self.dispatcher.submit_task(
                self.executor.execute,
                run_id=run_id,
                task=tasks[name],
                plugin=plugin,
                params=resolved_params,
                dependencies=dependency_results,
                uploads=uploads,
                run_params=step_local_params,
                cancel_event=run_cancel,
            )
            futures[future] = name
            progressed = True
        return progressed

    # ------------------------------------------------------------------
    # Remote task state persistence (crash recovery)
    # ------------------------------------------------------------------

    def _remote_state_path(self, task_id: str) -> Path:
        return self.storage.root / "remote_state" / f"{task_id}.json"

    def _persist_remote_inputs(self, inputs: RemoteTaskInputs) -> None:
        """Durably record resolved inputs so a restart can rebuild the bundle.

        The in-memory dict is lost when the API process exits; without this
        file a runner claiming the task afterwards would get empty params and
        a 404 bundle. Upload paths point at server-local temp files, which is
        acceptable: they live on the same host as this state directory.
        """
        payload = {
            "run_id": inputs.run_id,
            "step_name": inputs.step_name,
            "params": inputs.params,
            "run_params": inputs.run_params,
            "dependencies": {
                name: entry.model_dump() if hasattr(entry, "model_dump") else entry
                for name, entry in (inputs.dependencies or {}).items()
            },
            "uploads": {
                name: str(path) for name, path in (inputs.uploads or {}).items()
            },
            "timeout_seconds": inputs.timeout_seconds,
            "machine_id": inputs.machine_id,
        }
        path = self._remote_state_path(inputs.task_id)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, default=str))
        except OSError:
            logger.exception(
                "Failed to persist remote inputs for task %s", inputs.task_id
            )

    def _discard_remote_state(self, task_id: str) -> None:
        try:
            self._remote_state_path(task_id).unlink(missing_ok=True)
        except OSError:
            logger.exception("Failed to discard remote state for task %s", task_id)

    def remote_inputs_for(self, task_id: str) -> RemoteTaskInputs | None:
        """Resolved inputs for a remote task: memory first, then disk.

        The disk fallback rebuilds from the JSON written when the task was
        parked, so runners can still claim and download bundles after an API
        restart.
        """
        remote = self.remote_inputs.get(task_id)
        if remote is not None:
            return remote
        path = self._remote_state_path(task_id)
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            task = self.runs.get_task_by_id(task_id)
            plugin = self.plugins.get_version(task.plugin_name, task.plugin_version)
            uploads = {
                name: Path(value)
                for name, value in (payload.get("uploads") or {}).items()
                if value
            }
            return RemoteTaskInputs(
                run_id=task.run_id,
                task_id=task.id,
                step_name=task.step_name,
                plugin=plugin,
                params=payload.get("params") or {},
                run_params=payload.get("run_params") or {},
                dependencies=payload.get("dependencies") or {},
                uploads=uploads,
                timeout_seconds=payload.get("timeout_seconds")
                or self.task_timeout_seconds,
                machine_id=task.machine_id or "",
            )
        except Exception:
            logger.exception(
                "Failed to rebuild remote inputs for task %s after restart", task_id
            )
            return None

    # ------------------------------------------------------------------
    # Remote task wait loop
    # ------------------------------------------------------------------

    def _await_remote_task(self, *, task, cancel_event=None) -> TaskExecutionResult:
        """Poll the persisted task state until the runner reports a terminal
        status (or the lease reaper fails a lost runner)."""
        from mini_pipeline.domain.states import TERMINAL_TASK_STATUSES

        try:
            while True:
                fresh = self.runs.get_task_by_id(task.id)
                status = TaskStatus(fresh.status)
                if status in TERMINAL_TASK_STATUSES:
                    return self._remote_result(fresh, status)
                if self.shutdown_event.is_set():
                    return TaskExecutionResult(
                        False, "Service shutting down; remote task abandoned",
                        cancelled=True,
                    )
                time.sleep(self.poll_interval_seconds)
        finally:
            self.remote_inputs.pop(task.id, None)
            self._discard_remote_state(task.id)

    @staticmethod
    def _remote_result(task, status: TaskStatus) -> TaskExecutionResult:
        artifacts = [
            {
                "id": a.id,
                "name": a.name,
                "path": str(a.storage_path),
                "size": a.size,
                "sha256": a.sha256,
            }
            for a in (task.artifacts or [])
        ]
        if status == TaskStatus.SUCCESS:
            return TaskExecutionResult(
                True,
                "Runner completed successfully",
                outputs=dict(task.outputs or {}),
                artifacts=artifacts,
                log_path=Path(task.log_path) if task.log_path else None,
            )
        if status == TaskStatus.CANCELLED:
            return TaskExecutionResult(
                False,
                task.message or "Cancelled",
                log_path=Path(task.log_path) if task.log_path else None,
                cancelled=True,
            )
        return TaskExecutionResult(
            False,
            task.message or f"Task finished with status {status.value}",
            log_path=Path(task.log_path) if task.log_path else None,
        )

    @staticmethod
    def _dependency_outputs(
        dependency: str,
        results: dict[str, TaskExecutionResult],
        tasks: dict[str, TaskRun],
    ) -> dict[str, Any]:
        if dependency in results:
            return dict(results[dependency].outputs or {})
        return dict(tasks[dependency].outputs or {})

    @staticmethod
    def _dependency_artifacts(
        dependency: str,
        results: dict[str, TaskExecutionResult],
        tasks: dict[str, TaskRun],
    ) -> list[dict[str, Any]]:
        """Return upstream artifacts as a list of dicts in v2 contract format.

        v2 collector produces dicts like {id, name, size, sha256, storage_path}
        but legacy code expected ArtifactRecord objects. We normalise both.
        """
        items: list[dict[str, Any]] = []
        source = None
        if dependency in results:
            source = results[dependency].artifacts
        elif dependency in tasks:
            stored = tasks[dependency].artifacts
            if stored:
                source = list(stored)
        if not source:
            return []
        for artifact in source:
            if isinstance(artifact, dict):
                items.append(
                    {
                        "id": artifact.get("id", ""),
                        "name": artifact.get("name", ""),
                        "path": artifact.get("storage_path") or artifact.get("path", ""),
                        "size": artifact.get("size", 0),
                        "sha256": artifact.get("sha256", ""),
                    }
                )
            else:
                items.append(
                    {
                        "id": artifact.id,
                        "name": artifact.name,
                        "path": str(artifact.storage_path),
                        "size": artifact.size,
                        "sha256": artifact.sha256,
                    }
                )
        return items
