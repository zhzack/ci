"""Tests for the 0.2 platform features: auth, pagination, cancel, retry,
SSE streams, crash recovery, artifact caching, and retention GC."""

from __future__ import annotations

import io
import json
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from mini_pipeline.core.config import (
    AuthConfig,
    AuthToken,
    ExecutionConfig,
    SecurityConfig,
    Settings,
)
from mini_pipeline.server.app import create_app

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def build_settings(tmp_path, **overrides) -> Settings:
    from mini_pipeline.core.config import (
        AppConfig,
        DatabaseConfig,
        LocalPackageStorageConfig,
        PackageStorageConfig,
        SourceConfig,
        StorageConfig,
    )

    kwargs = dict(
        app=AppConfig(),
        database=DatabaseConfig(url=f"sqlite:///{tmp_path / 'p.db'}"),
        storage=StorageConfig(
            root=tmp_path,
            plugins=tmp_path / "plugins",
            workspaces=tmp_path / "workspaces",
            logs=tmp_path / "logs",
            artifacts=tmp_path / "artifacts",
            temp=tmp_path / "tmp",
        ),
        execution=ExecutionConfig(
            coordinator_workers=2, task_workers=4, task_timeout_seconds=10
        ),
        sources=SourceConfig(
            http_timeout_seconds=2,
            max_archive_bytes=1024 * 1024,
            max_extracted_bytes=2 * 1024 * 1024,
            max_archive_files=100,
        ),
        packages=PackageStorageConfig(
            local=LocalPackageStorageConfig(root=tmp_path / "packages")
        ),
    )
    kwargs.update(overrides)
    return Settings(**kwargs)


def sleep_plugin(seconds: str = "3", fail: bool = False) -> bytes:
    status = "sys.exit(1)" if fail else "pass"
    script = (
        "import time, sys\n"
        "import os\n"
        "print('start', flush=True)\n"
        f"time.sleep({seconds})\n"
        f"{status}\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "plugin.yaml",
            "name: sleeper\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n",
        )
        zf.writestr("run.py", script)
    return buf.getvalue()


def echo_plugin() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "plugin.yaml",
            "name: echo\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n",
        )
        zf.writestr("run.py", "import os\nprint('echo ok')\n")
    return buf.getvalue()


def wait_for_status(client, run_id, statuses, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in statuses:
            return run
        time.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not reach {statuses}")


def register_plugin(client, archive, name="sleeper", headers=None):
    resp = client.post(
        "/api/plugins/upload",
        files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
        headers=headers or {},
    )
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# health & readiness
# ---------------------------------------------------------------------------


def test_health_endpoints(tmp_path) -> None:

    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        health = client.get("/health").json()
        assert health["status"] == "ok" and health["version"]
        ready = client.get("/health/ready")
        assert ready.status_code == 200
        assert ready.json()["checks"]["database"] == "ok"
        version = client.get("/health/version").json()
        assert version["api"] == "v2"


# ---------------------------------------------------------------------------
# request id
# ---------------------------------------------------------------------------


def test_request_id_echoed(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        response = client.get("/health", headers={"X-Request-ID": "trace-42"})
        assert response.headers["X-Request-ID"] == "trace-42"
        generated = client.get("/health")
        assert len(generated.headers["X-Request-ID"]) == 16


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------


def authed_settings(tmp_path) -> Settings:
    return build_settings(
        tmp_path,
        auth=AuthConfig(
            enabled=True,
            tokens=[
                AuthToken(token="admin-token", name="admin", role="admin"),
                AuthToken(token="reader-token", name="reader", role="reader"),
            ],
        ),
    )


def test_auth_disabled_by_default_allows_all(tmp_path) -> None:
    with TestClient(create_app(build_settings(tmp_path))) as client:
        assert client.get("/api/plugins").status_code == 200
        assert client.post("/api/pipelines", json={"definition": "x"}).status_code in (
            400,
            422,
        )  # invalid YAML, but NOT 401/403


def test_auth_rejects_missing_and_invalid_tokens(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        missing = client.get("/api/plugins")
        assert missing.status_code == 401
        assert "WWW-Authenticate" in missing.headers
        bad = client.get(
            "/api/plugins", headers={"Authorization": "Bearer nope"}
        )
        assert bad.status_code == 401


def test_auth_reader_cannot_mutate(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        ok = client.get("/api/plugins", headers={"Authorization": "Bearer reader-token"})
        assert ok.status_code == 200
        forbidden = client.post(
            "/api/pipelines",
            json={"definition": "name: x\nsteps: []"},
            headers={"Authorization": "Bearer reader-token"},
        )
        assert forbidden.status_code == 403


def test_auth_admin_can_mutate(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        created = client.post(
            "/api/pipelines",
            json={"definition": "bad yaml: ["},
            headers={"Authorization": "Bearer admin-token"},
        )
        assert created.status_code in (400, 422)


def test_debug_requires_admin_when_auth_enabled(tmp_path) -> None:
    with TestClient(create_app(authed_settings(tmp_path))) as client:
        reader = client.get(
            "/api/debug/filesystem", headers={"Authorization": "Bearer reader-token"}
        )
        assert reader.status_code == 403
        admin = client.get(
            "/api/debug/filesystem", headers={"Authorization": "Bearer admin-token"}
        )
        assert admin.status_code == 200


# ---------------------------------------------------------------------------
# pagination
# ---------------------------------------------------------------------------


def test_runs_list_pagination_and_filters(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, sleep_plugin("0.1", fail=True), "sleeper")
        register_plugin(client, echo_plugin(), "echo")
        for plugin in ("sleeper", "echo"):
            client.post(
                "/api/pipelines",
                json={
                    "definition": (
                        f"name: list-{plugin}\n"
                        "steps:\n"
                        f"  - {{name: go, plugin: {plugin}@1.0.0}}\n"
                    )
                },
            )
        run_ids = []
        for plugin in ("sleeper", "echo"):
            submitted = client.post(
                "/api/runs", json={"pipeline": f"list-{plugin}", "params": {}}
            ).json()
            run_ids.append(submitted["id"])
        for rid in run_ids:
            wait_for_status(client, rid, {"SUCCESS", "FAILED"})

        page = client.get("/api/runs?page=1&page_size=1").json()
        assert page["page_size"] == 1
        assert page["total"] == 2
        assert page["pages"] == 2
        assert len(page["items"]) == 1

        failed = client.get("/api/runs?status=FAILED").json()
        assert failed["total"] >= 1
        assert all(item["status"] == "FAILED" for item in failed["items"])

        by_pipeline = client.get("/api/runs?pipeline=list-echo").json()
        assert all(item["pipeline_name"] == "list-echo" for item in by_pipeline["items"])


def test_plugin_list_pagination(tmp_path) -> None:
    with TestClient(create_app(build_settings(tmp_path))) as client:
        register_plugin(client, echo_plugin())
        page = client.get("/api/plugins?page=1&page_size=5").json()
        assert page["total"] == 1
        assert page["items"][0]["name"] == "echo"
        search = client.get("/api/plugins?search=zzz").json()
        assert search["total"] == 0


def test_pipeline_and_artifact_lists_envelope(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        pipelines = client.get("/api/pipelines").json()
        assert {"items", "total", "page", "page_size", "pages"} <= set(pipelines)
        artifacts = client.get("/api/artifacts").json()
        assert {"items", "total"} <= set(artifacts)


# ---------------------------------------------------------------------------
# cancellation
# ---------------------------------------------------------------------------


def test_cancel_running_run(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, sleep_plugin("10"))
        client.post(
            "/api/pipelines",
            json={"definition": "name: slow\nsteps:\n  - {name: go, plugin: sleeper@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "slow", "params": {}}).json()["id"]

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if client.get(f"/api/runs/{run_id}").json()["tasks"][0]["status"] == "RUNNING":
                break
            time.sleep(0.05)

        cancelled = client.post(f"/api/runs/{run_id}/cancel")
        assert cancelled.status_code == 200
        run = wait_for_status(client, run_id, {"CANCELLED", "FAILED"})
        assert run["status"] == "CANCELLED", run
        assert run["tasks"][0]["status"] in {"CANCELLED", "FAILED"}


def test_cancel_terminal_run_conflicts(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, sleep_plugin("0.1"))
        client.post(
            "/api/pipelines",
            json={"definition": "name: quick\nsteps:\n  - {name: go, plugin: sleeper@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "quick", "params": {}}).json()["id"]
        run = wait_for_status(client, run_id, {"SUCCESS", "FAILED"})
        conflict = client.post(f"/api/runs/{run_id}/cancel")
        assert conflict.status_code == 409
        assert run["status"] == "SUCCESS"


# ---------------------------------------------------------------------------
# retries
# ---------------------------------------------------------------------------


def flaky_plugin() -> bytes:
    # The counter lives one level above the task workspace because the
    # executor wipes the workspace at the start of every attempt.
    script = (
        "import os, sys\n"
        "from pathlib import Path\n"
        "flag = Path(os.environ['PIPELINE_WORKSPACE']).parent / 'attempts'\n"
        "count = int(flag.read_text()) + 1 if flag.exists() else 1\n"
        "flag.write_text(str(count))\n"
        "print(f'attempt {count}', flush=True)\n"
        "sys.exit(0 if count >= 3 else 2)\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "plugin.yaml",
            "name: flaky\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n",
        )
        zf.writestr("run.py", script)
    return buf.getvalue()


def test_step_retry_eventually_succeeds(tmp_path) -> None:
    settings = build_settings(tmp_path)
    settings.execution.model_copy  # noqa: B018 (frozen model sanity)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, flaky_plugin())
        client.post(
            "/api/pipelines",
            json={
                "definition": (
                    "name: retry-demo\n"
                    "steps:\n"
                    "  - {name: go, plugin: flaky@1.0.0, retries: 3}\n"
                )
            },
        )
        submitted = client.post("/api/runs", json={"pipeline": "retry-demo", "params": {}})
        run_id = submitted.json()["id"]
        run = wait_for_status(client, run_id, {"SUCCESS", "FAILED"})
        assert run["status"] == "SUCCESS", run
        assert run["tasks"][0]["attempt"] == 3, run["tasks"][0]


def test_step_without_retry_fails_fast(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, sleep_plugin("0.1", fail=True))
        client.post(
            "/api/pipelines",
            json={"definition": "name: no-retry\nsteps:\n  - {name: go, plugin: sleeper@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "no-retry", "params": {}}).json()["id"]
        run = wait_for_status(client, run_id, {"SUCCESS", "FAILED"})
        assert run["status"] == "FAILED"
        assert run["tasks"][0]["attempt"] == 1


# ---------------------------------------------------------------------------
# SSE streams
# ---------------------------------------------------------------------------


def test_run_events_stream_reaches_terminal_status(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, sleep_plugin("0.5"))
        client.post(
            "/api/pipelines",
            json={"definition": "name: sse-run\nsteps:\n  - {name: go, plugin: sleeper@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "sse-run", "params": {}}).json()["id"]

        with client.stream("GET", f"/api/runs/{run_id}/events") as response:
            assert response.headers["content-type"].startswith("text/event-stream")
            saw_terminal = False
            saw_snapshot = False
            for line in response.iter_lines():
                if line.startswith("event: snapshot"):
                    saw_snapshot = True
                if line.startswith("data:"):
                    payload = json.loads(line.removeprefix("data:").strip())
                    # Two payload shapes: RunEvent.to_sse() nests the status
                    # under data; reconciliation snapshots carry it at top
                    # level. A fast run may reach terminal before the client
                    # subscribes, so snapshots count towards terminal too.
                    if payload.get("type") == "run.status":
                        status = payload["data"].get("status")
                    else:
                        status = payload.get("status")
                    if status in {"SUCCESS", "FAILED"}:
                        saw_terminal = True
                        break
            assert saw_snapshot, "first SSE message must be a snapshot"
            assert saw_terminal, "stream must end after a terminal status"


def test_log_stream_delivers_chunks(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        register_plugin(client, echo_plugin())
        client.post(
            "/api/pipelines",
            json={"definition": "name: sse-log\nsteps:\n  - {name: go, plugin: echo@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "sse-log", "params": {}}).json()["id"]
        wait_for_status(client, run_id, {"SUCCESS", "FAILED"})

        with client.stream("GET", f"/api/runs/{run_id}/tasks/go/log/stream") as response:
            assert response.headers["content-type"].startswith("text/event-stream")
            collected = []
            for line in response.iter_lines():
                if line.startswith("data:"):
                    payload = json.loads(line.removeprefix("data:").strip())
                    if "chunk" in payload:
                        collected.append(payload["chunk"])
                    if payload.get("status") in {"SUCCESS", "FAILED"}:
                        break
            assert "echo ok" in "".join(collected)


# ---------------------------------------------------------------------------
# artifact caching
# ---------------------------------------------------------------------------


def test_artifact_download_etag_304(tmp_path) -> None:
    settings = build_settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        artifact_plugin = io.BytesIO()
        with zipfile.ZipFile(artifact_plugin, "w") as zf:
            zf.writestr(
                "plugin.yaml",
                "name: producer\nversion: 1.0.0\nruntime:\n  type: python\n"
                "  entry: run.py\ncontract:\n  outputs:\n"
                "    - {name: blob, type: file, path: output/blob.txt}\n",
            )
            zf.writestr(
                "run.py",
                "import os\nfrom pathlib import Path\n"
                "w = Path(os.environ['PIPELINE_WORKSPACE'])\n"
                "(w / 'output').mkdir(exist_ok=True)\n"
                "(w / 'output' / 'blob.txt').write_text('x' * 64)\n",
            )
        register_plugin(client, artifact_plugin.getvalue(), "producer")
        client.post(
            "/api/pipelines",
            json={"definition": "name: art\nsteps:\n  - {name: go, plugin: producer@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "art", "params": {}}).json()["id"]
        run = wait_for_status(client, run_id, {"SUCCESS", "FAILED"})
        assert run["status"] == "SUCCESS", run
        artifact_id = run["tasks"][0]["artifacts"][0]["id"]

        first = client.get(f"/api/runs/{run_id}/artifacts/{artifact_id}")
        assert first.status_code == 200
        etag = first.headers["ETag"]
        assert etag.startswith('"') and first.content == b"x" * 64

        second = client.get(
            f"/api/runs/{run_id}/artifacts/{artifact_id}",
            headers={"If-None-Match": etag},
        )
        assert second.status_code == 304
        assert second.content == b""


# ---------------------------------------------------------------------------
# crash recovery
# ---------------------------------------------------------------------------


def test_orphan_runs_reaped_on_startup(tmp_path) -> None:
    settings = build_settings(tmp_path)
    app = create_app(settings)
    with TestClient(app) as client:
        # Simulate a crash: flip a fresh run straight to RUNNING in the DB
        # while no coordinator exists to advance it.
        register_plugin(client, sleep_plugin("0.2"))
        client.post(
            "/api/pipelines",
            json={"definition": "name: orphan\nsteps:\n  - {name: go, plugin: sleeper@1.0.0}\n"},
        )
        run_id = client.post("/api/runs", json={"pipeline": "orphan", "params": {}}).json()["id"]
        run = wait_for_status(client, run_id, {"SUCCESS", "FAILED"})
        assert run["status"] in {"SUCCESS", "FAILED"}

    # Second boot against the same storage/DB with runs interrupted mid-way:
    # simulate by direct DB manipulation.
    from sqlalchemy import select, update

    from mini_pipeline.database.models import PipelineRun, TaskRun
    from mini_pipeline.database.session import Database
    from mini_pipeline.domain.states import PipelineStatus, TaskStatus

    database = Database(settings.database)
    with database.session() as session:
        run_id_db = session.scalar(select(PipelineRun.id).order_by(PipelineRun.created_at.desc()))
        session.execute(
            update(PipelineRun)
            .where(PipelineRun.id == run_id_db)
            .values(status=PipelineStatus.RUNNING.value)
        )
        session.execute(
            update(TaskRun)
            .where(TaskRun.run_id == run_id_db)
            .values(status=TaskStatus.RUNNING.value)
        )
    database.close()

    # A new Services build (fresh app instance on same settings) must reap it.
    from mini_pipeline.core.container import Services

    services = Services.build(settings)
    try:
        run = services.run_repository.get(run_id_db)
        assert run.status == "FAILED"
        assert "restart" in (run.message or "").lower()
    finally:
        services.close()


# ---------------------------------------------------------------------------
# rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_blocks_mutating_requests(tmp_path) -> None:
    settings = build_settings(
        tmp_path, security=SecurityConfig(rate_limit_per_minute=3)
    )
    with TestClient(create_app(settings)) as client:
        statuses = []
        for _ in range(5):
            response = client.post(
                "/api/pipelines", json={"definition": "bad: ["}
            )
            statuses.append(response.status_code)
        assert statuses.count(429) >= 1, statuses
        # GETs are never limited
        assert client.get("/api/plugins").status_code == 200


# ---------------------------------------------------------------------------
# retention GC
# ---------------------------------------------------------------------------


def test_gc_removes_old_artifacts(tmp_path) -> None:
    from datetime import timedelta

    from mini_pipeline.core.config import RetentionConfig
    from mini_pipeline.core.container import Services
    from mini_pipeline.maintenance.gc import collect

    settings = build_settings(
        tmp_path,
        retention=RetentionConfig(
            artifacts_days=0.0001, logs_days=0, workspaces_days=0, temp_hours=0
        ),
    )
    services = Services.build(settings)
    try:
        # fabricate a terminal run with an artifact older than the window
        run = services.run_repository.create(
            pipeline_id=None,
            pipeline_name="gc-demo",
            params={},
            tasks=[("go", "echo", "1.0.0")],
        )
        run_id = run.id
        task = run.tasks[0]
        artifact_path = settings.storage.artifacts / run_id / task.id / "a" / "content"
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_bytes(b"data")
        services.run_repository.add_artifact(
            artifact_id="art-gc-1",
            run_id=run_id,
            task_id=task.id,
            name="blob",
            storage_path=str(artifact_path),
            size=4,
            sha256="x" * 64,
        )
        from mini_pipeline.database.models import utcnow
        finished = utcnow() - timedelta(days=30)
        from mini_pipeline.domain.states import PipelineStatus

        services.run_repository.set_run_state(
            run_id, PipelineStatus.FAILED, finished_at=finished
        )

        summary = collect(services, dry_run=False)
        assert summary["artifacts"] == 1
        assert not artifact_path.exists()
        from mini_pipeline.domain.exceptions import NotFoundError

        with pytest.raises(NotFoundError):
            services.run_repository.get_artifact("art-gc-1")
    finally:
        services.close()
