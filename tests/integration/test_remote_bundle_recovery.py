"""Crash recovery for remote task bundles.

A runner claims QUEUED tasks and downloads a workspace bundle. The resolved
inputs used to live only in the engine's memory, so an API restart between
"task parked" and "runner claims" turned the task into a 404 zombie. The
engine now persists the inputs to ``storage/remote_state/<task_id>.json`` and
rebuilds them on demand.
"""

from __future__ import annotations

import io
import time
import zipfile

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    make_pipeline,
    register_personal_machine,
    register_user,
    wait_terminal,
)
from tests.integration.test_platform_features import (
    echo_plugin,
    register_plugin,
)


def _wait_queued(client: TestClient, run_id: str, headers: dict) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}", headers=headers).json()
        if run["tasks"][0]["status"] == "QUEUED":
            return run
        time.sleep(0.05)
    raise AssertionError("task never reached QUEUED")


def test_bundle_survives_engine_memory_loss(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        services = client.app.state.services
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, echo_plugin(), headers=alice_headers)
        make_pipeline(client, alice_headers, "recovery-demo")

        machine = register_personal_machine(client, alice["token"], "agent-box")
        machine_headers = auth_headers(machine["token"])

        submitted = client.post(
            "/api/runs",
            json={
                "pipeline": "recovery-demo",
                "params": {"greeting": "survive-restart"},
                "machine": machine["machine"]["id"],
            },
            headers=alice_headers,
        )
        assert submitted.status_code == 202, submitted.text
        run_id = submitted.json()["id"]

        run = _wait_queued(client, run_id, alice_headers)
        task_id = run["tasks"][0]["id"]

        # The engine durably records the resolved inputs while parking the task.
        state_file = services.settings.storage.root / "remote_state" / f"{task_id}.json"
        assert state_file.is_file(), state_file

        # Simulate an API restart: in-memory registry is gone, DB rows remain.
        services.engine.remote_inputs.clear()

        # The rebuild restores run-level params and the plugin from disk + DB.
        rebuilt = services.engine.remote_inputs_for(task_id)
        assert rebuilt is not None
        assert rebuilt.run_params.get("greeting") == "survive-restart"
        assert rebuilt.plugin.name == "echo"
        assert rebuilt.machine_id == machine["machine"]["id"]

        claim = client.post("/api/runner/tasks/claim", headers=machine_headers)
        assert claim.status_code == 200, claim.text
        spec = claim.json()
        assert spec["task_id"] == task_id
        assert spec["plugin"]["name"] == "echo"
        assert spec["plugin"]["runtime_type"] == "python"

        bundle = client.get(
            f"/api/runner/tasks/{task_id}/bundle", headers=machine_headers
        )
        assert bundle.status_code == 200, bundle.text
        with zipfile.ZipFile(io.BytesIO(bundle.content)) as zf:
            names = zf.namelist()
        assert "plugin.yaml" in names
        assert "run.py" in names

        report = client.post(
            f"/api/runner/tasks/{task_id}/status",
            json={"status": "SUCCESS", "message": "Runner completed successfully"},
            headers=machine_headers,
        )
        assert report.status_code == 200, report.text

        finished = wait_terminal(client, run_id, headers=alice_headers)
        assert finished["status"] == "SUCCESS", finished

        # Terminal cleanup removed the persisted state file.
        assert not state_file.exists()


def test_rebuild_returns_none_for_unknown_task(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        services = client.app.state.services
        assert services.engine.remote_inputs_for("no-such-task") is None


def test_claim_without_state_file_still_reports_plugin(tmp_path) -> None:
    """A task parked by an older server version (no state file) still claims,
    with plugin metadata resolved from the database."""
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        services = client.app.state.services
        register_user(client, "root")
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, echo_plugin(), headers=alice_headers)
        make_pipeline(client, alice_headers, "legacy-demo")

        machine = register_personal_machine(client, alice["token"], "agent-box")
        machine_headers = auth_headers(machine["token"])

        submitted = client.post(
            "/api/runs",
            json={
                "pipeline": "legacy-demo",
                "params": {},
                "machine": machine["machine"]["id"],
            },
            headers=alice_headers,
        )
        assert submitted.status_code == 202, submitted.text
        run_id = submitted.json()["id"]
        run = _wait_queued(client, run_id, alice_headers)
        task_id = run["tasks"][0]["id"]

        # Drop both the memory entry and the persisted file: worst case.
        services.engine.remote_inputs.clear()
        state_file = services.settings.storage.root / "remote_state" / f"{task_id}.json"
        state_file.unlink()

        claim = client.post("/api/runner/tasks/claim", headers=machine_headers)
        assert claim.status_code == 200, claim.text
        spec = claim.json()
        assert spec["plugin"]["name"] == "echo"
        assert spec["plugin"]["runtime_type"] == "python"
        assert spec["params"] == {}

        # But the bundle is gone with the inputs: 404, as before this fix.
        bundle = client.get(
            f"/api/runner/tasks/{task_id}/bundle", headers=machine_headers
        )
        assert bundle.status_code == 404
