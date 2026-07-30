"""Execute one plugin task in an isolated workspace."""

import json
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.core.config import ExecutionConfig, StorageConfig
from mini_pipeline.database.models import PluginVersion, TaskRun
from mini_pipeline.domain.exceptions import ExecutionError
from mini_pipeline.domain.models import ArtifactRecord
from mini_pipeline.domain.runtime import RuntimeRequest
from mini_pipeline.executor.protocol import DependencyResult, PluginInput, PluginOutput
from mini_pipeline.runtime.registry import RuntimeRegistry


@dataclass
class TaskExecutionResult:
    success: bool
    message: str
    outputs: dict[str, Any] = field(default_factory=dict)
    artifacts: list[ArtifactRecord] = field(default_factory=list)
    log_path: Optional[Path] = None


class TaskExecutor:
    def __init__(
        self,
        *,
        storage: StorageConfig,
        execution: ExecutionConfig,
        runtimes: RuntimeRegistry,
        artifact_store: LocalArtifactStore,
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
        dependencies: dict[str, DependencyResult],
    ) -> TaskExecutionResult:
        workspace = self.storage.workspaces / run_id / task.id
        log_path = self.storage.logs / run_id / f"{task.id}.log"
        if workspace.exists():
            shutil.rmtree(workspace)
        workspace.parent.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(plugin.install_path, workspace)
        self._make_plugin_read_only(workspace)

        protocol_input = PluginInput(
            task_id=task.id,
            workspace=str(workspace.resolve()),
            params=params,
            dependencies=dependencies,
        )
        input_path = workspace / "input.json"
        input_path.write_text(
            protocol_input.model_dump_json(indent=2),
            encoding="utf-8",
        )
        input_path.chmod(0o600)

        entry = (workspace / plugin.entry).resolve()
        if not entry.is_relative_to(workspace.resolve()) or not entry.is_file():
            raise ExecutionError("Installed plugin entry is invalid")
        command = [str(entry)] if os.access(entry, os.X_OK) else ["/bin/sh", str(entry)]
        runtime = self.runtimes.get(plugin.runtime_type)
        with log_path.open("a", encoding="utf-8", buffering=1) as log_stream:
            result = runtime.execute(
                RuntimeRequest(
                    command=command,
                    cwd=workspace,
                    environment={
                        "MINI_PIPELINE_INPUT": str(input_path),
                        "MINI_PIPELINE_OUTPUT": str(workspace / "output.json"),
                        "MINI_PIPELINE_WORKSPACE": str(workspace),
                    },
                    timeout_seconds=self.execution.task_timeout_seconds,
                    log_stream=log_stream,
                )
            )
        if result.timed_out:
            return TaskExecutionResult(False, "Plugin execution timed out", log_path=log_path)
        if result.error:
            return TaskExecutionResult(False, result.error, log_path=log_path)
        if result.exit_code != 0:
            return TaskExecutionResult(
                False,
                f"Plugin exited with code {result.exit_code}",
                log_path=log_path,
            )

        try:
            protocol_output = self._read_output(workspace / "output.json")
        except ExecutionError as exc:
            return TaskExecutionResult(False, str(exc), log_path=log_path)
        if protocol_output.status != "success":
            return TaskExecutionResult(
                False,
                protocol_output.message or "Plugin reported failure",
                outputs=protocol_output.outputs,
                log_path=log_path,
            )

        try:
            artifacts = [
                self._store_artifact(
                    run_id=run_id,
                    task_id=task.id,
                    workspace=workspace,
                    name=item.name,
                    relative_path=item.path,
                )
                for item in protocol_output.artifacts
            ]
        except ExecutionError as exc:
            return TaskExecutionResult(False, str(exc), log_path=log_path)
        return TaskExecutionResult(
            True,
            protocol_output.message,
            outputs=protocol_output.outputs,
            artifacts=artifacts,
            log_path=log_path,
        )

    @staticmethod
    def _read_output(path: Path) -> PluginOutput:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return PluginOutput.model_validate(raw)
        except FileNotFoundError as exc:
            raise ExecutionError("Plugin did not create output.json") from exc
        except (json.JSONDecodeError, UnicodeDecodeError, PydanticValidationError) as exc:
            raise ExecutionError(f"Plugin created invalid output.json: {exc}") from exc

    def _store_artifact(
        self,
        *,
        run_id: str,
        task_id: str,
        workspace: Path,
        name: str,
        relative_path: str,
    ) -> ArtifactRecord:
        source = (workspace / relative_path).resolve()
        if not source.is_relative_to(workspace.resolve()):
            raise ExecutionError(f"Artifact path escapes the task workspace: {relative_path}")
        return self.artifact_store.store(
            run_id=run_id,
            task_id=task_id,
            name=name,
            source=source,
        )

    @staticmethod
    def _make_plugin_read_only(workspace: Path) -> None:
        for path in workspace.rglob("*"):
            if path.is_file():
                mode = path.stat().st_mode
                path.chmod(mode & ~0o222)
        # The directory remains writable so plugins can create protocol output and artifacts.
        workspace.chmod(0o700)
