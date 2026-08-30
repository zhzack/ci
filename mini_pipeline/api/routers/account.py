"""User registration, login, session, and machine management endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from mini_pipeline.account.service import Principal
from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import NotFoundError, PermissionDeniedError, ValidationError

router = APIRouter(tags=["account"])

# Public endpoints (mounted without the global auth dependency): the mode
# probe, registration, and login must be reachable with no token.
public_router = APIRouter(tags=["account"])

_USERNAME_HELP = "3-64 chars: letters, digits, dot, dash, underscore"


class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""
    email: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str | None = None
    new_password: str = Field(min_length=8, description="New password at least 8 characters")


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None = None
    role: str
    status: str
    must_change_password: bool = False
    created_at: datetime

    @classmethod
    def of(cls, user) -> UserOut:
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            role=user.role,
            status=user.status,
            must_change_password=getattr(user, "must_change_password", False),
            created_at=user.created_at,
        )


class AuthResponse(BaseModel):
    token: str
    user: UserOut


def _services(request: Request) -> Services:
    return request.app.state.services


@public_router.get("/auth/mode")
def auth_mode(services: Annotated[Services, Depends(get_services)]) -> dict[str, bool]:
    """Public: lets the UI decide whether to show a login page."""
    return {
        "enabled": services.settings.auth.enabled,
        "registration_enabled": services.account.registration_open(),
    }


@public_router.post("/auth/register", response_model=AuthResponse, status_code=201)
def register(
    payload: RegisterRequest,
    services: Annotated[Services, Depends(get_services)],
) -> AuthResponse:
    user, token = services.account.register(
        username=payload.username,
        password=payload.password,
        display_name=payload.display_name,
        email=payload.email,
    )
    return AuthResponse(token=token, user=UserOut.of(user))


@public_router.post("/auth/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    services: Annotated[Services, Depends(get_services)],
) -> AuthResponse:
    user, token = services.account.login(
        username=payload.username, password=payload.password
    )
    return AuthResponse(token=token, user=UserOut.of(user))


@router.post("/auth/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    from mini_pipeline.api.auth import _extract_token

    _ = principal
    token = _extract_token(request)
    if token:
        services.account.logout(token)
    return response


@router.get("/auth/me", response_model=UserOut)
def me(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> UserOut:
    if principal.user_id is None:
        return UserOut(
            id="anonymous",
            username="anonymous",
            display_name="Anonymous (auth disabled)",
            email=None,
            role="admin",
            status="active",
            must_change_password=False,
            created_at=datetime.utcnow(),
        )
    return UserOut.of(services.users.get(principal.user_id))


@router.patch("/auth/me", response_model=UserOut)
def update_my_profile(
    payload: UpdateProfileRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> UserOut:
    if principal.user_id is None:
        raise PermissionDeniedError("Cannot update anonymous profile")
    user = services.account.update_profile(
        user_id=principal.user_id,
        display_name=payload.display_name,
        email=payload.email,
    )
    return UserOut.of(user)


@router.post("/auth/change-password")
def change_my_password(
    payload: ChangePasswordRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    if principal.user_id is None:
        raise PermissionDeniedError("Cannot change password for anonymous account")
    services.account.change_password(
        user_id=principal.user_id,
        old_password=payload.old_password,
        new_password=payload.new_password,
        is_admin_override=False,
        must_change_password=False,
    )
    return {"message": "Password changed successfully"}



# ---------------------------------------------------------------------------
# Machines
# ---------------------------------------------------------------------------


class PersonalMachineRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    labels: dict[str, str] = Field(default_factory=dict)
    max_concurrency: int = Field(default=2, ge=1, le=64)
    notes: str = ""
    # agent (default): runner pulls; ssh: server pushes over SSH using the
    # connection details below (host/port/username + password or private_key).
    connection_type: str = Field(default="agent", pattern="^(agent|ssh)$")
    connection: dict[str, Any] | None = None


class AdminMachineRequest(PersonalMachineRequest):
    assigned_user_id: str | None = None
    # Optional freeform credentials (e.g. SSH login) — stored encrypted,
    # readable only by platform admins; never exposed to assignees.
    credentials: dict[str, Any] | None = None


class MachineOut(BaseModel):
    id: str
    name: str
    kind: str
    connection_type: str = "agent"
    owner_id: str | None
    assigned_user_id: str | None
    labels: dict[str, Any]
    max_concurrency: int
    notes: str
    agent_version: str | None
    status: str  # active | revoked
    online: bool
    last_heartbeat: datetime | None
    has_credentials: bool
    can_manage: bool
    can_use: bool

    @classmethod
    def of(cls, machine, principal: Principal, machines_service) -> MachineOut:
        return cls(
            id=machine.id,
            name=machine.name,
            kind=machine.kind,
            connection_type=machine.connection_type,
            owner_id=machine.owner_id,
            assigned_user_id=machine.assigned_user_id,
            labels=machine.labels or {},
            max_concurrency=machine.max_concurrency,
            notes=machine.notes,
            agent_version=machine.agent_version,
            status=machine.status,
            online=machines_service.is_online(machine),
            last_heartbeat=machine.last_heartbeat,
            has_credentials=bool(machine.credentials),
            can_manage=machines_service.can_manage(principal, machine),
            can_use=machines_service.can_use(principal, machine),
        )


def _validate_ssh_connection(connection: dict[str, Any] | None) -> dict[str, Any]:
    if not connection or not connection.get("host") or not connection.get("username"):
        raise ValidationError(
            "SSH machines require connection.host and connection.username"
        )
    if not connection.get("password") and not connection.get("private_key"):
        raise ValidationError(
            "SSH machines require connection.password or connection.private_key"
        )
    cleaned = dict(connection)
    cleaned["port"] = int(cleaned.get("port", 22))
    return cleaned


@router.get("/machines")
def list_machines(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[MachineOut]:
    """Machines visible to the caller: own personal machines, admin machines
    assigned to them, machines shared with them — everything for admins."""
    visible = []
    for machine in services.machine_repository.list():
        if principal.is_admin or services.machines.can_use(principal, machine):
            visible.append(MachineOut.of(machine, principal, services.machines))
    return visible


@router.post("/machines", status_code=201)
def register_machine(
    payload: PersonalMachineRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Register a personal machine.

    connection_type='agent' (default): the runner token is returned ONCE and
    the machine comes online when the agent starts. connection_type='ssh':
    connection details are stored encrypted and the platform pushes tasks
    over SSH — no agent install, no token.
    """
    connection_payload = None
    if payload.connection_type == "ssh":
        connection_payload = _validate_ssh_connection(payload.connection)
        if not services.settings.security.secret_key:
            raise ValidationError(
                "security.secret_key must be configured to store SSH credentials"
            )
    machine, token = services.machines.register_personal(
        user=principal,
        name=payload.name,
        labels=payload.labels,
        max_concurrency=payload.max_concurrency,
        notes=payload.notes,
        connection_type=payload.connection_type,
        connection=connection_payload,
    )
    services.audit.record(
        principal, "machine.register",
        resource_type="machine", resource_id=machine.id, detail={"name": machine.name},
    )
    return {"machine": MachineOut.of(machine, principal, services.machines), "token": token}


@router.post("/machines/admin", status_code=201)
def create_admin_machine(
    payload: AdminMachineRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Admin-pool machine with optional credentials, assigned to a user."""
    if not principal.is_admin:
        raise PermissionDeniedError("Admin role required")
    credentials_payload = payload.credentials
    if payload.connection_type == "ssh":
        credentials_payload = _validate_ssh_connection(
            payload.connection or payload.credentials
        )
    machine, token = services.machines.create_admin_machine(
        name=payload.name,
        assigned_user_id=payload.assigned_user_id,
        credentials=credentials_payload,
        labels=payload.labels,
        max_concurrency=payload.max_concurrency,
        notes=payload.notes,
        granted_by=principal.user_id,
        connection_type=payload.connection_type,
    )
    services.audit.record(
        principal, "machine.create_admin",
        resource_type="machine", resource_id=machine.id, detail={"name": machine.name},
    )
    return {"machine": MachineOut.of(machine, principal, services.machines), "token": token}


@router.get("/machines/{machine_id}/credentials")
def read_credentials(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    try:
        machine = services.machine_repository.get(machine_id)
    except NotFoundError as exc:
        raise NotFoundError(str(exc)) from exc
    if not services.machines.can_see_credentials(principal, machine):
        raise PermissionDeniedError(
            "Machine credentials are visible only to admins and the personal owner"
        )
    return {"credentials": services.machines.read_credentials(machine)}


@router.post("/machines/{machine_id}/test")
@router.post("/machines/{machine_id}/test-connection")
def test_machine(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Reachability probe: SSH machines get a real connect attempt; agent
    machines report their heartbeat status."""
    machine = services.machine_repository.get(machine_id)
    if not services.machines.can_use(principal, machine):
        raise PermissionDeniedError("No permission to use this machine")
    if machine.connection_type == "ssh":
        return services.ssh_executor.test_connection(machine)
    online = services.machines.is_online(machine)
    return {"ok": online, "online": online}


class MachineUpdateRequest(BaseModel):
    name: str | None = None
    labels: dict[str, str] | None = None
    max_concurrency: int | None = Field(default=None, ge=1, le=64)
    notes: str | None = None
    assigned_user_id: str | None = None
    transfer_to_user_id: str | None = None


@router.patch("/machines/{machine_id}", response_model=MachineOut)
def update_machine(
    machine_id: str,
    payload: MachineUpdateRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> MachineOut:
    machine = services.machine_repository.get(machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only the owner or an admin can manage this machine")
    if payload.transfer_to_user_id:
        services.users.get(payload.transfer_to_user_id)
        services.machines.transfer_ownership(machine, payload.transfer_to_user_id, actor=principal)
        services.audit.record(
            principal, "machine.transfer", resource_type="machine",
            resource_id=machine.id, detail={"to": payload.transfer_to_user_id},
        )
    if payload.assigned_user_id is not None:
        if machine.kind != "admin" or not principal.is_admin:
            raise PermissionDeniedError("Only admins reassign admin machines")
        services.machines.update(machine.id, assigned_user_id=payload.assigned_user_id or None)
        services.audit.record(
            principal, "machine.assign", resource_type="machine",
            resource_id=machine.id, detail={"to": payload.assigned_user_id},
        )
    services.machines.update(
        machine.id,
        name=payload.name,
        labels=payload.labels,
        max_concurrency=payload.max_concurrency,
        notes=payload.notes if payload.notes is not None else "__unset__",
    )
    fresh = services.machine_repository.get(machine_id)
    return MachineOut.of(fresh, principal, services.machines)


@router.post("/machines/{machine_id}/token")
def rotate_token(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    machine = services.machine_repository.get(machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only the owner or an admin can rotate the token")
    token = services.machines.rotate_token(machine)
    services.audit.record(
        principal, "machine.rotate_token", resource_type="machine", resource_id=machine.id,
    )
    return {"token": token}


@router.delete("/machines/{machine_id}", status_code=204)
def revoke_machine(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    from fastapi import Response

    machine = services.machine_repository.get(machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only the owner or an admin can remove this machine")
    services.machines.update(machine.id, status="revoked")
    services.audit.record(
        principal, "machine.revoke", resource_type="machine", resource_id=machine.id,
    )
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Sharing (grants)
# ---------------------------------------------------------------------------


class GrantRequest(BaseModel):
    resource_type: str = Field(pattern="^(pipeline|plugin|machine)$")
    resource_id: str
    grantee_type: str = Field(pattern="^(user|team)$")
    grantee_id: str
    permission: str = Field(pattern="^(viewer|operator)$")


@router.post("/grants", status_code=201)
def create_grant(
    payload: GrantRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    _ensure_resource_owner(principal, services, payload.resource_type, payload.resource_id)
    if payload.grantee_type == "user":
        services.users.get(payload.grantee_id)
    else:
        services.teams.get(payload.grantee_id)
    grant = services.grants.create(
        resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        grantee_type=payload.grantee_type,
        grantee_id=payload.grantee_id,
        permission=payload.permission,
        granted_by=principal.user_id,
    )
    services.audit.record(
        principal, "grant.create", resource_type=payload.resource_type,
        resource_id=payload.resource_id,
        detail={"grantee": payload.grantee_id, "permission": payload.permission},
    )
    return _grant_out(grant)


@router.get("/grants")
def list_grants(
    resource_type: str,
    resource_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[dict[str, Any]]:
    _ensure_resource_owner(principal, services, resource_type, resource_id)
    return [_grant_out(g) for g in services.grants.list_for_resource(resource_type, resource_id)]


@router.delete("/grants/{grant_id}", status_code=204)
def delete_grant(
    grant_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    from fastapi import Response

    grant = services.grants.get(grant_id)
    if grant is None:
        raise NotFoundError(f"Grant {grant_id!r} was not found")
    _ensure_resource_owner(principal, services, grant.resource_type, grant.resource_id)
    services.grants.delete(grant_id)
    return Response(status_code=204)


def _ensure_resource_owner(
    principal: Principal, services: Services, resource_type: str, resource_id: str
) -> None:
    if principal.is_admin:
        return
    owner_id: str | None = None
    if resource_type == "pipeline":
        entity = services.pipeline_repository.get(resource_id)
        owner_id = entity.owner_id
    elif resource_type == "plugin":
        plugin = services.plugin_repository.get(resource_id)
        owner_id = plugin.owner_id
    elif resource_type == "machine":
        owner_id = services.machine_repository.get(resource_id).owner_id
    else:
        raise ValidationError(f"Unknown resource type {resource_type!r}")
    if owner_id is None or owner_id != principal.user_id:
        raise PermissionDeniedError("Only the resource owner can manage sharing")


def _grant_out(grant) -> dict[str, Any]:
    return {
        "id": grant.id,
        "resource_type": grant.resource_type,
        "resource_id": grant.resource_id,
        "grantee_type": grant.grantee_type,
        "grantee_id": grant.grantee_id,
        "permission": grant.permission,
        "created_at": grant.created_at,
    }


@router.get("/teams")
def list_teams(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[dict[str, Any]]:
    """List available teams for sharing resources."""
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

