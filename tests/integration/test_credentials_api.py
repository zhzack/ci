"""Integration tests for Credential & Secret Vault API and workflows."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_credentials_crud_and_masking(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        alice = register_user(client, "alice")
        h_alice = auth_headers(alice["token"])

        # 1. Create Username / Password Credential (e.g. for Git HTTP/HTTPS Clone)
        res = client.post(
            "/api/credentials",
            json={
                "name": "gitee-git-auth",
                "type": "username_password",
                "scope": "personal",
                "payload": {
                    "username": "alice_dev",
                    "password": "super_secret_git_password",
                },
                "description": "Credentials for Gitee private repository clone",
            },
            headers=h_alice,
        )
        assert res.status_code == 201, res.text
        created = res.json()
        assert created["name"] == "gitee-git-auth"
        assert created["type"] == "username_password"
        assert created["data"]["username"] == "alice_dev"
        assert created["data"]["password"] == "••••••••"  # Masked!
        cred_id = created["id"]

        # 2. Create Secret Text Credential (e.g. for GitHub PAT / API Token)
        res = client.post(
            "/api/credentials",
            json={
                "name": "github-ci-token",
                "type": "secret_text",
                "scope": "personal",
                "payload": {
                    "secret": "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
                },
                "description": "GitHub Personal Access Token for release",
            },
            headers=h_alice,
        )
        assert res.status_code == 201, res.text
        token_cred = res.json()
        assert token_cred["data"]["secret"] == "••••••••"
        assert token_cred["data"]["length"] > 10

        # 3. List Credentials: Check that both are returned and masked
        res = client.get("/api/credentials", headers=h_alice)
        assert res.status_code == 200
        creds = res.json()
        assert len(creds) == 2
        names = [c["name"] for c in creds]
        assert "gitee-git-auth" in names and "github-ci-token" in names

        # 4. Read Raw Decrypted Data (only owner)
        res = client.get(f"/api/credentials/{cred_id}/raw", headers=h_alice)
        assert res.status_code == 200, res.text
        raw_data = res.json()
        assert raw_data["data"]["username"] == "alice_dev"
        assert raw_data["data"]["password"] == "super_secret_git_password"

        # 5. Update Credential Description & Password
        res = client.put(
            f"/api/credentials/{cred_id}",
            json={
                "description": "Updated description for gitee auth",
                "payload": {
                    "username": "alice_dev",
                    "password": "new_secret_password_999",
                },
            },
            headers=h_alice,
        )
        assert res.status_code == 200, res.text
        assert res.json()["description"] == "Updated description for gitee auth"

        # Verify updated raw password
        res = client.get(f"/api/credentials/{cred_id}/raw", headers=h_alice)
        assert res.json()["data"]["password"] == "new_secret_password_999"

        # 6. Delete Credential
        res = client.delete(f"/api/credentials/{cred_id}", headers=h_alice)
        assert res.status_code == 204

        # Verify deleted
        res = client.get(f"/api/credentials/{cred_id}", headers=h_alice)
        assert res.status_code == 404


def test_credentials_rbac_and_scope_isolation(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        alice = register_user(client, "alice")
        bob = register_user(client, "bob")

        h_admin = auth_headers(admin["token"])
        h_alice = auth_headers(alice["token"])
        h_bob = auth_headers(bob["token"])

        # 1. Alice creates personal credential
        res = client.post(
            "/api/credentials",
            json={
                "name": "alice-private-key",
                "type": "ssh_key",
                "scope": "personal",
                "payload": {"private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."},
                "description": "Alice's private deploy key",
            },
            headers=h_alice,
        )
        assert res.status_code == 201
        alice_cred_id = res.json()["id"]

        # Bob cannot see Alice's personal credential in list
        res = client.get("/api/credentials", headers=h_bob)
        assert res.status_code == 200
        bob_creds = res.json()
        assert not any(c["id"] == alice_cred_id for c in bob_creds)

        # Bob cannot read Alice's credential directly (403)
        res = client.get(f"/api/credentials/{alice_cred_id}", headers=h_bob)
        assert res.status_code == 403

        # Bob cannot view Alice's raw decrypted credential (403)
        res = client.get(f"/api/credentials/{alice_cred_id}/raw", headers=h_bob)
        assert res.status_code == 403

        # 2. Non-admin user cannot create global credential (403)
        res = client.post(
            "/api/credentials",
            json={
                "name": "global-forbidden",
                "type": "secret_text",
                "scope": "global",
                "payload": {"secret": "abc"},
            },
            headers=h_alice,
        )
        assert res.status_code == 403

        # 3. Admin creates global credential (visible to all users)
        res = client.post(
            "/api/credentials",
            json={
                "name": "company-npm-token",
                "type": "secret_text",
                "scope": "global",
                "payload": {"secret": "npm_corporate_token_secret"},
                "description": "Global enterprise NPM registry token",
            },
            headers=h_admin,
        )
        assert res.status_code == 201
        global_id = res.json()["id"]

        # Bob can see global credential in his list
        res = client.get("/api/credentials", headers=h_bob)
        assert res.status_code == 200
        assert any(c["id"] == global_id for c in res.json())
