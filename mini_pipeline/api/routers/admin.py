"""Platform admin console: users, teams, machines overview, publish review."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from mini_pipeline.account.service import Principal
from mini_pipeline.api.auth import require_admin
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/admin", tags=["admin"])

AdminPrincipal = Annotated[Principal, Depends(require_admin)]


class TeamCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class TeamMemberRequest(BaseModel):
    user_id: str


class RoleRequest(BaseModel):
    role: str = Field(pattern="^(admin|user)$")


class StatusRequest(BaseModel):
    status: str = Field(pattern="^(active|disabled)$")


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8)
    display_name: str = ""
    email: str | None = None
    role: str = Field(default="user", pattern="^(admin|user)$")
    must_change_password: bool = True


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
    must_change_password: bool = True


@router.get("/users")
def list_users(
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> list[dict[str, Any]]:
    _ = principal
    return [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "email": u.email,
            "role": u.role,
            "status": u.status,
            "must_change_password": getattr(u, "must_change_password", False),
            "created_at": u.created_at,
        }
        for u in services.users.list()
    ]


@router.post("/users", status_code=201)
def admin_create_user(
    payload: AdminCreateUserRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    user = services.account.admin_create_user(
        username=payload.username,
        password=payload.password,
        display_name=payload.display_name,
        email=payload.email,
        role=payload.role,
        must_change_password=payload.must_change_password,
    )
    # Ensure personal storage zone for newly created user
    services.package_storage.ensure_user_zone(user.username)
    services.audit.record(
        principal,
        "user.create",
        resource_type="user",
        resource_id=user.id,
        detail={
            "username": user.username,
            "role": user.role,
            "email": user.email,
            "must_change_password": user.must_change_password,
        },
    )
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "must_change_password": user.must_change_password,
        "created_at": user.created_at,
    }


@router.post("/users/{user_id}/reset-password")
def admin_reset_password(
    user_id: str,
    payload: AdminResetPasswordRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    user = services.users.get(user_id)
    services.account.change_password(
        user_id=user_id,
        new_password=payload.new_password,
        is_admin_override=True,
        must_change_password=payload.must_change_password,
    )
    services.sessions.revoke_user_sessions(user_id)
    services.audit.record(
        principal,
        "user.reset_password",
        resource_type="user",
        resource_id=user_id,
        detail={"must_change_password": payload.must_change_password},
    )
    return {"message": f"Password for user {user.username} reset successfully"}



@router.patch("/users/{user_id}/role")
def set_user_role(
    user_id: str,
    payload: RoleRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    services.users.get(user_id)
    services.users.set_role(user_id, payload.role)
    services.audit.record(
        principal, "user.set_role", resource_type="user", resource_id=user_id,
        detail={"role": payload.role},
    )
    return {"id": user_id, "role": payload.role}


@router.patch("/users/{user_id}/status")
def set_user_status(
    user_id: str,
    payload: StatusRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    services.users.get(user_id)
    services.users.set_status(user_id, payload.status)
    if payload.status == "disabled":
        services.sessions.revoke_user_sessions(user_id)
    services.audit.record(
        principal, "user.set_status", resource_type="user", resource_id=user_id,
        detail={"status": payload.status},
    )
    return {"id": user_id, "status": payload.status}


@router.post("/teams", status_code=201)
def create_team(
    payload: TeamCreateRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    team = services.teams.create(name=payload.name, created_by=principal.user_id)
    return {"id": team.id, "name": team.name, "created_at": team.created_at}


@router.get("/teams")
def list_teams(
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> list[dict[str, Any]]:
    _ = principal
    result = []
    for team in services.teams.list():
        members = services.teams.members_of(team.id)
        result.append(
            {
                "id": team.id,
                "name": team.name,
                "member_ids": [m.user_id for m in members],
            }
        )
    return result


@router.post("/teams/{team_id}/members", status_code=204)
def add_team_member(
    team_id: str,
    payload: TeamMemberRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    services.users.get(payload.user_id)
    services.teams.add_member(team_id=team_id, user_id=payload.user_id)
    _ = principal
    return Response(status_code=204)


@router.delete("/teams/{team_id}/members/{user_id}", status_code=204)
def remove_team_member(
    team_id: str,
    user_id: str,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    services.teams.remove_member(team_id=team_id, user_id=user_id)
    _ = principal
    return Response(status_code=204)


@router.get("/audit")
def list_audit(
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
    limit: int = 100,
) -> list[dict[str, Any]]:
    _ = principal
    return [
        {
            "id": entry.id,
            "user_id": entry.user_id,
            "action": entry.action,
            "resource_type": entry.resource_type,
            "resource_id": entry.resource_id,
            "detail": entry.detail,
            "request_id": entry.request_id,
            "created_at": entry.created_at,
        }
        for entry in services.audit.audit.list(limit=min(limit, 500))
    ]
