"""Asynchronous in-process DAG pipeline engine."""

from __future__ import annotations

import logging
from concurrent.futures import FIRST_COMPLETED, Future, wait
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from mini_pipeline.database.models import PipelineRun, TaskRun
from mini_pipeline.database.repositories import PluginRepository, RunRepository
from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.domain.states import PipelineStatus, TaskStatus
from mini_pipeline.executor.protocol import DependencyResult
from mini_pipeline.executor.task_executor import TaskExecutionResult, TaskExecutor
from mini_pipeline.pipeline.dag import topological_order
from mini_pipeline.pipeline.resolver import resolve_parameters
from mini_pipeline.pipeline.schema import PipelineDefinition, PipelineStep
from mini_pipeline.scheduler.dispatcher import Dispatcher

logger = logging.getLogger(__name__)

# Patterns for pre-flight; engine doesn't depend on resolver internals.
import re as _re
_STEP_OUTPUT_EXPR = _re.compile(
    r"^\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}\s*$"
)
_ALL_DEPS_EXPR = _re.compile(
    r"^\s*\$\{\{\s*all\.deps\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}\s*$"
)


class PipelineEngine:
    def __init__(
        self,
        *,
        plugins: PluginRepository,
        runs: RunRepository,
        executor: TaskExecutor,
        dispatcher: Dispatcher,
    ) -> None:
        self.plugins = plugins
        self.runs = runs
        self.executor = executor
        self.dispatcher = dispatcher

    def submit(
        self,
        *,
        pipeline_id: str,
        definition: PipelineDefinition,
        params: dict[str, Any],
        uploads: Optional[dict[str, Path]] = None,
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
        )
        self.dispatcher.submit_run(
            lambda run_id, defn, prms: self._coordinate(run_id, defn, prms, uploads=uploads),
            run.id, definition, merged_params,
        )
        return run

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
        from pathlib import Path

        from mini_pipeline.plugin.manifest import load_manifest
        from mini_pipeline.pipeline.resolver import resolve_parameters

        # Build output-key index from all installed manifests.
        # This lets us verify wiring before any step has run.
        dep_outputs: dict[str, set[str]] = {}
        for step in definition.steps:
            install_path = self._plugin_install_path(step.plugin_reference)
            if install_path is None:
                continue
            try:
                step_manifest = load_manifest(install_path)
                # v2 contract outputs are list[OutputResource]; v1 legacy has dict
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
            # v2 contract inputs is a list[InputResource]; v1 legacy had dict
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
                    if res_obj is not None and getattr(res_obj, "source", "") in ("artifact", "upload"):
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
    ) -> Optional[Path]:
        from pathlib import Path

        # The engine does not have a settings reference directly, so we look
        # in the default location relative to the repository structure.
        # In production the install path comes from the plugin row; for the
        # pre-flight we use the standard data directory.
        try:
            from mini_pipeline.core.config import load_settings

            settings = load_settings()
        except Exception:
            return None
        path = settings.storage.plugins / plugin_ref[0] / plugin_ref[1]
        return path if path.is_dir() else None

    @staticmethod
    def _collect_dependencies(
        step: PipelineStep,
    ) -> dict[str, dict[str, Any]]:
        """Pre-flight dependency stub: returns the empty outputs map for
        declared dependencies. The full dependency map is built by the
        coordinator at execution time; here we only need keys + empty
        outputs so the resolver doesn't try to fetch live task results.
        """
        return {
            dep: {"outputs": {}, "artifacts": []} for dep in step.depends
        }

    def _coordinate(
        self,
        run_id: str,
        definition: PipelineDefinition,
        params: dict[str, Any],
        uploads: Optional[dict[str, Path]] = None,
    ) -> None:
        now = datetime.utcnow()
        self.runs.set_run_state(run_id, PipelineStatus.RUNNING, started_at=now)
        steps = {step.name: step for step in definition.steps}
        task_entities = {task.step_name: task for task in self.runs.get(run_id).tasks}
        # Initialise `states` from the database so branch runs respect the
        # tasks that were already marked SUCCESS / SKIPPED by RunService.
        states = {name: TaskStatus(task.status) for name, task in task_entities.items()}
        results: dict[str, TaskExecutionResult] = {}
        futures: dict[Future, str] = {}
        try:
            terminal = {TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.SKIPPED}
            while any(state not in terminal for state in states.values()):
                progressed = self._advance_ready(
                    run_id=run_id,
                    params=params,
                    steps=steps,
                    tasks=task_entities,
                    states=states,
                    results=results,
                    futures=futures,
                    uploads=uploads,
                )
                if not futures:
                    if not progressed:
                        raise RuntimeError("Pipeline scheduler could not make progress")
                    continue
                completed, _ = wait(list(futures), return_when=FIRST_COMPLETED)
                for future in completed:
                    step_name = futures.pop(future)
                    task = task_entities[step_name]
                    try:
                        result = future.result()
                    except Exception as exc:  # Keep coordinator alive after worker defects.
                        logger.exception("Task %s failed unexpectedly", step_name)
                        result = TaskExecutionResult(False, f"Internal task error: {exc}")
                    results[step_name] = result
                    state = TaskStatus.SUCCESS if result.success else TaskStatus.FAILED
                    states[step_name] = state
                    self.runs.set_task_state(
                        task.id,
                        state,
                        message=result.message,
                        outputs=result.outputs,
                        log_path=str(result.log_path) if result.log_path else None,
                        finished_at=datetime.utcnow(),
                    )
            failed = any(state != TaskStatus.SUCCESS for state in states.values())
            status = PipelineStatus.FAILED if failed else PipelineStatus.SUCCESS
            message = "One or more tasks failed or were skipped" if failed else "Pipeline completed"
            self.runs.set_run_state(
                run_id,
                status,
                message=message,
                finished_at=datetime.utcnow(),
            )
        except Exception as exc:
            logger.exception("Pipeline run %s failed in coordinator", run_id)
            self.runs.set_run_state(
                run_id,
                PipelineStatus.FAILED,
                message=f"Pipeline coordinator failed: {exc}",
                finished_at=datetime.utcnow(),
            )

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
        uploads: Optional[dict[str, Path]] = None,
    ) -> bool:
        progressed = False
        for name, step in steps.items():
            if states[name] != TaskStatus.PENDING:
                continue
            dependency_states = [states[dependency] for dependency in step.depends]
            if any(state in {TaskStatus.FAILED, TaskStatus.SKIPPED} for state in dependency_states):
                states[name] = TaskStatus.SKIPPED
                self.runs.set_task_state(
                    tasks[name].id,
                    TaskStatus.SKIPPED,
                    message="Skipped because a dependency did not succeed",
                    finished_at=datetime.utcnow(),
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
                    finished_at=datetime.utcnow(),
                )
                progressed = True
                continue

            plugin_name, plugin_version = step.plugin_reference
            plugin = self.plugins.get_version(plugin_name, plugin_version)
            states[name] = TaskStatus.RUNNING
            self.runs.set_task_state(
                tasks[name].id,
                TaskStatus.RUNNING,
                started_at=datetime.utcnow(),
            )
            future = self.dispatcher.submit_task(
                self.executor.execute,
                run_id=run_id,
                task=tasks[name],
                plugin=plugin,
                params=resolved_params,
                dependencies=dependency_results,
                uploads=uploads,
            )
            futures[future] = name
            progressed = True
        return progressed

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
                from mini_pipeline.database.models import Artifact
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
