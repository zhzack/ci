"""Run-finished webhooks: HMAC signing, dispatch behaviour, declaration."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime
from types import SimpleNamespace

import httpx
import pytest

from mini_pipeline.notify import webhook as webhook_module
from mini_pipeline.notify.webhook import (
    build_run_finished_payload,
    dispatch_run_webhooks,
    sign_payload,
)
from mini_pipeline.pipeline.schema import PipelineDefinition


def _hook(url="https://hooks.example/x", secret=None):
    return SimpleNamespace(url=url, secret=secret, events=["run.finished"])


def _payload(**overrides):
    payload = build_run_finished_payload(
        run_id="run-1",
        pipeline_name="demo",
        status="SUCCESS",
        message="Pipeline completed",
        started_at=datetime(2026, 1, 1, 0, 0, 0),
        finished_at=datetime(2026, 1, 1, 0, 0, 5),
        tasks=[{"name": "go", "status": "SUCCESS", "attempt": 1}],
    )
    payload.update(overrides)
    return payload


def test_sign_payload_matches_receiver_recipe() -> None:
    secret = "a-shared-signing-key"
    timestamp = "1700000000"
    body = b'{"event": "run.finished"}'
    signature = sign_payload(secret, timestamp, body)
    expected = "sha256=" + hmac.new(
        secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()
    assert signature == expected
    assert signature.startswith("sha256=")


def test_dispatch_posts_signed_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, dict, bytes]] = []

    def fake_post(url, content=None, headers=None, timeout=None):
        sent.append((url, headers, content))
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(webhook_module.httpx, "post", fake_post)
    dispatch_run_webhooks([_hook(secret="s3cret")], _payload())
    # Deliveries run on the worker pool — wait for completion.
    deadline = time.monotonic() + 5
    while not sent and time.monotonic() < deadline:
        time.sleep(0.02)

    url, headers, body = sent[0]
    assert url == "https://hooks.example/x"
    ts = headers["X-MiniPipeline-Timestamp"]
    assert headers["X-MiniPipeline-Signature"] == sign_payload("s3cret", ts, body)
    assert headers["X-MiniPipeline-Event"] == "run.finished"
    payload = json.loads(body)
    assert payload["run_id"] == "run-1"
    assert payload["status"] == "SUCCESS"
    assert payload["duration_s"] == 5.0
    assert payload["tasks"] == [{"name": "go", "status": "SUCCESS", "attempt": 1}]


def test_dispatch_without_secret_is_unsigned(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict] = []

    def fake_post(url, content=None, headers=None, timeout=None):
        sent.append(headers)
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(webhook_module.httpx, "post", fake_post)
    dispatch_run_webhooks([_hook(secret=None)], _payload())
    deadline = time.monotonic() + 5
    while not sent and time.monotonic() < deadline:
        time.sleep(0.02)

    assert "X-MiniPipeline-Signature" not in sent[0]
    assert "X-MiniPipeline-Timestamp" not in sent[0]


def test_dispatch_failure_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(url, content=None, headers=None, timeout=None):
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(webhook_module.httpx, "post", boom)
    dispatch_run_webhooks([_hook()], _payload())  # must not raise
    time.sleep(0.1)


def test_definition_accepts_webhooks() -> None:
    definition = PipelineDefinition.model_validate({
        "name": "demo",
        "webhooks": [
            {"url": "https://hooks.example/x", "secret": "k", "events": ["run.finished"]},
        ],
        "steps": [{"name": "go", "plugin": "echo@1.0.0"}],
    })
    assert definition.webhooks[0].url == "https://hooks.example/x"

    with pytest.raises(Exception, match="http"):
        PipelineDefinition.model_validate({
            "name": "demo",
            "webhooks": [{"url": "ftp://nope"}],
            "steps": [{"name": "go", "plugin": "echo@1.0.0"}],
        })


def test_events_filter_skips_non_matching_hooks(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[str] = []

    def fake_post(url, content=None, headers=None, timeout=None):
        sent.append(url)
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(webhook_module.httpx, "post", fake_post)
    other = SimpleNamespace(url="https://other/x", secret=None, events=["other.event"])
    dispatch_run_webhooks([other], _payload())
    time.sleep(0.1)
    assert sent == []


def test_pipeline_run_triggers_webhook_end_to_end(tmp_path, monkeypatch) -> None:
    """A pipeline declaring webhooks fires a signed delivery on completion."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    received: list[dict] = []

    class Capture(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            received.append({
                "headers": dict(self.headers),
                "body": json.loads(body),
            })
            self.send_response(200)
            self.end_headers()

    server = HTTPServer(("127.0.0.1", 0), Capture)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        from fastapi.testclient import TestClient

        from tests.integration.test_platform_features import (
            build_settings,
            echo_plugin,
            register_plugin,
        )

        settings = build_settings(
            tmp_path,
            auth={"enabled": True, "registration_enabled": True},
            security={"secret_key": "unit-test-secret-key"},
        )
        from mini_pipeline.server.app import create_app

        with TestClient(create_app(settings)) as client:
            client.post(
                "/api/auth/register",
                json={"username": "root", "password": "password-123"},
            )
            token = client.post(
                "/api/auth/login",
                json={"username": "root", "password": "password-123"},
            ).json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            register_plugin(client, echo_plugin(), headers=headers)
            definition = (
                "name: hook-demo\n"
                "webhooks:\n"
                f"  - url: http://127.0.0.1:{port}/hook\n"
                "    secret: hook-secret\n"
                "steps:\n"
                "  - {name: go, plugin: echo@1.0.0}\n"
            )
            created = client.post(
                "/api/pipelines", json={"definition": definition}, headers=headers,
            )
            assert created.status_code == 201, created.text
            submitted = client.post(
                "/api/runs", json={"pipeline": "hook-demo", "params": {}},
                headers=headers,
            )
            assert submitted.status_code == 202, submitted.text
            run_id = submitted.json()["id"]

            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                run = client.get(f"/api/runs/{run_id}", headers=headers).json()
                if run.get("status") in {"SUCCESS", "FAILED"}:
                    break
                time.sleep(0.1)
            assert run["status"] == "SUCCESS", run

            deadline = time.monotonic() + 10
            while not received and time.monotonic() < deadline:
                time.sleep(0.1)

            assert received, "webhook delivery never arrived"
            delivery = received[0]
            assert delivery["body"]["run_id"] == run_id
            assert delivery["body"]["status"] == "SUCCESS"
            ts = delivery["headers"].get("X-MiniPipeline-Timestamp")
            raw = json.dumps(delivery["body"], ensure_ascii=False).encode("utf-8")
            expected = "sha256=" + hmac.new(
                b"hook-secret", f"{ts}.".encode() + raw, hashlib.sha256
            ).hexdigest()
            # The receiver can verify the signature over the raw body it got.
            assert delivery["headers"]["X-MiniPipeline-Signature"] == expected
    finally:
        server.shutdown()
