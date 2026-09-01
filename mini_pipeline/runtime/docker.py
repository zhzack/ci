"""Docker container runtime.

Executes the plugin entry inside the container image declared in the
plugin manifest:

    runtime:
      type: docker
      image: alpine:3.19
      entry: run.sh

The workspace (plugin files plus the generated context/inputs) is
bind-mounted at ``/workspace`` and becomes the container working
directory, so a docker plugin observes exactly the same Zero-SDK
workspace layout as any other runtime. The ``docker`` CLI binary must
be available on the server; no Docker SDK dependency is introduced.

On timeout or cancellation the ProcessRunner kills the CLI process
tree; because terminating the client does not always reap the attached
container, we follow up with a best-effort ``docker rm -f``.
"""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.plugin.manifest import load_manifest
from mini_pipeline.runtime.base import ProcessRunner

# In-container mount point of the plugin workspace.
_WORKSPACE_MOUNT = "/workspace"

# Environment variables produced by the executor that embed host paths;
# they are rewritten to the in-container workspace location.
_REMAPPED_ENV_KEYS = {
    "PIPELINE_WORKSPACE": _WORKSPACE_MOUNT,
    "MINI_PIPELINE_WORKSPACE": _WORKSPACE_MOUNT,
    "PIPELINE_CONTEXT": f"{_WORKSPACE_MOUNT}/context.json",
}


def find_docker_binary() -> str | None:
    return shutil.which("docker")


def force_remove_container(binary: str, container: str) -> None:
    """Best-effort removal of a container whose CLI client was killed."""
    try:
        subprocess.run(
            [binary, "rm", "-f", container],
            capture_output=True,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


class DockerRuntime:
    runtime_type = "docker"

    def __init__(self) -> None:
        self._runner = ProcessRunner()

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        binary = find_docker_binary()
        if binary is None:
            return RuntimeResult(
                exit_code=-1,
                error="Docker executable not found on the server; "
                "install Docker or use a non-docker runtime",
            )
        try:
            image = self._resolve_image(request.cwd)
        except ValidationError as exc:
            return RuntimeResult(exit_code=-1, error=str(exc))

        container = f"mp-task-{uuid.uuid4().hex[:12]}"
        command = [
            binary, "run", "--rm", "--name", container,
            "-v", f"{request.cwd}:{_WORKSPACE_MOUNT}",
            "-w", _WORKSPACE_MOUNT,
        ]
        for key, value in request.environment.items():
            command.extend(["-e", f"{key}={_REMAPPED_ENV_KEYS.get(key, value)}"])
        command.append(image)
        command.append(self._entry_relative(request))

        result = self._runner.run(command, request)
        if result.timed_out or result.cancelled:
            force_remove_container(binary, container)
        return result

    @staticmethod
    def _resolve_image(workspace: Path) -> str:
        """Read the container image from the workspace copy of plugin.yaml."""
        try:
            manifest = load_manifest(workspace)
        except ValidationError as exc:
            raise ValidationError(
                f"Docker runtime requires a valid plugin.yaml in the workspace: {exc}"
            ) from exc
        image = (manifest.runtime.image or "").strip()
        if not image:
            raise ValidationError(
                "Docker runtime requires runtime.image in plugin.yaml"
            )
        return image

    @staticmethod
    def _entry_relative(request: RuntimeRequest) -> str:
        """Entry path as seen from inside the container."""
        entry = Path(request.command[0])
        try:
            relative = entry.relative_to(request.cwd)
        except ValueError:
            return entry.name
        return relative.as_posix()
