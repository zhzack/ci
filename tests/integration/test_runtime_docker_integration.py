import io
import time
import zipfile

from mini_pipeline.domain.runtime import RuntimeResult
from mini_pipeline.runtime.base import ProcessRunner


def wait_for_run(client, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/api/runs/{run_id}")
        assert res.status_code == 200, res.text
        payload = res.json()
        if payload["status"] in {"SUCCESS", "FAILED"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not finish within {timeout}s")


def upload_plugin(client, *, name: str, manifest: str, script: str) -> None:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("plugin.yaml", manifest)
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        archive.writestr(info, script)

    response = client.post(
        "/api/plugins/upload",
        files={"file": (f"{name}.zip", io.BytesIO(output.getvalue()), "application/zip")},
    )
    assert response.status_code == 201, response.text


def test_docker_runtime_pipeline_execution(client, monkeypatch) -> None:
    # Test pipeline with a docker runtime step using mocked docker command execution
    docker_manifest = """
name: docker-plugin
version: 1.0.0
description: Plugin running in docker
runtime:
  type: docker
  image: python:3.11-alpine
  entry: run.sh
"""
    docker_script = """#!/bin/sh
set -eu
echo "running inside container"
"""

    upload_plugin(
        client,
        name="docker-plugin",
        manifest=docker_manifest,
        script=docker_script,
    )

    pipeline_yaml = """
name: docker-test-pipeline
steps:
  - name: container_step
    plugin: docker-plugin@1.0.0
"""

    create_res = client.post("/api/pipelines", json={"definition": pipeline_yaml})
    assert create_res.status_code == 201, create_res.text
    pipeline_id = create_res.json()["id"]

    # Mock docker binary lookup and mock ProcessRunner.run for container execution
    monkeypatch.setattr(
        "mini_pipeline.runtime.docker.find_docker_binary",
        lambda: "/usr/bin/docker",
    )

    def mock_process_run(self, command, request):
        assert command[0] == "/usr/bin/docker"
        assert "python:3.11-alpine" in command
        # Write dummy output.json into workspace
        output_file = request.cwd / "output.json"
        payload = '{"status": "success", "outputs": {"msg": "docker done"}}'
        output_file.write_text(payload, encoding="utf-8")
        if request.log_stream:
            request.log_stream.write("container executed successfully\n")
        return RuntimeResult(exit_code=0)

    monkeypatch.setattr(ProcessRunner, "run", mock_process_run)

    run = client.post("/api/runs", json={"pipeline": pipeline_id}).json()
    res = wait_for_run(client, run["id"])
    assert res["status"] == "SUCCESS"
    assert res["tasks"][0]["outputs"]["msg"] == "docker done"
