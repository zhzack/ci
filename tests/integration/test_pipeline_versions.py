"""Pipeline definition versioning: snapshots, list/detail, rollback.

History is append-only: every create and every definition *change* records a
new snapshot; rollback restores an old definition by recording it as the
newest version, so nothing is ever destroyed.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_platform_features import build_settings


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register(client: TestClient, username: str) -> dict:
    r = client.post(
        "/api/auth/register",
        json={"username": username, "password": "password-123"},
    )
    assert r.status_code == 201, r.text
    return r.json()


V1 = "name: versioned-demo\nsteps:\n  - {name: go, plugin: echo@1.0.0}\n"
V2 = (
    "name: versioned-demo\n"
    "params:\n"
    "  region: cn-north-1\n"
    "steps:\n"
    "  - {name: go, plugin: echo@1.0.0}\n"
)


def test_pipeline_versioning_lifecycle(tmp_path) -> None:
    settings = build_settings(
        tmp_path,
        auth={"enabled": True, "registration_enabled": True},
        security={"secret_key": "unit-test-secret-key"},
    )
    with TestClient(create_app(settings)) as client:
        user = _register(client, "root")
        headers = auth_headers(user["token"])

        created = client.post(
            "/api/pipelines", json={"definition": V1}, headers=headers
        )
        assert created.status_code == 201, created.text
        pipeline_id = created.json()["id"]

        # 1. Creation records version 1.
        versions = client.get(
            f"/api/pipelines/{pipeline_id}/versions", headers=headers
        ).json()
        assert versions["total"] == 1
        assert versions["items"][0]["version"] == 1

        # 2. A real definition change records version 2.
        updated = client.put(
            f"/api/pipelines/{pipeline_id}",
            json={"definition": V2},
            headers=headers,
        )
        assert updated.status_code == 200
        versions = client.get(
            f"/api/pipelines/{pipeline_id}/versions", headers=headers
        ).json()
        assert versions["total"] == 2
        assert versions["items"][0]["version"] == 2  # newest first

        # 3. Updating with identical text does NOT add a version.
        client.put(
            f"/api/pipelines/{pipeline_id}",
            json={"definition": V2},
            headers=headers,
        )
        versions = client.get(
            f"/api/pipelines/{pipeline_id}/versions", headers=headers
        ).json()
        assert versions["total"] == 2

        # 4. Detail endpoint returns the full definition text.
        detail = client.get(
            f"/api/pipelines/{pipeline_id}/versions/1", headers=headers
        ).json()
        assert detail["definition"] == V1

        # 5. Rollback to v1: recorded as version 3, definition restored.
        rolled = client.post(
            f"/api/pipelines/{pipeline_id}/rollback/1", headers=headers
        )
        assert rolled.status_code == 200, rolled.text
        assert rolled.json()["id"] == pipeline_id

        current = client.get(
            f"/api/pipelines/{pipeline_id}", headers=headers
        )
        # The identifier endpoint returns the raw YAML definition.
        assert current.headers["content-type"].startswith("application/yaml")
        assert current.text == V1

        versions = client.get(
            f"/api/pipelines/{pipeline_id}/versions", headers=headers
        ).json()
        assert versions["total"] == 3
        assert versions["items"][0]["version"] == 3

        detail3 = client.get(
            f"/api/pipelines/{pipeline_id}/versions/3", headers=headers
        ).json()
        assert detail3["definition"] == V1

        # 6. The rolled-back pipeline still parses and accepts runs (plugins
        #    registered in this test file are not required for this check).
        parsed = client.get(
            f"/api/pipelines/{pipeline_id}/params-schema", headers=headers
        )
        assert parsed.status_code == 200, parsed.text


def test_rollback_requires_manage_permission(tmp_path) -> None:
    settings = build_settings(
        tmp_path,
        auth={"enabled": True, "registration_enabled": True},
        security={"secret_key": "unit-test-secret-key"},
    )
    with TestClient(create_app(settings)) as client:
        owner = _register(client, "owner1")
        other = _register(client, "intruder")
        created = client.post(
            "/api/pipelines", json={"definition": V1},
            headers=auth_headers(owner["token"]),
        )
        assert created.status_code == 201
        pipeline_id = created.json()["id"]

        # Another user cannot even see a private pipeline's versions.
        forbidden = client.get(
            f"/api/pipelines/{pipeline_id}/versions",
            headers=auth_headers(other["token"]),
        )
        assert forbidden.status_code in (403, 404)

        # And cannot roll it back.
        rolled = client.post(
            f"/api/pipelines/{pipeline_id}/rollback/1",
            headers=auth_headers(other["token"]),
        )
        assert rolled.status_code in (403, 404)

        # Unknown version -> 404.
        detail = client.get(
            f"/api/pipelines/{pipeline_id}/versions/99",
            headers=auth_headers(owner["token"]),
        )
        assert detail.status_code == 404
