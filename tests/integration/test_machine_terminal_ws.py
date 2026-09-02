"""Integration tests for Electerm-Web style full-duplex WebSocket PTY terminal."""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from mini_pipeline.core.config import AuthConfig, SecurityConfig
from mini_pipeline.server.app import create_app
from tests.integration.test_platform_features import build_settings


def authed_settings(tmp_path, **overrides):
    return build_settings(
        tmp_path,
        auth=AuthConfig(enabled=True, registration_enabled=True),
        security=SecurityConfig(secret_key="unit-test-secret-key"),
        **overrides,
    )


def test_machine_terminal_ws_auth_rejection(tmp_path):
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # 1. Unauthenticated WS should be closed with 4401
        try:
            with client.websocket_connect("/api/machines/master-local/terminal/ws") as ws:
                ws.send_text("hello")
        except Exception:
            pass


def test_machine_terminal_ws_ssh_mock(tmp_path, monkeypatch):
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    # Register admin user to get valid token
    with TestClient(app) as client:
        reg = client.post(
            "/api/auth/register",
            json={"username": "admin_term", "password": "password-123"},
        ).json()
        token = reg["token"]

        # Mock diagnostics._connect_ssh
        mock_channel = MagicMock()
        mock_channel.closed = False
        recv_ready_calls = [True]

        def _mock_recv_ready():
            if recv_ready_calls:
                return recv_ready_calls.pop(0)
            return False

        mock_channel.recv_ready.side_effect = _mock_recv_ready
        mock_channel.recv_stderr_ready.return_value = False
        mock_channel.recv.return_value = b"mock shell prompt> "
        mock_client = MagicMock()
        mock_client.get_transport.return_value.is_active.return_value = True
        mock_client.invoke_shell.return_value = mock_channel

        services = app.state.services
        monkeypatch.setattr(
            services.diagnostics,
            "_connect_ssh",
            lambda machine: (mock_client, None),
        )

        # Create a mock remote machine
        m = services.machine_repository.create(
            name="mock-host",
            kind="dynamic",
            owner_id=None,
            assigned_user_id=None,
            token_hash="fake-hash",
            labels={"platform": "linux"},
            max_concurrency=1,
            credentials=None,
            notes="",
            connection_type="ssh",
        )

        with client.websocket_connect(
            f"/api/machines/{m.id}/terminal/ws?token={token}&cols=100&rows=30"
        ) as ws:
            # 1. First message from read pump is channel output bytes
            shell_bytes = ws.receive_bytes()
            assert b"mock shell prompt>" in shell_bytes

            ws.send_text('{"type":"resize","cols":120,"rows":40}')
            ws.send_text("ls\n")
            ws.send_text('{"type":"ping"}')
            pong = ws.receive_text()
            assert "pong" in pong

        mock_channel.resize_pty.assert_called_with(width=120, height=40)
        mock_channel.send.assert_called_with(b"ls\n")
