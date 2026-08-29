"""SSH push-executor: run tasks on machines the platform connects OUT to.

For machines registered with ``connection_type='ssh'`` the server itself
reaches the target over SSH (host/port/username/password-key are stored in
the encrypted machine credentials): the task bundle is uploaded via SFTP,
extracted and executed remotely, logs stream back live, and the ``output/``
directory is pulled back and collected with the same collector used for
local runs.

Scope (documented in docs/design-multi-runner.md): POSIX SSH targets
(Linux/macOS) with shell/python/node runtimes. Windows SSH targets are not
supported yet. No per-task privilege elevation happens — the plugin runs as
the SSH login user.
"""

from __future__ import annotations

import io
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import paramiko

from mini_pipeline.account.crypto import decrypt_credentials
from mini_pipeline.core.config import Settings
from mini_pipeline.database.account_repositories import MachineRepository
from mini_pipeline.database.models import Machine, PluginVersion, TaskRun
from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.executor.collector import (
    collect_outputs,
    merge_legacy_output_json,
)
from mini_pipeline.plugin.manifest import load_manifest
from mini_pipeline.runner.bundle import build_task_bundle

_POLL = 0.1


class SshExecutor:
    def __init__(
        self,
        *,
        machine_repository: MachineRepository,
        settings: Settings,
        artifact_store: Any | None = None,
    ) -> None:
        self.machines = machine_repository
        self.settings = settings
        self.artifact_store = artifact_store

    # ------------------------------------------------------------------
    # dispatch helpers
    # ------------------------------------------------------------------

    def handles(self, machine_id: str) -> bool:
        try:
            machine = self.machines.get(machine_id)
        except Exception:
            return False
        return machine.connection_type == "ssh"

    def _connect(self, machine: Machine) -> tuple[paramiko.SSHClient, dict[str, Any]]:
        connection = self._connection(machine)
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs: dict[str, Any] = {
            "hostname": connection["host"],
            "port": int(connection.get("port", 22)),
            "username": connection["username"],
            "timeout": 10,
            "allow_agent": False,
            "look_for_keys": False,
        }
        if connection.get("password"):
            connect_kwargs["password"] = connection["password"]
        if connection.get("private_key"):
            pkey = paramiko.RSAKey.from_private_key(
                io.StringIO(connection["private_key"])
            )
            connect_kwargs["pkey"] = pkey
        client.connect(**connect_kwargs)
        return client, connection

    def _connection(self, machine: Machine) -> dict[str, Any]:
        if not machine.credentials:
            raise ValidationError(
                f"Machine {machine.name!r} has no stored connection details"
            )
        if not self.settings.security.secret_key:
            raise ValidationError(
                "security.secret_key is not configured; cannot decrypt machine credentials"
            )
        connection = decrypt_credentials(machine.credentials, self.settings.security.secret_key)
        if not connection or "host" not in connection:
            raise ValidationError(
                f"Machine {machine.name!r} is not configured as an SSH machine"
            )
        return connection

    def test_connection(self, machine: Machine) -> dict[str, Any]:
        started = time.monotonic()
        try:
            client, _ = self._connect(machine)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        try:
            _ = client.exec_command("echo ok", timeout=5)
            return {"ok": True, "latency_ms": round((time.monotonic() - started) * 1000)}
        finally:
            client.close()

    # ------------------------------------------------------------------
    # execution
    # ------------------------------------------------------------------

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
    ) -> Any:
        """Execute one task on the remote SSH host. Returns TaskExecutionResult."""
        from mini_pipeline.domain.states import TaskStatus
        from mini_pipeline.executor.task_executor import TaskExecutionResult

        machine = self.machines.get(task.machine_id)
        manifest = load_manifest(Path(plugin.install_path))
        log_path = self.settings.storage.logs / run_id / f"{task.id}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)

        bundle = build_task_bundle(
            task=task,
            plugin=plugin,
            resolved_params=params,
            dependencies=dependencies,
            uploads=uploads,
            temp_root=self.settings.storage.temp,
            run_id=run_id,
            run_params=run_params,
        )

        remote_root = f"~/mini-pipeline-tasks/{task.id}"
        client = None
        temp_dir: Path | None = None
        try:
            client, _ = self._connect(machine)
            sftp = client.open_sftp()
            sftp.put(str(bundle), f"mini-pipeline-tasks-{task.id}.zip")

            def _run(command: str, timeout: float = 30) -> int:
                _, stdout, _ = client.exec_command(command, timeout=timeout)
                code = stdout.channel.recv_exit_status()
                _ = stdout.read()
                return code

            extract_cmd = (
                f"cd $HOME && mkdir -p mini-pipeline-tasks/{task.id} && "
                f"(command -v unzip >/dev/null 2>&1 "
                f"&& unzip -o -q mini-pipeline-tasks-{task.id}.zip"
                f" -d mini-pipeline-tasks/{task.id} "
                f"|| python3 -m zipfile -e mini-pipeline-tasks-{task.id}.zip"
                f" mini-pipeline-tasks/{task.id})"
            )
            if _run(extract_cmd) != 0:
                return TaskExecutionResult(
                    False,
                    "Remote host cannot extract the task bundle (needs unzip or python3)",
                    log_path=log_path,
                )

            entry = (Path(plugin.install_path) / manifest.entry).name
            runtime_type = manifest.runtime.type or "shell"
            if runtime_type == "shell":
                remote_cmd = (
                    f"cd $HOME/mini-pipeline-tasks/{task.id} && chmod +x {entry} && "
                    f"(command -v bash >/dev/null 2>&1 && bash {entry} || sh {entry})"
                )
            elif runtime_type == "python":
                remote_cmd = (
                    f"cd $HOME/mini-pipeline-tasks/{task.id} && "
                    f"(command -v python3 >/dev/null 2>&1"
                    f" && python3 -u {entry} || python -u {entry})"
                )
            elif runtime_type == "node":
                remote_cmd = f"cd $HOME/mini-pipeline-tasks/{task.id} && node {entry}"
            else:
                return TaskExecutionResult(
                    False,
                    f"Runtime {runtime_type!r} is not supported on SSH machines",
                    log_path=log_path,
                )

            result = self._stream_execute(
                client,
                remote_cmd,
                log_path,
                task_id=task.id,
                remote_root=f"mini-pipeline-tasks/{task.id}",
                timeout_seconds=int(self.settings.execution.task_timeout_seconds),
                cancel_event=cancel_event,
            )
            _ = remote_root

            # Pull output/ (and legacy output.json) back, then collect locally
            # with the exact same collector the server uses.
            temp_dir = Path(tempfile.mkdtemp(prefix="mp_ssh_out_"))
            self._pull_dir(sftp, f"mini-pipeline-tasks/{task.id}/output", temp_dir / "output")
            try:
                with sftp.open(f"mini-pipeline-tasks/{task.id}/output.json", "r") as remote_file:
                    (temp_dir / "output.json").write_bytes(remote_file.read())
            except Exception:
                pass

            collected = collect_outputs(
                temp_dir,
                manifest.contract,
                run_id=run_id,
                task_id=task.id,
                artifact_store=self.artifact_store,
            )
            legacy_failure = merge_legacy_output_json(
                temp_dir,
                collected,
                run_id=run_id,
                task_id=task.id,
                artifact_store=self.artifact_store,
            )
            if legacy_failure:
                return TaskExecutionResult(False, legacy_failure, log_path=log_path)

            if result["cancelled"]:
                return TaskExecutionResult(
                    False, "Cancelled", log_path=log_path, cancelled=True
                )
            if result["timed_out"]:
                return TaskExecutionResult(
                    False, "Plugin execution timed out", log_path=log_path
                )
            if result["exit_code"] != 0:
                return TaskExecutionResult(
                    False,
                    f"Plugin exited with code {result['exit_code']}",
                    log_path=log_path,
                )
            return TaskExecutionResult(
                True,
                "SSH machine completed successfully",
                outputs=collected.get("outputs", {}),
                artifacts=collected.get("artifacts", []),
                log_path=log_path,
            )
        except Exception as exc:
            return TaskExecutionResult(False, f"SSH execution error: {exc}", log_path=log_path)
        finally:
            if client is not None:
                try:
                    _ = client.exec_command(
                        f"rm -rf $HOME/mini-pipeline-tasks/{task.id} "
                        f"$HOME/mini-pipeline-tasks-{task.id}.zip",
                        timeout=10,
                    )
                except Exception:
                    pass
                client.close()
            if temp_dir is not None:
                shutil.rmtree(temp_dir, ignore_errors=True)
            _ = TaskStatus

    # ------------------------------------------------------------------

    def _stream_execute(
        self,
        client: paramiko.SSHClient,
        command: str,
        log_path: Path,
        *,
        task_id: str,
        remote_root: str,
        timeout_seconds: int,
        cancel_event=None,
    ) -> dict[str, Any]:
        transport = client.get_transport()
        assert transport is not None
        channel = transport.open_session()
        channel.get_pty()
        channel.settimeout(_POLL)
        channel.exec_command(command)
        deadline = time.monotonic() + timeout_seconds
        timed_out = False
        cancelled = False
        with log_path.open("a", encoding="utf-8", buffering=1) as sink:
            while True:
                while channel.recv_ready():
                    chunk = channel.recv(4096).decode("utf-8", errors="replace")
                    sink.write(chunk.replace("\r\n", "\n").replace("\r", "\n"))
                if channel.exit_status_ready():
                    while channel.recv_ready():
                        chunk = channel.recv(4096).decode("utf-8", errors="replace")
                        sink.write(chunk.replace("\r\n", "\n").replace("\r", "\n"))
                    break
                if cancel_event is not None and cancel_event.is_set():
                    cancelled = True
                    self._kill_remote(client, task_id, remote_root)
                    break
                if time.monotonic() >= deadline:
                    timed_out = True
                    self._kill_remote(client, task_id, remote_root)
                    break
                time.sleep(_POLL)
        exit_code = -1
        try:
            exit_code = channel.recv_exit_status()
        except Exception:
            pass
        return {"exit_code": exit_code, "timed_out": timed_out, "cancelled": cancelled}

    @staticmethod
    def _kill_remote(client: paramiko.SSHClient, task_id: str, remote_root: str) -> None:
        try:
            _ = client.exec_command(
                f"pkill -f 'mini-pipeline-tasks/{task_id}' 2>/dev/null; "
                f"rm -rf $HOME/{remote_root} $HOME/mini-pipeline-tasks-{task_id}.zip",
                timeout=10,
            )
        except Exception:
            pass

    def _pull_dir(self, sftp, remote_dir: str, local_dir: Path) -> None:
        """Recursively download a remote directory via SFTP."""

        def _walk(remote: str, local: Path) -> None:
            local.mkdir(parents=True, exist_ok=True)
            for entry in sftp.listdir_attr(remote):
                remote_path = f"{remote}/{entry.filename}"
                local_path = local / entry.filename
                import stat as stat_module

                if stat_module.S_ISDIR(entry.st_mode):
                    _walk(remote_path, local_path)
                else:
                    sftp.get(remote_path, str(local_path))

        try:
            sftp.listdir_attr(remote_dir)
        except Exception:
            return  # no output produced
        _walk(remote_dir, local_dir)
