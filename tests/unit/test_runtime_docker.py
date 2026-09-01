import io
from pathlib import Path
from typing import Any

import pytest

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.runtime import docker as docker_module
from mini_pipeline.runtime.docker import DockerRuntime


def _write_plugin(tmp_path: Path, manifest: str, entry_body: str = "echo hi\n") -> Path:
    (tmp_path / "plugin.yaml").write_text(manifest, encoding="utf-8")
    entry = tmp_path / "run.sh"
    entry.write_text(f"#!/bin/sh\n{entry_body}", encoding="utf-8")
    return entry


def _request(entry: Path, cwd: Path) -> RuntimeRequest:
    return RuntimeRequest(
        command=[str(entry)],
        cwd=cwd,
        environment={
            "PIPELINE_WORKSPACE": str(cwd),
            "PIPELINE_CONTEXT": str(cwd / "context.json"),
            "MY_VAR": "hello",
        },
        timeout_seconds=10,
        log_stream=io.StringIO(),
    )


class FakeRunner:
    def __init__(self, result: RuntimeResult | None = None) -> None:
        self.commands: list[list[str]] = []
        self.result = result or RuntimeResult(exit_code=0)

    def run(self, command: list[str], request: RuntimeRequest) -> RuntimeResult:
        self.commands.append(command)
        return self.result


@pytest.fixture()
def fake_docker(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Pretend the docker CLI exists and record any force-remove calls."""
    calls: list[str] = []
    monkeypatch.setattr(docker_module, "find_docker_binary", lambda: "/usr/bin/docker")

    def fake_remove(binary: str, container: str) -> None:
        calls.append(f"{binary} {container}")

    monkeypatch.setattr(docker_module, "force_remove_container", fake_remove)
    return calls


def test_docker_runtime_builds_run_command(
    tmp_path: Path, fake_docker: list[str]
) -> None:
    entry = _write_plugin(
        tmp_path,
        "name: demo\nversion: 1.0.0\n"
        "runtime:\n  type: docker\n  image: alpine:3.19\n  entry: run.sh\n",
    )
    runtime = DockerRuntime()
    fake = FakeRunner()
    runtime._runner = fake  # type: ignore[assignment]

    result = runtime.execute(_request(entry, tmp_path))

    assert result.exit_code == 0
    command = fake.commands[0]
    assert command[0] == "/usr/bin/docker"
    assert command[1:4] == ["run", "--rm", "--name"]
    assert command[4].startswith("mp-task-")
    # Workspace bind mount + workdir.
    mount_index = command.index("-v")
    assert command[mount_index + 1] == f"{tmp_path}:/workspace"
    assert command[command.index("-w") + 1] == "/workspace"
    # Host-path env vars are remapped into the container.
    env_args = [c for c in command if c.startswith(("PIPELINE_", "MINI_", "MY_VAR="))]
    assert "PIPELINE_WORKSPACE=/workspace" in env_args
    assert "PIPELINE_CONTEXT=/workspace/context.json" in env_args
    assert "MY_VAR=hello" in env_args
    assert not any(str(tmp_path) in c for c in env_args)
    # Image then entry relative to the workspace root.
    assert command[-2:] == ["alpine:3.19", "run.sh"]


def test_docker_runtime_requires_image(tmp_path: Path, fake_docker: list[str]) -> None:
    entry = _write_plugin(
        tmp_path,
        "name: demo\nversion: 1.0.0\n"
        "runtime:\n  type: docker\n  entry: run.sh\n",
    )
    runtime = DockerRuntime()
    fake = FakeRunner()
    runtime._runner = fake  # type: ignore[assignment]

    result = runtime.execute(_request(entry, tmp_path))

    assert result.exit_code == -1
    assert "runtime.image" in (result.error or "")
    assert fake.commands == []


def test_docker_runtime_without_docker_binary(tmp_path: Path) -> None:
    entry = _write_plugin(
        tmp_path,
        "name: demo\nversion: 1.0.0\n"
        "runtime:\n  type: docker\n  image: alpine:3.19\n  entry: run.sh\n",
    )
    monkey_docker: dict[str, Any] = {}
    original = docker_module.find_docker_binary
    docker_module.find_docker_binary = lambda: None
    try:
        result = DockerRuntime().execute(_request(entry, tmp_path))
    finally:
        docker_module.find_docker_binary = original
    _ = monkey_docker

    assert result.exit_code == -1
    assert "Docker executable not found" in (result.error or "")


def test_docker_runtime_forces_container_removal_on_timeout(
    tmp_path: Path, fake_docker: list[str]
) -> None:
    entry = _write_plugin(
        tmp_path,
        "name: demo\nversion: 1.0.0\n"
        "runtime:\n  type: docker\n  image: alpine:3.19\n  entry: run.sh\n",
    )
    runtime = DockerRuntime()
    fake = FakeRunner(RuntimeResult(exit_code=-1, timed_out=True, error="Execution timed out"))
    runtime._runner = fake  # type: ignore[assignment]

    result = runtime.execute(_request(entry, tmp_path))

    assert result.timed_out is True
    assert len(fake.commands) == 1
    container = fake.commands[0][fake.commands[0].index("--name") + 1]
    assert fake_docker == [f"/usr/bin/docker {container}"]


def test_docker_runtime_no_cleanup_on_success(
    tmp_path: Path, fake_docker: list[str]
) -> None:
    entry = _write_plugin(
        tmp_path,
        "name: demo\nversion: 1.0.0\n"
        "runtime:\n  type: docker\n  image: alpine:3.19\n  entry: run.sh\n",
    )
    runtime = DockerRuntime()
    runtime._runner = FakeRunner()  # type: ignore[assignment]

    result = runtime.execute(_request(entry, tmp_path))

    assert result.exit_code == 0
    assert fake_docker == []
