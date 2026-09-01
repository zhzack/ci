"""Integration tests for Machine SSH Deploy Keys and Builtin Master Node."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_builtin_master_machine_and_deploy_keys(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # First registered user is automatically admin
        admin = register_user(client, "admin_user")
        h_admin = auth_headers(admin["token"])

        # Second registered user is regular user
        bob = register_user(client, "bob")
        h_bob = auth_headers(bob["token"])

        # 1. Admin should see master-local builtin machine
        res_admin = client.get("/api/machines", headers=h_admin)
        assert res_admin.status_code == 200, res_admin.text
        machines_admin = res_admin.json()
        master_node = next((m for m in machines_admin if m["id"] == "master-local"), None)
        assert master_node is not None
        assert master_node["labels"].get("builtin") is True
        assert master_node["online"] is True

        # 2. Regular user (Bob) should NOT see master-local machine
        res_bob = client.get("/api/machines", headers=h_bob)
        assert res_bob.status_code == 200, res_bob.text
        machines_bob = res_bob.json()
        assert not any(m["id"] == "master-local" for m in machines_bob)

        # 3. Get system deploy key
        res_key = client.get("/api/system/deploy-key", headers=h_admin)
        assert res_key.status_code == 200, res_key.text
        key_data = res_key.json()
        assert "ssh-ed25519" in key_data["key_type"] or "ssh-rsa" in key_data["key_type"]
        assert key_data["public_key"].startswith("ssh-")
        assert key_data["fingerprint"].startswith("SHA256:")

        # 4. Get machine deploy key for master-local
        res_m_key = client.get("/api/machines/master-local/deploy-key", headers=h_admin)
        assert res_m_key.status_code == 200, res_m_key.text
        assert res_m_key.json()["public_key"] == key_data["public_key"]

        # 5. Regular user cannot get deploy key for master-local
        res_bob_denied = client.get("/api/machines/master-local/deploy-key", headers=h_bob)
        assert res_bob_denied.status_code == 403
