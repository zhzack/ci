"""Secret params on remote execution paths (runner agent and SSH).

Secret values must reach remote plugins as ``MP_SECRET_<NAME>`` environment
variables without ever being written into the task bundle or the persisted
remote state. Runners fetch them from the authenticated secrets endpoint and
keep them in memory only.
"""

from __future__ import annotations

import io
import json
import shlex
import time
import zipfile
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from mini_pipeline.runner.agent import RunnerClient, execute_task
from mini_pipeline.runner.ssh_executor import build_secret_env_script
from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_personal_machine,
    register_user,
    wait_terminal,
)
from tests.integration.test_platform_features import (
    register_plugin,
)

SECRET = "s3cr3t-remote-value"


def _secret_echo_plugin() -> bytes:
    """Plugin that prints the secret env var and the masked params payload."""
    run_py = (
        "import json, os\n"
        "print(json.dumps({\n"
        "    'env_secret': os.environ.get('MP_SECRET_API_KEY'),\n"
        "}))\n"
        "inp = json.load(open('input.json', encoding='utf-8'))\n"
        "print(json.dumps({'payload_api_key': inp.get('params', {}).get('api_key')}))\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "plugin.yaml",
            "name: secret-echo\nversion: 1.0.0\n"
            "runtime:\n  type: python\n  entry: run.py\n",
        )
        zf.writestr("run.py", run_py)
    return buf.getvalue()


def _setup_remote_secret_run(client: TestClient) -> dict:
    register_user(client, "root")  # throwaway admin
    alice = register_user(client, "alice")
    headers = auth_headers(alice["token"])
    register_plugin(client, _secret_echo_plugin(), headers=headers)
    definition = (
        "name: remote-secret-demo\n"
        "params:\n"
        "  api_key:\n"
        "    secret: true\n"
        "steps:\n"
        "  - {name: go, plugin: secret-echo@1.0.0}\n"
    )
    created = client.post(
        "/api/pipelines", json={"definition": definition}, headers=headers
    )
    assert created.status_code == 201, created.text

    machine = register_personal_machine(client, alice["token"], "agent-box")
    machine_headers = auth_headers(machine["token"])
    submitted = client.post(
        "/api/runs",
        json={
            "pipeline": "remote-secret-demo",
            "params": {"api_key": SECRET},
            "machine": machine["machine"]["id"],
        },
        headers=headers,
    )
    assert submitted.status_code == 202, submitted.text
    run_id = submitted.json()["id"]

    run = _wait_queued(client, run_id, headers)
    return {
        "headers": headers,
        "token": alice["token"],
        "run_id": run_id,
        "task_id": run["tasks"][0]["id"],
        "machine_headers": machine_headers,
        "machine": machine,
    }


def _wait_queued(client: TestClient, run_id: str, headers: dict) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}", headers=headers).json()
        if run["tasks"][0]["status"] == "QUEUED":
            return run
        time.sleep(0.05)
    raise AssertionError("task never reached QUEUED")


def test_runner_fetches_secrets_and_bundle_stays_clean(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        ctx = _setup_remote_secret_run(client)
        headers = ctx["headers"]
        machine_headers = ctx["machine_headers"]
        task_id = ctx["task_id"]

        # Run API keeps exposing the mask only.
        run = client.get(f"/api/runs/{ctx['run_id']}", headers=headers).json()
        assert run["params"]["api_key"] == "******"
        assert SECRET not in json.dumps(run)

        # The owning machine can read the real values right before execution.
        secrets = client.get(
            f"/api/runner/tasks/{task_id}/secrets", headers=machine_headers
        )
        assert secrets.status_code == 200, secrets.text
        assert secrets.json() == {"secrets": {"api_key": SECRET}}

        # ... but another machine of the same user cannot.
        other = register_personal_machine(client, ctx["token"], "other-box")
        other_headers = auth_headers(other["token"])
        denied = client.get(
            f"/api/runner/tasks/{task_id}/secrets", headers=other_headers
        )
        assert denied.status_code == 403, denied.text

        # Neither the persisted remote state nor the bundle carries the value.
        state_file = (
            client.app.state.services.settings.storage.root
            / "remote_state"
            / f"{task_id}.json"
        )
        assert state_file.is_file()
        assert SECRET not in state_file.read_text(encoding="utf-8")

        bundle = client.get(
            f"/api/runner/tasks/{task_id}/bundle", headers=machine_headers
        )
        assert bundle.status_code == 200, bundle.text
        with zipfile.ZipFile(io.BytesIO(bundle.content)) as zf:
            for name in zf.namelist():
                assert SECRET not in zf.read(name).decode("utf-8", errors="ignore")

        # Simulate the agent: claim, then report success.
        claim = client.post("/api/runner/tasks/claim", headers=machine_headers)
        assert claim.status_code == 200, claim.text
        report = client.post(
            f"/api/runner/tasks/{task_id}/status",
            json={"status": "SUCCESS", "message": "Runner completed successfully"},
            headers=machine_headers,
        )
        assert report.status_code == 200, report.text
        assert wait_terminal(client, ctx["run_id"], headers=headers)["status"] == "SUCCESS"

        # Terminal tasks no longer expose the run's secrets.
        after = client.get(
            f"/api/runner/tasks/{task_id}/secrets", headers=machine_headers
        )
        assert after.status_code == 200, after.text
        assert after.json() == {"secrets": {}}


def test_runner_secrets_rebuilt_from_db_after_restart(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        ctx = _setup_remote_secret_run(client)
        services = client.app.state.services

        # Simulate an API restart: memory registry gone, state file survives.
        services.engine.remote_inputs.clear()

        rebuilt = services.engine.remote_inputs_for(ctx["task_id"])
        assert rebuilt is not None
        assert rebuilt.secret_values == {"api_key": SECRET}

        secrets = client.get(
            f"/api/runner/tasks/{ctx['task_id']}/secrets",
            headers=ctx["machine_headers"],
        )
        assert secrets.status_code == 200, secrets.text
        assert secrets.json() == {"secrets": {"api_key": SECRET}}


def test_runner_client_secrets_compat() -> None:
    """Agents tolerate older servers without the secrets endpoint."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/secrets"):
            return httpx.Response(200, json={"secrets": {"api_key": SECRET}})
        return httpx.Response(404)

    client = RunnerClient("http://test", "mrt_token")
    client._http = httpx.Client(
        base_url="http://test", transport=httpx.MockTransport(handler)
    )
    assert client.fetch_secrets("t1") == {"api_key": SECRET}
    client._http = httpx.Client(
        base_url="http://test",
        transport=httpx.MockTransport(lambda _request: httpx.Response(404)),
    )
    assert client.fetch_secrets("t1") == {}


def test_agent_injects_secret_env_without_persisting(tmp_path) -> None:
    """execute_task() fetches secrets and injects MP_SECRET_* into the plugin."""

    class FakeClient:
        def __init__(self) -> None:
            self.logs: list[str] = []
            self.reported: list[dict] = []
            self.secret_calls = 0

        def download_bundle(self, task_id: str, destination: Path) -> Path:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr(
                    "plugin.yaml",
                    "name: secret-echo\nversion: 1.0.0\n"
                    "runtime:\n  type: python\n  entry: run.py\n",
                )
                zf.writestr(
                    "run.py",
                    "import os\n"
                    "print('SECRET_ENV=' + str(os.environ.get('MP_SECRET_API_KEY')),"
                    " flush=True)\n",
                )
            destination.write_bytes(buf.getvalue())
            return destination

        def fetch_secrets(self, task_id: str) -> dict[str, str]:
            self.secret_calls += 1
            return {"api_key": SECRET}

        def push_logs(self, task_id: str, chunk: str) -> None:
            self.logs.append(chunk)

        def upload_artifacts(self, task_id, artifacts) -> None:
            pass

        def report_status(self, task_id, status, message="", outputs=None) -> None:
            self.reported.append({"status": status, "message": message})

    client = FakeClient()
    workspace_root = tmp_path / "runner-ws"
    workspace_root.mkdir()
    execute_task(client, {"task_id": "task-1", "timeout_seconds": 30}, workspace_root)

    assert client.secret_calls == 1
    assert client.reported and client.reported[-1]["status"] == "SUCCESS"
    assert SECRET in "".join(client.logs)

    # Values are never written to the extracted workspace either.
    for path in (workspace_root / "task-1").rglob("*"):
        if path.is_file():
            assert SECRET not in path.read_text(encoding="utf-8", errors="ignore")


def test_ssh_secret_env_script_quoting() -> None:
    script = build_secret_env_script({"api_key": "a b'c", "token": "x$y"})
    lines = [line for line in script.splitlines() if line]
    quoted_value = shlex.quote("a b'c")
    assert lines == [
        f"export MP_SECRET_API_KEY={quoted_value}",
        f"export MP_SECRET_TOKEN={shlex.quote('x$y')}",
    ]
    # Quoting survives a POSIX shell round-trip.
    for line in lines:
        tokens = shlex.split(line)
        assert tokens[0] == "export"
        key, _, value = tokens[1].partition("=")
        assert key.startswith("MP_SECRET_")
        assert value
    assert build_secret_env_script({}) == ""
    assert build_secret_env_script(None) == ""
