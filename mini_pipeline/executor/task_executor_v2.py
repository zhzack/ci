"""v2 Task Executor — Resource-based contract execution.

Implements the full lifecycle described in the v2 protocol:
  Resolve Plugin → Resolve Inputs → Download Resources → Create Workspace
  → Generate Context → Execute → Collect Logs → Collect Outputs
  → Generate Artifacts → Finish Task
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mini_pipeline.core.config import ExecutionConfig, StorageConfig
from mini_pipeline.database.models import PluginVersion, TaskRun
from mini_pipeline.domain.contract import PluginManifestV2, ResourceSource
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord
from mini_pipeline.domain.runtime import RuntimeRequest
from mini_pipeline.executor.collector import collect_outputs, read_error_json
from mini_pipeline.executor.context import create_workspace, resolve_inputs, write_context
from mini_pipeline.plugin.manifest_v2 import load_manifest_v2
from mini_pipeline.runtime.registry import RuntimeRegistry


@dataclass
class TaskExecutionResultV2:
    success: bool
    message: str = ""
    outputs: dict[str, Any] = field(default_factory=dict)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] | None = None
    log_path: Path | None = None


class TaskExecutorV2:
    def __init__(
        self,
        *,
        storage: StorageConfig,
        execution: ExecutionConfig,
        runtimes: RuntimeRegistry,
    ) -> None:
        self.storage = storage
        self.execution = execution
        self.runtimes = runtimes

    def execute(
        self,
        *,
        run_id: str,
        task: TaskRun,
        plugin: PluginVersion,
        params: dict[str, Any],
        dependencies: dict[str, Any],
        uploads: dict[str, Path] | None = None,
    ) -> TaskExecutionResultV2:
        workspace = self.storage.workspaces / run_id / task.id
        log_path = self.storage.logs / run_id / f"{task.id}.log"
        if workspace.exists():
            shutil.rmtree(workspace)
        workspace.parent.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        # Load contract
        contract_source = self._load_contract(plugin.install_path)
        shutil.copytree(plugin.install_path, workspace)

        # Prepare workspace
        create_workspace(workspace)
        write_context(
            workspace,
            pipeline_id=run_id,
            task_id=task.id,
            task_name=task.step_name,
        )

        # Resolve inputs
        resolve_inputs(
            workspace,
            contract_source.contract,
            params=params,
            dependencies=dependencies,
            uploads=uploads,
        )

        # Execute
        entry = (workspace / plugin.entry).resolve()
        runtime_type = plugin.runtime_type or "shell"
        runtime = self.runtimes.get(runtime_type)
        if runtime_type == "python":
            cmd = [str(entry)]
        elif runtime_type == "node":
            cmd = [str(entry)]
        elif runtime_type == "executable":
            cmd = [str(entry)]
        else:
            cmd = [str(entry)] if os.access(entry, os.X_OK) else ["/bin/sh", str(entry)]
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
                )
            )

        if result.timed_out:
            return TaskExecutionResultV2(
                False, "Plugin execution timed out", log_path=log_path
            )
        if result.error:
            return TaskExecutionResultV2(False, result.error, log_path=log_path)

        # Check error.json
        error_info = read_error_json(workspace)
        if error_info and result.exit_code != 0:
            msg = error_info.get("message") or f"Plugin exited with code {result.exit_code}"
            return TaskExecutionResultV2(
                False, msg, log_path=log_path
            )

        if result.exit_code != 0:
            return TaskExecutionResultV2(
                False,
                f"Plugin exited with code {result.exit_code}",
                log_path=log_path,
            )

        # Collect outputs
        collected = collect_outputs(
            workspace,
            contract_source.contract,
            run_id=run_id,
            task_id=task.id,
        )
        return TaskExecutionResultV2(
            True,
            "Plugin completed successfully",
            outputs=collected["outputs"],
            artifacts=collected["artifacts"],
            metadata=collected.get("metadata"),
            log_path=log_path,
        )

    @staticmethod
    def _load_contract(install_path: str) -> PluginManifestV2:
        path = Path(install_path)
        if not path.is_dir():
            raise ExecutionError(f"Plugin install path is not a directory: {install_path}")
        return load_manifest_v2(path)
