from __future__ import annotations

import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def _create_dummy_git_repo(repo_dir: Path) -> str:
    repo_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "init", "-b", "main"], cwd=str(repo_dir), check=True, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.name", "Test Runner"], cwd=str(repo_dir), check=True
    )
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"], cwd=str(repo_dir), check=True
    )

    # Add manifest
    manifest = repo_dir / "plugin.yaml"
    manifest.write_text(
        "name: git-demo\nversion: 1.0.0\nruntime:\n  type: python\n  entry: run.py\n"
    )
    run_file = repo_dir / "run.py"
    run_file.write_text("print('hello from git plugin')\n")

    subprocess.run(["git", "add", "."], cwd=str(repo_dir), check=True)
    subprocess.run(["git", "commit", "-m", "initial commit"], cwd=str(repo_dir), check=True)
    subprocess.run(["git", "branch", "feature/awesome"], cwd=str(repo_dir), check=True)
    subprocess.run(["git", "tag", "v1.0.0"], cwd=str(repo_dir), check=True)
    return str(repo_dir)


def test_git_branches_detection_and_register(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    repo_dir = tmp_path / "sample_git_repo"
    repo_path = _create_dummy_git_repo(repo_dir)

    with TestClient(app) as client:
        alice = register_user(client, "alice")
        h_alice = auth_headers(alice["token"])

        # 1. Create a personal credential for Git
        cred_res = client.post(
            "/api/credentials",
            json={
                "name": "git-local-auth",
                "type": "username_password",
                "scope": "personal",
                "payload": {
                    "username": "test_user",
                    "password": "test_password",
                },
                "description": "Git auth token",
            },
            headers=h_alice,
        )
        assert cred_res.status_code == 201, cred_res.text
        cred_id = cred_res.json()["id"]

        # 2. Probe git branches using the API
        branches_res = client.post(
            "/api/plugins/git-branches",
            json={
                "url": repo_path,
                "credential_id": cred_id,
            },
            headers=h_alice,
        )
        assert branches_res.status_code == 200, branches_res.text
        data = branches_res.json()
        assert "main" in data["branches"]
        assert "feature/awesome" in data["branches"]
        assert "v1.0.0" in data["tags"]
        assert data["default_branch"] in ["main", "feature/awesome"]

        # 3. Register plugin using Git source with credential_id and branch
        reg_res = client.post(
            "/api/plugins/register",
            json={
                "source": {
                    "type": "git",
                    "url": repo_path,
                    "branch": "main",
                    "credential_id": cred_id,
                }
            },
            headers=h_alice,
        )
        assert reg_res.status_code == 201, reg_res.text
        plugin = reg_res.json()
        assert plugin["name"] == "git-demo"
        assert plugin["version"] == "1.0.0"


def test_packages_import_remote_with_credentials(tmp_path: Path, monkeypatch) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        alice = register_user(client, "alice")
        h_alice = auth_headers(alice["token"])

        # Create credential for HTTP auth
        cred_res = client.post(
            "/api/credentials",
            json={
                "name": "nexus-token",
                "type": "secret_text",
                "scope": "personal",
                "payload": {"secret": "secret_bearer_token_123"},
            },
            headers=h_alice,
        )
        cred_id = cred_res.json()["id"]

        # Mock httpx.stream to simulate a remote file download
        from contextlib import contextmanager

        import httpx

        class MockStreamResponse:
            def raise_for_status(self):
                pass
            def iter_bytes(self, chunk_size=65536):
                yield b"REMOTE-PACKAGE-PAYLOAD-CONTENT"

        @contextmanager
        def mock_stream(method, url, auth=None, headers=None, **kwargs):
            # Verify auth header received
            assert headers.get("Authorization") == "Bearer secret_bearer_token_123"
            yield MockStreamResponse()

        monkeypatch.setattr(httpx, "stream", mock_stream)

        # Import remote file into personal storage
        import_res = client.post(
            "/api/packages/import-remote",
            json={
                "url": "https://nexus.corp.internal/repository/npm/my-package-1.0.0.tgz",
                "target_dir": "personal/alice",
                "filename": "my-package-1.0.0.tgz",
                "credential_id": cred_id,
            },
            headers=h_alice,
        )
        assert import_res.status_code == 200, import_res.text
        item = import_res.json()
        assert item["name"] == "my-package-1.0.0.tgz"
        assert item["size"] == len(b"REMOTE-PACKAGE-PAYLOAD-CONTENT")
