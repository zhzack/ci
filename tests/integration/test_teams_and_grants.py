"""Integration tests for Teams management and team-based resource grants."""

from __future__ import annotations

from fastapi.testclient import TestClient

from mini_pipeline.server.app import create_app
from tests.integration.test_account_machine import (
    auth_headers,
    authed_settings,
    register_user,
)


def test_admin_team_lifecycle(tmp_path):
    """Verify team creation, listing, member addition and member removal."""
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        # First registered user is automatically admin
        admin = register_user(client, "admin")
        admin_h = auth_headers(admin["token"])

        # Second user is regular user
        alice = register_user(client, "alice")
        alice_h = auth_headers(alice["token"])

        # Regular user cannot create teams
        res = client.post("/api/admin/teams", json={"name": "platform"}, headers=alice_h)
        assert res.status_code == 403

        # Admin creates team
        res = client.post("/api/admin/teams", json={"name": "platform"}, headers=admin_h)
        assert res.status_code == 201
        team = res.json()
        assert team["name"] == "platform"
        team_id = team["id"]

        # Admin lists teams
        res = client.get("/api/admin/teams", headers=admin_h)
        assert res.status_code == 200
        teams = res.json()
        assert any(t["id"] == team_id and t["name"] == "platform" for t in teams)

        # Authenticated regular user can list teams via /api/teams
        res = client.get("/api/teams", headers=alice_h)
        assert res.status_code == 200
        teams_public = res.json()
        assert any(t["id"] == team_id for t in teams_public)

        # Add alice to team
        res = client.post(
            f"/api/admin/teams/{team_id}/members",
            json={"user_id": alice["user"]["id"]},
            headers=admin_h,
        )
        assert res.status_code == 204

        # Check membership
        res = client.get("/api/admin/teams", headers=admin_h)
        team_data = next(t for t in res.json() if t["id"] == team_id)
        assert alice["user"]["id"] in team_data["member_ids"]

        # Remove alice from team
        res = client.delete(
            f"/api/admin/teams/{team_id}/members/{alice['user']['id']}",
            headers=admin_h,
        )
        assert res.status_code == 204

        # Verify alice is removed
        res = client.get("/api/admin/teams", headers=admin_h)
        team_data = next(t for t in res.json() if t["id"] == team_id)
        assert alice["user"]["id"] not in team_data["member_ids"]


def test_team_based_machine_grant(tmp_path):
    """Verify sharing a personal machine with a team grants operator access to team members."""
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        admin_h = auth_headers(admin["token"])

        owner = register_user(client, "machineman")
        owner_h = auth_headers(owner["token"])

        member = register_user(client, "teammate")
        member_h = auth_headers(member["token"])

        # Admin creates team and adds member
        t_res = client.post("/api/admin/teams", json={"name": "devops"}, headers=admin_h)
        team_id = t_res.json()["id"]
        client.post(
            f"/api/admin/teams/{team_id}/members",
            json={"user_id": member["user"]["id"]},
            headers=admin_h,
        )

        # Owner registers a personal machine via POST /api/machines
        m_res = client.post(
            "/api/machines",
            json={"name": "test-box", "notes": "my box"},
            headers=owner_h,
        )
        assert m_res.status_code == 201
        machine = m_res.json()["machine"]
        machine_id = machine["id"]

        # Before share: teammate cannot see this personal machine in /api/machines
        res = client.get("/api/machines", headers=member_h)
        assert not any(m["id"] == machine_id for m in res.json())

        # Owner shares machine with team
        g_res = client.post(
            "/api/grants",
            json={
                "resource_type": "machine",
                "resource_id": machine_id,
                "grantee_type": "team",
                "grantee_id": team_id,
                "permission": "operator",
            },
            headers=owner_h,
        )
        assert g_res.status_code == 201
        grant_id = g_res.json()["id"]

        # List grants
        list_g = client.get(
            f"/api/grants?resource_type=machine&resource_id={machine_id}",
            headers=owner_h,
        )
        assert list_g.status_code == 200
        assert any(g["grantee_id"] == team_id for g in list_g.json())

        # After share: teammate sees the machine in /api/machines!
        res = client.get("/api/machines", headers=member_h)
        assert any(m["id"] == machine_id for m in res.json())

        # Owner revokes grant
        del_res = client.delete(f"/api/grants/{grant_id}", headers=owner_h)
        assert del_res.status_code == 204

        # Teammate can no longer see the machine
        res = client.get("/api/machines", headers=member_h)
        assert not any(m["id"] == machine_id for m in res.json())


def test_team_based_pipeline_grant(tmp_path):
    """Verify sharing a pipeline with a team allows team members to read and list the pipeline."""
    settings = authed_settings(tmp_path)
    app = create_app(settings)

    with TestClient(app) as client:
        admin = register_user(client, "admin")
        admin_h = auth_headers(admin["token"])

        author = register_user(client, "author")
        author_h = auth_headers(author["token"])

        colleague = register_user(client, "colleague")
        colleague_h = auth_headers(colleague["token"])

        # Admin creates team and adds colleague
        t_res = client.post("/api/admin/teams", json={"name": "pipeline-readers"}, headers=admin_h)
        team_id = t_res.json()["id"]
        client.post(
            f"/api/admin/teams/{team_id}/members",
            json={"user_id": colleague["user"]["id"]},
            headers=admin_h,
        )

        # Author creates pipeline
        p_res = client.post(
            "/api/pipelines",
            json={
                "definition": "name: secret-pipe\nsteps:\n  - {name: s1, plugin: echo@1.0.0}\n"
            },
            headers=author_h,
        )
        assert p_res.status_code == 201
        pipe_id = p_res.json()["id"]
        assert p_res.json()["owner_id"] == author["user"]["id"]

        # Before share: colleague cannot view or list pipeline
        res = client.get(f"/api/pipelines/{pipe_id}", headers=colleague_h)
        assert res.status_code == 404
        list_res = client.get("/api/pipelines", headers=colleague_h)
        assert not any(p["id"] == pipe_id for p in list_res.json()["items"])

        # Author shares pipeline with team
        g_res = client.post(
            "/api/grants",
            json={
                "resource_type": "pipeline",
                "resource_id": pipe_id,
                "grantee_type": "team",
                "grantee_id": team_id,
                "permission": "viewer",
            },
            headers=author_h,
        )
        assert g_res.status_code == 201

        # After share: colleague CAN view and list pipeline!
        res = client.get(f"/api/pipelines/{pipe_id}", headers=colleague_h)
        assert res.status_code == 200
        assert "secret-pipe" in res.text
        list_res = client.get("/api/pipelines", headers=colleague_h)
        assert any(p["id"] == pipe_id for p in list_res.json()["items"])
