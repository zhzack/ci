"""Integration tests for Credential Domain Pattern Wildcard Matching."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from mini_pipeline.account.credential_service import match_domain_pattern
from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_match_domain_pattern_pure_logic() -> None:
    # Wildcard host
    assert match_domain_pattern("https://gitee.com/org/repo.git", "*.gitee.com")
    assert match_domain_pattern("https://api.gitee.com/v1", "*.gitee.com")
    assert match_domain_pattern("git@gitee.com:org/repo.git", "*.gitee.com")
    assert not match_domain_pattern("https://github.com/org/repo.git", "*.gitee.com")

    # Host with port
    assert match_domain_pattern("http://nexus.corp.internal:8081/npm", "nexus.corp.internal:*")
    assert match_domain_pattern("http://nexus.corp.internal:8081/npm", "nexus.corp.internal:8081")

    # Full URL prefix
    assert match_domain_pattern(
        "https://nexus.corp.internal/repository/npm/pkg.tgz",
        "https://nexus.corp.internal/*",
    )


def test_credentials_domain_match_api(tmp_path: Path) -> None:
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        alice = register_user(client, "alice")
        h_alice = auth_headers(alice["token"])

        # 1. Create a credential with domain patterns
        res1 = client.post(
            "/api/credentials",
            json={
                "name": "gitee-org-cred",
                "type": "username_password",
                "scope": "personal",
                "payload": {"username": "alice", "password": "gitee_password"},
                "domain_patterns": ["*.gitee.com", "gitee.com"],
            },
            headers=h_alice,
        )
        assert res1.status_code == 201, res1.text
        assert res1.json()["domain_patterns"] == ["*.gitee.com", "gitee.com"]

        # 2. Create another credential for Nexus
        res2 = client.post(
            "/api/credentials",
            json={
                "name": "nexus-token",
                "type": "secret_text",
                "scope": "personal",
                "payload": {"secret": "nexus_secret_key"},
                "domain_patterns": ["nexus.corp.internal:*", "https://nexus.corp.internal/*"],
            },
            headers=h_alice,
        )
        assert res2.status_code == 201, res2.text

        # 3. Test matching Gitee URL
        match_gitee = client.get(
            "/api/credentials/match?url=https://gitee.com/myteam/awesome-plugin.git",
            headers=h_alice,
        )
        assert match_gitee.status_code == 200, match_gitee.text
        matched = match_gitee.json()
        assert len(matched) == 1
        assert matched[0]["name"] == "gitee-org-cred"

        # 4. Test matching Nexus URL
        match_nexus = client.get(
            "/api/credentials/match?url=http://nexus.corp.internal:8081/repository/npm/app.tgz",
            headers=h_alice,
        )
        assert match_nexus.status_code == 200, match_nexus.text
        matched_nexus = match_nexus.json()
        assert len(matched_nexus) == 1
        assert matched_nexus[0]["name"] == "nexus-token"

        # 5. Test unmatched URL
        match_none = client.get(
            "/api/credentials/match?url=https://gitlab.unknown.com/repo.git",
            headers=h_alice,
        )
        assert match_none.status_code == 200, match_none.text
        assert len(match_none.json()) == 0
