"""Tests for 0.3: user accounts, ownership, machines, remote runners, and
the plugin store publish/review flow."""

from __future__ import annotations

import io
import time
import zipfile

from fastapi.testclient import TestClient

from mini_pipeline.core.config import (
    AuthConfig,
    SecurityConfig,
)
from mini_pipeline.server.app import create_app
from tests.integration.test_platform_features import (
    build_settings,
    echo_plugin,
    register_plugin,
    sleep_plugin,
)

ACTIVE = {"PENDING", "READY", "QUEUED", "RUNNING"}


def authed_settings(tmp_path, **overrides):
    return build_settings(
        tmp_path,
        auth=AuthConfig(enabled=True, registration_enabled=True),
        security=SecurityConfig(secret_key="unit-test-secret-key"),
        **overrides,
    )


def login(client: TestClient, username: str, password: str) -> dict:
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_user(client: TestClient, username: str, password: str = "password-123") -> dict:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "display_name": username},
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_pipeline(client: TestClient, headers, name: str, plugin="echo@1.0.0") -> None:
    response = client.post(
        "/api/pipelines",
        json={
            "definition": (
                f"name: {name}\nsteps:\n"
                f"  - {{name: go, plugin: {plugin}}}\n"
            )
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text


def wait_terminal(client, run_id: str, timeout: float = 15.0, headers=None) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}", headers=headers or {}).json()
        if run.get("status") in {"SUCCESS", "FAILED", "CANCELLED"}:
            return run
        time.sleep(0.05)
    raise AssertionError("run did not finish")


# ---------------------------------------------------------------------------
# users & sessions
# ---------------------------------------------------------------------------


def test_first_registered_user_becomes_admin(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        first = register_user(client, "founder")
        second = register_user(client, "member")
        assert first["user"]["role"] == "admin"
        assert second["user"]["role"] == "user"


def test_login_and_me(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        register_user(client, "alice")
        auth = login(client, "alice", "password-123")
        me = client.get("/api/auth/me", headers=auth_headers(auth["token"]))
        assert me.status_code == 200
        assert me.json()["username"] == "alice"
        assert client.get("/api/auth/me").status_code == 401


def test_login_rejects_bad_password(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "bob")
        bad = client.post(
            "/api/auth/login", json={"username": "bob", "password": "wrong-password"}
        )
        assert bad.status_code == 401


def test_short_password_rejected(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        response = client.post(
            "/api/auth/register", json={"username": "carol", "password": "short"}
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# ownership & visibility
# ---------------------------------------------------------------------------


def test_pipelines_are_private_to_owner(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        register_user(client, "mallory")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, echo_plugin(), headers=alice_headers)
        make_pipeline(client, alice_headers, "alice-only")

        mallory = login(client, "mallory", "password-123")
        listed = client.get("/api/pipelines", headers=auth_headers(mallory["token"]))
        assert listed.json()["total"] == 0
        admin_list = client.get("/api/pipelines", headers=auth_headers(alice["token"]))
        assert admin_list.json()["total"] == 1


def test_operator_grant_allows_run_not_edit(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        bob = register_user(client, "bob")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, sleep_plugin("0.1"), headers=alice_headers)
        make_pipeline(client, alice_headers, "shared-pipe", "sleeper@1.0.0")

        pipelines = client.get(
            "/api/pipelines", headers=auth_headers(alice["token"])
        ).json()
        pipeline_id = pipelines["items"][0]["id"]

        grant = client.post(
            "/api/grants",
            json={
                "resource_type": "pipeline",
                "resource_id": pipeline_id,
                "grantee_type": "user",
                "grantee_id": bob["user"]["id"],
                "permission": "operator",
            },
            headers=auth_headers(alice["token"]),
        )
        assert grant.status_code == 201, grant.text

        bob_headers = auth_headers(bob["token"])
        visible = client.get("/api/pipelines", headers=bob_headers).json()
        assert visible["total"] == 1

        submitted = client.post(
            "/api/runs", json={"pipeline": "shared-pipe", "params": {}}, headers=bob_headers
        )
        assert submitted.status_code == 202
        run_id = submitted.json()["id"]
        run = wait_terminal(client, run_id, headers=bob_headers)

        # Bob cannot edit or cancel-alter someone else's definition, but can
        # see the run he submitted.
        update = client.put(
            f"/api/pipelines/{pipeline_id}",
            json={"definition": "name: shared-pipe\nsteps: []"},
            headers=bob_headers,
        )
        assert update.status_code == 404  # hidden rather than leaked
        assert run["status"] in {"SUCCESS", "FAILED"}


def test_plugin_privacy_requires_publication(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        register_user(client, "bob")
        alice_headers = auth_headers(alice["token"])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "plugin.yaml",
                "name: alice-priv\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n",
            )
            zf.writestr("run.py", "print('private')\n")
        upload = client.post(
            "/api/plugins/upload",
            files={"file": ("alice-priv.zip", io.BytesIO(buf.getvalue()), "application/zip")},
            headers=alice_headers,
        )
        assert upload.status_code == 201, upload.text

        bob_headers = auth_headers(login(client, "bob", "password-123")["token"])
        listed = client.get("/api/plugins", headers=bob_headers).json()
        names = [item["name"] for item in listed["items"]]
        assert "alice-priv" not in names

        store = client.get("/api/plugins/store", headers=bob_headers).json()
        assert "alice-priv" not in [item["name"] for item in store["items"]]


def test_store_publish_requires_admin_approval(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        root = register_user(client, "root")  # admin
        alice = register_user(client, "alice")
        register_user(client, "bob")
        alice_headers = auth_headers(alice["token"])

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "plugin.yaml",
                "name: store-demo\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n",
            )
            zf.writestr("run.py", "print('store')\n")
        upload = client.post(
            "/api/plugins/upload",
            files={"file": ("store-demo.zip", io.BytesIO(buf.getvalue()), "application/zip")},
            headers=alice_headers,
        )
        assert upload.status_code == 201, upload.text
        plugin_id = upload.json()["plugin_id"]

        bob_headers = auth_headers(login(client, "bob", "password-123")["token"])
        before = client.get("/api/plugins", headers=bob_headers).json()
        assert "store-demo" not in [i["name"] for i in before["items"]]

        requested = client.post(
            "/api/plugins/store/publish",
            json={"plugin_id": plugin_id},
            headers=alice_headers,
        )
        assert requested.status_code == 202

        # Non-admin cannot review.
        denied = client.post(
            "/api/plugins/store/review?approve=true",
            json={"plugin_id": plugin_id},
            headers=alice_headers,
        )
        assert denied.status_code == 403

        approved = client.post(
            "/api/plugins/store/review?approve=true",
            json={"plugin_id": plugin_id},
            headers=auth_headers(root["token"]),
        )
        assert approved.status_code == 200, approved.text

        after = client.get("/api/plugins", headers=bob_headers).json()
        assert "store-demo" in [i["name"] for i in after["items"]]


# ---------------------------------------------------------------------------
# machines
# ---------------------------------------------------------------------------


def register_personal_machine(client, token: str, name="my-laptop") -> dict:
    response = client.post(
        "/api/machines",
        json={"name": name, "labels": {"os": "win"}, "max_concurrency": 2},
        headers=auth_headers(token),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_personal_machine_registration_and_privacy(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        alice = register_user(client, "alice")
        machine = register_personal_machine(client, alice["token"], "alice-box")
        assert machine["token"].startswith("mrt_")
        assert machine["machine"]["can_manage"] is True

        # Another user must not even see it
        register_user(client, "mallory")
        mallory = login(client, "mallory", "password-123")
        listing = client.get("/api/machines", headers=auth_headers(mallory["token"]))
        assert listing.json() == []


def test_admin_machine_credentials_hidden_from_assignee(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        admin = register_user(client, "root")  # first user = admin
        register_user(client, "worker")
        admin_headers = auth_headers(admin["token"])

        created = client.post(
            "/api/machines/admin",
            json={
                "name": "gpu-server",
                "assigned_user_id": login(client, "worker", "password-123")["user"]["id"],
                "credentials": {"username": "svc", "password": "s3cret"},
                "labels": {"gpu": "a100"},
                "max_concurrency": 4,
            },
            headers=admin_headers,
        )
        assert created.status_code == 201
        machine = created.json()["machine"]
        assert machine["has_credentials"] is True

        worker = login(client, "worker", "password-123")
        worker_headers = auth_headers(worker["token"])
        listing = client.get("/api/machines", headers=worker_headers).json()
        assert [m["name"] for m in listing] == ["gpu-server"]
        assert listing[0]["can_use"] is True
        assert listing[0]["can_manage"] is False

        hidden = client.get(
            f"/api/machines/{machine['id']}/credentials", headers=worker_headers
        )
        assert hidden.status_code == 403

        readable = client.get(
            f"/api/machines/{machine['id']}/credentials", headers=admin_headers
        )
        assert readable.status_code == 200
        assert readable.json()["credentials"]["password"] == "s3cret"


def test_machine_ownership_transfer(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        register_user(client, "bob")
        machine = register_personal_machine(client, alice["token"], "alice-box")
        bob = login(client, "bob", "password-123")

        transferred = client.patch(
            f"/api/machines/{machine['machine']['id']}",
            json={"transfer_to_user_id": bob["user"]["id"]},
            headers=auth_headers(alice["token"]),
        )
        assert transferred.status_code == 200
        assert transferred.json()["owner_id"] == bob["user"]["id"]

        # Old owner no longer sees it; new owner does.
        listing = client.get("/api/machines", headers=auth_headers(alice["token"])).json()
        assert listing == []
        listing = client.get("/api/machines", headers=auth_headers(bob["token"])).json()
        assert [m["name"] for m in listing] == ["alice-box"]


# ---------------------------------------------------------------------------
# remote execution (runner protocol, simulated agent)
# ---------------------------------------------------------------------------


def claim_and_execute(client, token: str) -> dict:
    """Act as a runner: claim one task, download the bundle, execute the
    plugin through the real runtime stack, and report back."""
    headers = auth_headers(token)
    claim = client.post("/api/runner/tasks/claim", headers=headers)
    if claim.status_code == 204:
        return {"status": "idle"}
    spec = claim.json()
    bundle = client.get(f"/api/runner/tasks/{spec['task_id']}/bundle", headers=headers)
    assert bundle.status_code == 200, bundle.text

    import tempfile
    from pathlib import Path


    class ApiRunnerClient:
        """Drives the runner protocol through the test client."""

        def __init__(self, test_client, machine_token: str) -> None:
            self._client = test_client
            self._headers = auth_headers(machine_token)

        def push_logs(self, task_id: str, chunk: str) -> None:
            self._client.post(
                f"/api/runner/tasks/{task_id}/logs",
                json={"chunk": chunk},
                headers=self._headers,
            )

        def upload_artifacts(self, task_id: str, files) -> None:
            if not files:
                return
            opened = [("files", (p.name, p.open("rb"))) for p in files]
            try:
                self._client.post(
                    f"/api/runner/tasks/{task_id}/artifacts",
                    files=opened,
                    headers=self._headers,
                )
            finally:
                for _, handle in opened:
                    handle[1].close()

        def report_status(self, task_id, *, status, message="", outputs=None):
            self._client.post(
                f"/api/runner/tasks/{task_id}/status",
                json={"status": status, "message": message, "outputs": outputs or {}},
                headers=self._headers,
            )

    class _BundleHttp:
        pass

    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "ws"
        bundle_file = workspace / f"{spec['task_id']}.zip"
        workspace.mkdir(parents=True)
        bundle_file.write_bytes(bundle.content)
        with zipfile.ZipFile(bundle_file) as zf:
            zf.extractall(workspace)

        manifest_entry = spec["plugin"]["entry"]
        # Execute through the same helper the real agent uses.
        api_client = ApiRunnerClient(client, token)

        from mini_pipeline.domain.runtime import RuntimeRequest
        from mini_pipeline.plugin.manifest import load_manifest
        from mini_pipeline.runner.agent import LogTee, _build_runtime_registry

        manifest = load_manifest(workspace)
        runtime = _build_runtime_registry().get(manifest.runtime.type or "shell")
        entry = (workspace / manifest_entry).resolve()
        tee = LogTee(api_client, spec["task_id"])
        tee.start()
        result = runtime.execute(
            RuntimeRequest(
                command=[str(entry)],
                cwd=workspace,
                environment={
                    "PIPELINE_WORKSPACE": str(workspace),
                    "PIPELINE_TASK_ID": spec["task_id"],
                },
                timeout_seconds=int(spec.get("timeout_seconds", 30)),
                log_stream=tee,
            ),
        )
        time.sleep(0.6)
        tee.close()
        assert result.exit_code == 0, result.error

        from mini_pipeline.executor.collector import collect_outputs

        collected = collect_outputs(
            workspace,
            manifest.contract,
            run_id=spec["run_id"],
            task_id=spec["task_id"],
            artifact_store=None,
        )
        api_client.upload_artifacts(
            spec["task_id"],
            [Path(a["storage_path"]) for a in collected.get("artifacts", [])],
        )
        api_client.report_status(
            spec["task_id"],
            status="SUCCESS",
            message="Runner completed successfully",
            outputs=collected.get("outputs", {}),
        )
    return spec


def test_remote_execution_end_to_end(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, echo_plugin(), headers=alice_headers)
        make_pipeline(client, alice_headers, "remote-demo")

        machine = register_personal_machine(client, alice["token"], "agent-box")
        machine_id = machine["machine"]["id"]

        submitted = client.post(
            "/api/runs",
            json={"pipeline": "remote-demo", "params": {}, "machine": machine_id},
            headers=auth_headers(alice["token"]),
        )
        assert submitted.status_code == 202, submitted.text
        run_id = submitted.json()["id"]

        # Task should be QUEUED for the machine, not RUNNING locally.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            run = client.get(
                f"/api/runs/{run_id}", headers=auth_headers(alice["token"])
            ).json()
            if run["tasks"][0]["status"] == "QUEUED":
                break
            time.sleep(0.05)
        assert run["tasks"][0]["status"] == "QUEUED", run["tasks"][0]

        # Heartbeat as the machine: online, no cancels.
        hb = client.post(
            "/api/runner/heartbeat",
            json={"agent_version": "0.3.0", "active_task_ids": []},
            headers=auth_headers(machine["token"]),
        )
        assert hb.status_code == 200
        assert hb.json()["cancel_task_ids"] == []

        spec = claim_and_execute(client, machine["token"])
        assert spec["task_id"]

        run = wait_terminal(client, run_id, headers=auth_headers(alice["token"]))
        assert run["status"] == "SUCCESS", run
        task = run["tasks"][0]
        assert task["status"] == "SUCCESS"
        assert task["message"] == "Runner completed successfully"


def test_machine_without_queued_tasks_gets_204(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        machine = register_personal_machine(client, alice["token"], "idle-box")
        claim = client.post(
            "/api/runner/tasks/claim", headers=auth_headers(machine["token"])
        )
        assert claim.status_code == 204


def test_other_machine_cannot_claim_foreign_task(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, sleep_plugin("0.5"), headers=alice_headers)
        make_pipeline(client, alice_headers, "foreign", "sleeper@1.0.0")
        target = register_personal_machine(client, alice["token"], "target")
        other = register_personal_machine(client, alice["token"], "other")

        submitted = client.post(
            "/api/runs",
            json={"pipeline": "foreign", "params": {}, "machine": target["machine"]["id"]},
            headers=auth_headers(alice["token"]),
        )
        assert submitted.status_code == 202

        # Once the task is QUEUED, the wrong machine still cannot claim it.
        deadline = time.monotonic() + 5
        claim = None
        while time.monotonic() < deadline:
            claim = client.post(
                "/api/runner/tasks/claim", headers=auth_headers(other["token"])
            )
            if claim.status_code != 204:
                break
            time.sleep(0.05)
        assert claim is not None and claim.status_code == 204


def test_expired_lease_fails_task(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, sleep_plugin("5"), headers=alice_headers)
        make_pipeline(client, alice_headers, "lease-demo", "sleeper@1.0.0")
        machine = register_personal_machine(client, alice["token"], "ghost-box")
        machine_id = machine["machine"]["id"]

        submitted = client.post(
            "/api/runs",
            json={"pipeline": "lease-demo", "params": {}, "machine": machine_id},
            headers=auth_headers(alice["token"]),
        )
        run_id = submitted.json()["id"]

        from mini_pipeline.core.container import Services

        services: Services = client.app.state.services
        reaped = services.lease_reaper.reap_once()
        assert reaped == 0  # not claimed yet -> no lease to expire

        # Claim (waiting for the QUEUED transition), then let the lease
        # lapse and reap.
        deadline = time.monotonic() + 5
        claim = None
        while time.monotonic() < deadline:
            claim = client.post(
                "/api/runner/tasks/claim", headers=auth_headers(machine["token"])
            )
            if claim.status_code == 200:
                break
            time.sleep(0.05)
        assert claim is not None and claim.status_code == 200
        task_id = claim.json()["task_id"]

        from datetime import timedelta

        from sqlalchemy import update

        from mini_pipeline.database.models import TaskRun, utcnow

        with services.database.session() as session:
            session.execute(
                update(TaskRun)
                .where(TaskRun.id == task_id)
                .values(lease_expires_at=utcnow() - timedelta(seconds=1))
            )
        assert services.lease_reaper.reap_once() == 1
        run = wait_terminal(client, run_id, headers=auth_headers(alice["token"]))
        assert run["status"] == "FAILED"
        assert "lease" in (run["tasks"][0]["message"] or "").lower()


def test_run_submit_on_forbidden_machine_rejected(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")  # throwaway admin
        alice = register_user(client, "alice")
        register_user(client, "mallory")
        alice_headers = auth_headers(alice["token"])
        register_plugin(client, echo_plugin(), headers=alice_headers)
        make_pipeline(client, alice_headers, "demo")
        machine = register_personal_machine(client, alice["token"], "alice-only")

        mallory = login(client, "mallory", "password-123")
        response = client.post(
            "/api/runs",
            json={
                "pipeline": "demo",
                "params": {},
                "machine": machine["machine"]["id"],
            },
            headers=auth_headers(mallory["token"]),
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# admin console
# ---------------------------------------------------------------------------


def test_admin_user_management(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        root = register_user(client, "root")  # first user = admin
        register_user(client, "member")
        admin_headers = auth_headers(root["token"])

        users = client.get("/api/admin/users", headers=admin_headers).json()
        assert {u["role"] for u in users} == {"admin", "user"}

        member_id = next(u["id"] for u in users if u["username"] == "member")
        promote = client.patch(
            f"/api/admin/users/{member_id}/role",
            json={"role": "admin"},
            headers=admin_headers,
        )
        assert promote.status_code == 200

        disable = client.patch(
            f"/api/admin/users/{member_id}/status",
            json={"status": "disabled"},
            headers=admin_headers,
        )
        assert disable.status_code == 200
        response = client.post(
            "/api/auth/login", json={"username": "member", "password": "password-123"}
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# SSH machines
# ---------------------------------------------------------------------------


def test_ssh_machine_registration_and_validation(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        register_user(client, "root")
        alice = register_user(client, "alice")
        alice_headers = auth_headers(alice["token"])

        # Validation: missing host
        bad = client.post(
            "/api/machines",
            json={
                "name": "bad-ssh",
                "connection_type": "ssh",
                "connection": {"username": "ubuntu"},
            },
            headers=alice_headers,
        )
        assert bad.status_code == 422

        # Validation: missing password/key
        bad2 = client.post(
            "/api/machines",
            json={
                "name": "bad-ssh2",
                "connection_type": "ssh",
                "connection": {"host": "192.168.1.100", "username": "ubuntu"},
            },
            headers=alice_headers,
        )
        assert bad2.status_code == 422

        # Valid SSH registration
        good = client.post(
            "/api/machines",
            json={
                "name": "alice-ssh",
                "connection_type": "ssh",
                "connection": {
                    "host": "192.168.1.100",
                    "port": 22,
                    "username": "alice",
                    "password": "secret-ssh-password",
                },
            },
            headers=alice_headers,
        )
        assert good.status_code == 201
        data = good.json()
        assert data["machine"]["connection_type"] == "ssh"
        assert data["machine"]["has_credentials"] is True
        machine_id = data["machine"]["id"]

        # Owner can read credentials
        creds = client.get(f"/api/machines/{machine_id}/credentials", headers=alice_headers)
        assert creds.status_code == 200
        assert creds.json()["credentials"]["password"] == "secret-ssh-password"

        # Another user cannot read credentials
        bob = register_user(client, "bob")
        bob_creds = client.get(
            f"/api/machines/{machine_id}/credentials",
            headers=auth_headers(bob["token"]),
        )
        assert bob_creds.status_code == 403

        # Test connection endpoint is reachable (will fail to connect to 192.168.1.100 gracefully)
        test_conn = client.post(
            f"/api/machines/{machine_id}/test-connection",
            headers=alice_headers,
        )
        assert test_conn.status_code == 200
        assert test_conn.json()["ok"] is False  # host is unroutable in test
        assert "error" in test_conn.json()

