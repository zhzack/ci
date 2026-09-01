"""Integration tests for Email OTP authentication, SMTP management, and pipeline notifications."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from mini_pipeline.database.models import EmailVerificationCode, PipelineDefinition
from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_email_verification_and_auth_flows(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        services = client.app.state.services
        # Mock email sending in service to capture sent codes without real SMTP
        mock_send = MagicMock(return_value=True)
        services.email_service.send_email_sync = mock_send

        # Bootstrap admin
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # 1. Send OTP code for registration
        test_email = "alice@example.com"
        res_send = client.post(
            "/api/auth/send-code",
            json={"email": test_email, "purpose": "register"},
        )
        assert res_send.status_code == 200
        assert res_send.json()["email"] == test_email

        # Rate limit cooldown check (request within 60s should fail)
        res_send_fast = client.post(
            "/api/auth/send-code",
            json={"email": test_email, "purpose": "register"},
        )
        assert res_send_fast.status_code == 422
        assert "频繁" in res_send_fast.text

        # Fetch latest code from DB
        with services.database.session() as s:
            record = s.scalar(
                select(EmailVerificationCode)
                .where(EmailVerificationCode.email == test_email)
                .order_by(EmailVerificationCode.created_at.desc())
            )
            assert record is not None
            reg_code = record.code

        # 2. Register with OTP code
        res_reg = client.post(
            "/api/auth/register-otp",
            json={
                "username": "alice",
                "password": "alice_password_123",
                "email": test_email,
                "code": reg_code,
                "display_name": "Alice Wonderland",
            },
        )
        assert res_reg.status_code == 201
        alice_data = res_reg.json()
        assert alice_data["user"]["username"] == "alice"
        assert alice_data["user"]["email"] == test_email
        h_alice = auth_headers(alice_data["token"])

        # 3. OTP Login
        # Clear cooldown for testing
        with services.database.session() as s:
            s.execute(
                delete(EmailVerificationCode).where(EmailVerificationCode.email == test_email)
            )

        # Send login code
        res_login_send = client.post(
            "/api/auth/send-code",
            json={"email": test_email, "purpose": "login"},
        )
        assert res_login_send.status_code == 200

        with services.database.session() as s:
            record = s.scalar(
                select(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == test_email,
                    EmailVerificationCode.purpose == "login",
                )
                .order_by(EmailVerificationCode.created_at.desc())
            )
            assert record is not None
            login_code = record.code

        res_otp_login = client.post(
            "/api/auth/login-otp",
            json={"email": test_email, "code": login_code},
        )
        assert res_otp_login.status_code == 200
        assert res_otp_login.json()["user"]["username"] == "alice"

        # 4. Forgot password reset with OTP
        with services.database.session() as s:
            s.execute(
                delete(EmailVerificationCode).where(EmailVerificationCode.email == test_email)
            )

        res_reset_send = client.post(
            "/api/auth/send-code",
            json={"email": test_email, "purpose": "reset_password"},
        )
        assert res_reset_send.status_code == 200

        with services.database.session() as s:
            record = s.scalar(
                select(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == test_email,
                    EmailVerificationCode.purpose == "reset_password",
                )
                .order_by(EmailVerificationCode.created_at.desc())
            )
            assert record is not None
            reset_code = record.code

        res_reset = client.post(
            "/api/auth/reset-password-otp",
            json={
                "email": test_email,
                "code": reset_code,
                "new_password": "new_alice_password_456",
            },
        )
        assert res_reset.status_code == 200

        # Verify login with new password
        res_new_pwd_login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "new_alice_password_456"},
        )
        assert res_new_pwd_login.status_code == 200

        # 5. Bind / Update Email with OTP
        new_email = "alice_new@example.com"
        res_bind_send = client.post(
            "/api/auth/send-code",
            json={"email": new_email, "purpose": "bind_email"},
        )
        assert res_bind_send.status_code == 200

        with services.database.session() as s:
            record = s.scalar(
                select(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == new_email,
                    EmailVerificationCode.purpose == "bind_email",
                )
                .order_by(EmailVerificationCode.created_at.desc())
            )
            assert record is not None
            bind_code = record.code

        res_bind = client.post(
            "/api/auth/bind-email-otp",
            json={"email": new_email, "code": bind_code},
            headers=h_alice,
        )
        assert res_bind.status_code == 200
        assert res_bind.json()["email"] == new_email

        # 6. Admin SMTP Settings & Test Email
        res_smtp_get = client.get("/api/admin/email-config", headers=h_admin)
        assert res_smtp_get.status_code == 200
        smtp_info = res_smtp_get.json()
        assert smtp_info["host"] == "smtp.qq.com"
        assert smtp_info["port"] == 465
        assert smtp_info["has_password"] is True

        # Update SMTP config
        res_smtp_put = client.put(
            "/api/admin/email-config",
            json={
                "enabled": True,
                "host": "smtp.qq.com",
                "port": 465,
                "username": "1018784543@qq.com",
                "sender_email": "1018784543@qq.com",
                "sender_name": "Mini Pipeline Admin",
                "use_ssl": True,
                "use_tls": False,
            },
            headers=h_admin,
        )
        assert res_smtp_put.status_code == 200
        assert services.email_service.settings.sender_name == "Mini Pipeline Admin"

        # Send test email
        res_test_send = client.post(
            "/api/admin/test-email",
            json={"to_email": "1018784543@qq.com"},
            headers=h_admin,
        )
        assert res_test_send.status_code == 200


def test_pipeline_completion_email_dispatch(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        services = client.app.state.services
        mock_notify = MagicMock()
        services.email_service.send_pipeline_notification = mock_notify

        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # Update admin email
        client.patch(
            "/api/auth/me",
            json={"email": "admin@example.com"},
            headers=h_admin,
        )

        # Create dummy pipeline and trigger run
        with services.database.session() as s:
            pipe = PipelineDefinition(
                id="pipe-email-test",
                name="Email Test Pipeline",
                definition="steps: []",
                owner_id=admin["user"]["id"],
            )
            s.add(pipe)

        # Submit run directly through repository
        run = services.run_repository.create(
            pipeline_name="Email Test Pipeline",
            params={},
            tasks=[],
            owner_id=admin["user"]["id"],
            pipeline_id="pipe-email-test",
        )

        # Trigger notification dispatch
        services.engine._dispatch_email_notification(
            run.id,
            status=MagicMock(value="SUCCESS"),
            message="Pipeline completed",
        )

        assert mock_notify.called
        call_kwargs = mock_notify.call_args.kwargs
        assert call_kwargs["to_email"] == "admin@example.com"
        assert call_kwargs["pipeline_name"] == "Email Test Pipeline"
        assert call_kwargs["status"] == "SUCCESS"


def test_verification_code_retry_attempts_decrement_and_exhaustion(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        services = client.app.state.services
        services.email_service.send_email_sync = MagicMock(return_value=True)

        # Bootstrap admin
        register_user(client, "admin")
        test_email = "bob@example.com"

        # Register Bob with standard endpoint so we can test OTP login
        client.post(
            "/api/auth/register",
            json={
                "username": "bob",
                "password": "bob_password_123",
                "email": test_email,
            },
        )

        # Send login code
        res_send = client.post(
            "/api/auth/send-code",
            json={"email": test_email, "purpose": "login"},
        )
        assert res_send.status_code == 200

        # Attempt 1: wrong code -> should prompt 4 attempts left
        r1 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r1.status_code == 422
        assert "还剩 4 次尝试机会" in r1.text

        # Attempt 2: wrong code -> should prompt 3 attempts left
        r2 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r2.status_code == 422
        assert "还剩 3 次尝试机会" in r2.text

        # Attempt 3: wrong code -> should prompt 2 attempts left
        r3 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r3.status_code == 422
        assert "还剩 2 次尝试机会" in r3.text

        # Attempt 4: wrong code -> should prompt 1 attempt left
        r4 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r4.status_code == 422
        assert "还剩 1 次尝试机会" in r4.text

        # Attempt 5: wrong code -> should exhaust attempts and invalidate
        r5 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r5.status_code == 422
        assert "失效" in r5.text or "过多" in r5.text

        # Attempt 6: now code is invalid/used
        r6 = client.post("/api/auth/login-otp", json={"email": test_email, "code": "000000"})
        assert r6.status_code == 422


def test_registration_sends_welcome_email(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        services = client.app.state.services
        mock_welcome = MagicMock()
        services.email_service.send_welcome_email = mock_welcome

        # Register user with email
        res = client.post(
            "/api/auth/register",
            json={
                "username": "charlie",
                "password": "charlie_password_123",
                "email": "charlie@example.com",
                "display_name": "Charlie Chaplin",
            },
        )
        assert res.status_code == 201
        assert mock_welcome.called
        call_kwargs = mock_welcome.call_args.kwargs
        assert call_kwargs["to_email"] == "charlie@example.com"
        assert call_kwargs["username"] == "charlie"
        assert call_kwargs["display_name"] == "Charlie Chaplin"

