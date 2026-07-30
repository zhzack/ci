import shutil
import subprocess
import time
from pathlib import Path

import pytest


def wait_for_completion(client, run_id: str) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = client.get(f"/api/runs/{run_id}").json()
        if result["status"] in {"SUCCESS", "FAILED"}:
            return result
        time.sleep(0.05)
    raise AssertionError("Pipeline did not finish")


@pytest.mark.skipif(shutil.which("git") is None, reason="git is required")
def test_git_registration_to_artifact_download(client, tmp_path: Path) -> None:
    repository = tmp_path / "git-plugin"
    repository.mkdir()
    (repository / "plugin.yaml").write_text(
        """
name: git-demo
version: 1.0.0
description: local git integration plugin
runtime: {type: shell}
entry: run.sh
inputs:
  value: {type: string, required: true}
outputs:
  result: {type: string}
""",
        encoding="utf-8",
    )
    (repository / "run.sh").write_text(
        """#!/bin/sh
set -eu
python3 - <<'PY'
import json
from pathlib import Path
value = json.loads(Path('input.json').read_text())['params']['value']
Path('artifact.txt').write_text(value)
Path('output.json').write_text(json.dumps({
    'status': 'success',
    'outputs': {'result': value},
    'artifacts': [{'name': 'artifact.txt', 'path': 'artifact.txt'}],
}))
print('git plugin executed')
PY
""",
        encoding="utf-8",
    )
    (repository / "run.sh").chmod(0o755)
    subprocess.run(["git", "init", "-q", str(repository)], check=True)
    subprocess.run(["git", "-C", str(repository), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "-c",
            "user.name=Mini Pipeline Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-qm",
            "initial",
        ],
        check=True,
    )

    registered = client.post(
        "/api/plugins/register",
        json={"source": {"type": "git", "url": str(repository)}},
    )
    assert registered.status_code == 201, registered.text

    definition = """
name: git-end-to-end
steps:
  - name: execute
    plugin: git-demo@1.0.0
    with:
      value: "${{ params.value }}"
"""
    created = client.post("/api/pipelines", json={"definition": definition})
    assert created.status_code == 201, created.text
    submitted = client.post(
        "/api/runs",
        json={"pipeline": "git-end-to-end", "params": {"value": "verified"}},
    )
    assert submitted.status_code == 202, submitted.text

    run = wait_for_completion(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS"
    assert run["tasks"][0]["outputs"] == {"result": "verified"}
    assert "git plugin executed" in client.get(f"/api/runs/{run['id']}/tasks/execute/log").text
    artifact_id = run["tasks"][0]["artifacts"][0]["id"]
    downloaded = client.get(f"/api/runs/{run['id']}/artifacts/{artifact_id}")
    assert downloaded.content == b"verified"
