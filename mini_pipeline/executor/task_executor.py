"""v2 Task Executor — Resource-based contract execution.

Implements the full lifecycle described in the v2 protocol:
  Resolve Plugin → Resolve Inputs → Download Resources → Create Workspace
  → Generate Context → Execute → Collect Logs → Collect Outputs
  → Generate Artifacts → Finish Task
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.core.config import ExecutionConfig, StorageConfig
from mini_pipeline.database.models import PluginVersion, TaskRun
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.runtime import RuntimeRequest
from mini_pipeline.executor.collector import (
    collect_outputs,
    merge_legacy_output_json,
    read_error_json,
)
from mini_pipeline.executor.context import (
    create_workspace,
    resolve_inputs,
    write_context,
    write_legacy_input_json,
)
from mini_pipeline.plugin.manifest import PluginManifest, load_manifest
from mini_pipeline.runtime.registry import RuntimeRegistry


@dataclass
class TaskExecutionResult:
    success: bool
    message: str = ""
    outputs: dict[str, Any] = field(default_factory=dict)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] | None = None
    log_path: Path | None = None
    cancelled: bool = False


class TaskExecutor:
    def __init__(
        self,
        *,
        storage: StorageConfig,
        execution: ExecutionConfig,
        runtimes: RuntimeRegistry,
        artifact_store: LocalArtifactStore | None = None,
    ) -> None:
        self.storage = storage
        self.execution = execution
        self.runtimes = runtimes
        self.artifact_store = artifact_store

    def execute(
        self,
        *,
        run_id: str,
        task: TaskRun,
        plugin: PluginVersion,
        params: dict[str, Any],
        dependencies: dict[str, Any],
        uploads: dict[str, Path] | None = None,
        run_params: dict[str, Any] | None = None,
        cancel_event=None,
    ) -> TaskExecutionResult:
        workspace = self.storage.workspaces / run_id / task.id
        log_path = self.storage.logs / run_id / f"{task.id}.log"
        if workspace.exists():
            shutil.rmtree(workspace)
        workspace.parent.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # Load manifest
        manifest = self._load_manifest(plugin.install_path)
        # Copy plugin files into the workspace, preserving per-file mode bits
        # (shutil.copytree's default `copy2` can lose exec bits on certain
        # filesystems when the source was extracted from an archive with a
        # restrictive umask). We use `copy2` and then explicitly chmod +x on
        # the entry to guarantee the plugin can be executed.
        shutil.copytree(plugin.install_path, workspace, dirs_exist_ok=True)
        entry = (workspace / manifest.entry).resolve()
        try:
            entry.chmod(entry.stat().st_mode | 0o755)
        except Exception:
            pass

        # Prepare workspace
        create_workspace(workspace)
        write_context(
            workspace,
            pipeline_id=run_id,
            task_id=task.id,
            task_name=task.step_name,
        )

        # Resolve inputs
        packages_dir = getattr(self.storage, "packages", None) or (self.storage.root / "packages")
        resolve_inputs(
            workspace,
            manifest.contract,
            params=params,
            dependencies=dependencies,
            uploads=uploads,
            packages_dir=packages_dir,
        )
        # v1 back-compat: single input.json payload alongside the v2 tree.
        # Legacy plugins see run-level params merged with the resolved step
        # params, so pipeline-level settings are always reachable.
        write_legacy_input_json(
            workspace,
            task_id=task.id,
            params={**(run_params or {}), **params},
            dependencies=dependencies,
        )

        # Execute
        entry = (workspace / manifest.entry).resolve()
        runtime_type = manifest.runtime.type or "shell"
        runtime = self.runtimes.get(runtime_type)
        cmd = [str(entry)]
        with log_path.open("a", encoding="utf-8", buffering=1) as log_stream:
            result = runtime.execute(
                RuntimeRequest(
                    command=cmd,
                    cwd=workspace,
                    environment={
                        "PIPELINE_CONTEXT": str(workspace / "context.json"),
                        "PIPELINE_WORKSPACE": str(workspace),
                        "PIPELINE_TASK_ID": task.id,
                        "MINI_PIPELINE_WORKSPACE": str(workspace),
                    },
                    timeout_seconds=self.execution.task_timeout_seconds,
                    log_stream=log_stream,
                    cancel_event=cancel_event,
                )
            )

        if result.cancelled:
            return TaskExecutionResult(
                False, "Cancelled", log_path=log_path, cancelled=True
            )
        if result.timed_out:
            return TaskExecutionResult(False, "Plugin execution timed out", log_path=log_path)
        if result.error:
            return TaskExecutionResult(False, result.error, log_path=log_path)

        # Check error.json
        error_info = read_error_json(workspace)
        if error_info and result.exit_code != 0:
            msg = error_info.get("message") or f"Plugin exited with code {result.exit_code}"
            return TaskExecutionResult(False, msg, log_path=log_path)

        if result.exit_code != 0:
            return TaskExecutionResult(
                False, f"Plugin exited with code {result.exit_code}", log_path=log_path
            )

        # Collect outputs. Route artifacts through LocalArtifactStore so
        # they're persisted in the database and reachable via the API.
        collected = collect_outputs(
            workspace, manifest.contract, run_id=run_id, task_id=task.id,
            artifact_store=self.artifact_store,
        )
        # v1 back-compat: merge a legacy output.json (status/outputs/artifacts)
        legacy_failure = merge_legacy_output_json(
            workspace,
            collected,
            run_id=run_id,
            task_id=task.id,
            artifact_store=self.artifact_store,
        )
        if legacy_failure:
            return TaskExecutionResult(False, legacy_failure, log_path=log_path)
        return TaskExecutionResult(
            True,
            "Plugin completed successfully",
            outputs=collected["outputs"],
            artifacts=collected["artifacts"],
            metadata=collected.get("metadata"),
            log_path=log_path,
        )

    @staticmethod
    def _load_manifest(install_path: str) -> PluginManifest:
        path = Path(install_path)
        if not path.is_dir():
            raise ExecutionError(f"Plugin install path is not a directory: {install_path}")
        return load_manifest(path)
