"""Integration tests for admin user management, forced password change,
email, and package ACL grants.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_admin_user_creation_and_forced_password_change(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # Bootstrap admin
        admin = register_user(client, "admin")
        h_admin = auth_headers(admin["token"])

        # 1. Admin creates user with email and must_change_password=True
        create_res = client.post(
            "/api/admin/users",
            json={
                "username": "david",
                "password": "initial_password_123",
                "display_name": "David Dev",
                "email": "david@company.com",
                "role": "user",
                "must_change_password": True,
            },
            headers=h_admin,
        )
        assert create_res.status_code == 201, create_res.text
        user_data = create_res.json()
        assert user_data["username"] == "david"
        assert user_data["email"] == "david@company.com"
        assert user_data["must_change_password"] is True

        # 2. David logs in
        login_res = client.post(
            "/api/auth/login",
            json={"username": "david", "password": "initial_password_123"},
        )
        assert login_res.status_code == 200, login_res.text
        david_token = login_res.json()["token"]
        h_david = auth_headers(david_token)

        me_res = client.get("/api/auth/me", headers=h_david)
        assert me_res.status_code == 200
        assert me_res.json()["must_change_password"] is True
        assert me_res.json()["email"] == "david@company.com"

        # 3. David changes password
        pwd_res = client.post(
            "/api/auth/change-password",
            json={
                "old_password": "initial_password_123",
                "new_password": "david_new_secure_pass",
            },
            headers=h_david,
        )
        assert pwd_res.status_code == 200, pwd_res.text

        # 4. must_change_password is now False
        me_res = client.get("/api/auth/me", headers=h_david)
        assert me_res.json()["must_change_password"] is False

        # 5. David updates profile
        update_res = client.patch(
            "/api/auth/me",
            json={"display_name": "David Pro", "email": "david.new@company.com"},
            headers=h_david,
        )
        assert update_res.status_code == 200
        assert update_res.json()["display_name"] == "David Pro"
        assert update_res.json()["email"] == "david.new@company.com"


def test_package_directory_grants_and_acl(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        alice = register_user(client, "alice")
        bob = register_user(client, "bob")

        h_admin = auth_headers(admin["token"])
        h_alice = auth_headers(alice["token"])
        h_bob = auth_headers(bob["token"])

        # 1. Alice creates files in personal/alice/docs/notes.txt
        res = client.put(
            "/api/packages/file",
            json={"path": "personal/alice/docs/notes.txt", "content": "alice confidential notes"},
            headers=h_alice,
        )
        assert res.status_code == 200, res.text

        # 2. Bob cannot access personal/alice/docs
        res = client.get("/api/packages", params={"path": "personal/alice/docs"}, headers=h_bob)
        assert res.status_code == 403

        # 3. Alice grants Bob viewer permission to personal/alice/docs
        grant_res = client.post(
            "/api/packages/grants",
            json={
                "path": "personal/alice/docs",
                "grantee_type": "user",
                "grantee_id": bob["user"]["id"],
                "permission": "viewer",
            },
            headers=h_alice,
        )
        assert grant_res.status_code == 201, grant_res.text
        grant_id = grant_res.json()["id"]

        # 4. Bob can now list and preview personal/alice/docs
        res = client.get("/api/packages", params={"path": "personal/alice/docs"}, headers=h_bob)
        assert res.status_code == 200, res.text
        assert any(i["name"] == "notes.txt" for i in res.json()["items"])

        preview_res = client.get(
            "/api/packages/preview",
            params={"path": "personal/alice/docs/notes.txt"},
            headers=h_bob,
        )
        assert preview_res.status_code == 200
        assert preview_res.json()["content"] == "alice confidential notes"

        # 5. Bob cannot write since grant is viewer (read-only)
        write_res = client.put(
            "/api/packages/file",
            json={"path": "personal/alice/docs/malicious.txt", "content": "bad"},
            headers=h_bob,
        )
        assert write_res.status_code == 403

        # 6. Alice revokes grant
        del_res = client.delete(f"/api/packages/grants/{grant_id}", headers=h_alice)
        assert del_res.status_code == 200

        # 7. Bob access is revoked
        res = client.get("/api/packages", params={"path": "personal/alice/docs"}, headers=h_bob)
        assert res.status_code == 403

        # 8. Admin can always access
        res = client.get("/api/packages", params={"path": "personal/alice/docs"}, headers=h_admin)
        assert res.status_code == 200
