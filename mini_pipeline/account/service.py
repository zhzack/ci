"""Account, machine, and permission services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from mini_pipeline.account.crypto import decrypt_credentials, encrypt_credentials
from mini_pipeline.account.passwords import hash_password, verify_password
from mini_pipeline.core.config import Settings
from mini_pipeline.database.account_repositories import (
    AuditRepository,
    GrantRepository,
    MachineRepository,
    SessionRepository,
    TeamRepository,
    UserRepository,
    generate_token,
    hash_token,
)
from mini_pipeline.database.models import Machine, User
from mini_pipeline.domain.exceptions import AuthFailedError, PermissionDeniedError, ValidationError

MACHINE_TOKEN_PREFIX = "mrt"
SESSION_TOKEN_PREFIX = "mpt"


@dataclass(frozen=True)
class Principal:
    """Who is calling. ``user_id``/``machine_id`` are None for legacy
    anonymous admins (auth disabled or static config token)."""

    name: str
    role: str  # admin | user | machine
    user_id: str | None = None
    machine_id: str | None = None
    is_anonymous: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == "admin" or self.is_anonymous

    @property
    def is_machine(self) -> bool:
        return self.role == "machine"


_ANONYMOUS = Principal(name="anonymous", role="admin", is_anonymous=True)


@dataclass(frozen=True)
class MachineIdentity:
    principal: Principal
    machine: Machine


class AccountService:
    def __init__(
        self,
        *,
        users: UserRepository,
        sessions: SessionRepository,
        settings: Settings,
    ) -> None:
        self.users = users
        self.sessions = sessions
        self.settings = settings

    def registration_open(self) -> bool:
        return self.settings.auth.registration_enabled

    def register(
        self, *, username: str, password: str, display_name: str = ""
    ) -> tuple[User, str]:
        """Create a user and return (user, raw session token).

        The very first user on a fresh installation becomes platform admin
        (bootstrap); everyone else registers with the regular role.
        """
        if not self.registration_open() and self.users.count() > 0:
            raise PermissionDeniedError("User registration is disabled")
        username = self._normalize_username(username)
        if len(password) < 8:
            raise ValidationError("Password must be at least 8 characters")
        role = "admin" if self.users.count() == 0 else "user"
        user = self.users.create(
            username=username,
            password_hash=hash_password(password),
            display_name=display_name,
            role=role,
        )
        return user, self._new_session(user)

    def login(self, *, username: str, password: str) -> tuple[User, str]:
        username = self._normalize_username(username)
        user = self.users.get_by_username(username)
        if user is None or not verify_password(password, user.password_hash):
            raise AuthFailedError("Invalid username or password")
        if user.status != "active":
            raise PermissionDeniedError("This account is disabled")
        return user, self._new_session(user)

    def resolve_session(self, raw_token: str) -> Principal | None:
        resolved = self.sessions.resolve(raw_token)
        if resolved is None:
            return None
        auth_session, user = resolved
        return Principal(
            name=user.display_name or user.username,
            role=user.role,
            user_id=user.id,
        )

    def logout(self, raw_token: str) -> None:
        self.sessions.revoke(raw_token)

    @staticmethod
    def _normalize_username(username: str) -> str:
        value = username.strip().lower()
        if not (3 <= len(value) <= 64) or not all(
            c.isalnum() or c in "_.-" for c in value
        ):
            raise ValidationError(
                "Username must be 3-64 chars: letters, digits, dot, dash, underscore"
            )
        return value

    def _new_session(self, user: User) -> str:
        raw, _ = self.sessions.create(
            user_id=user.id, ttl_hours=self.settings.auth.session_ttl_hours
        )
        return raw


class MachineService:
    def __init__(
        self,
        *,
        machines: MachineRepository,
        permissions: PermissionService,
        settings: Settings,
    ) -> None:
        self.machines = machines
        self.permissions = permissions
        self.settings = settings

    # -- registration -------------------------------------------------

    def register_personal(
        self,
        *,
        user: Principal,
        name: str,
        labels: dict[str, Any],
        max_concurrency: int,
        notes: str,
        connection_type: str = "agent",
        connection: dict[str, Any] | None = None,
    ) -> tuple[Machine, str]:
        if user.user_id is None:
            raise PermissionDeniedError(
                "Personal machines require a logged-in user"
            )
        raw = generate_token(MACHINE_TOKEN_PREFIX)
        encrypted = self._encrypt_connection(connection_type, connection)
        machine = self.machines.create(
            name=name,
            kind="personal",
            owner_id=user.user_id,
            assigned_user_id=None,
            token_hash=hash_token(raw),
            labels=labels or {},
            max_concurrency=max_concurrency,
            credentials=encrypted,
            notes=notes or "",
            connection_type=connection_type,
        )
        return machine, raw

    def create_admin_machine(
        self,
        *,
        name: str,
        assigned_user_id: str | None,
        credentials: dict[str, Any] | None,
        labels: dict[str, Any],
        max_concurrency: int,
        notes: str,
        granted_by: str | None,
        connection_type: str = "agent",
        connection: dict[str, Any] | None = None,
    ) -> tuple[Machine, str]:
        payload = connection if connection_type == "ssh" else credentials
        if payload and not self.settings.security.secret_key:
            raise ValidationError(
                "security.secret_key must be configured to store machine credentials"
            )
        raw = generate_token(MACHINE_TOKEN_PREFIX)
        encrypted = (
            encrypt_credentials(payload, self.settings.security.secret_key)
            if payload
            else None
        )
        machine = self.machines.create(
            name=name,
            kind="admin",
            owner_id=granted_by,
            assigned_user_id=assigned_user_id,
            token_hash=hash_token(raw),
            labels=labels or {},
            max_concurrency=max_concurrency,
            credentials=encrypted,
            notes=notes or "",
            connection_type=connection_type,
        )
        return machine, raw

    def _encrypt_connection(
        self, connection_type: str, connection: dict[str, Any] | None
    ) -> str | None:
        if connection_type != "ssh" or not connection:
            return None
        if not self.settings.security.secret_key:
            raise ValidationError(
                "security.secret_key must be configured to store SSH credentials"
            )
        return encrypt_credentials(connection, self.settings.security.secret_key)

    # -- access control ------------------------------------------------

    def can_use(self, user: Principal, machine: Machine) -> bool:
        """May the caller submit tasks to this machine?"""
        return self.permissions.machines_can_use(user, machine)

    def can_manage(self, user: Principal, machine: Machine) -> bool:
        """May the caller manage (edit/share/transfer/revoke) this machine?"""
        if user.is_admin:
            return True
        if user.user_id is None:
            return False
        return machine.kind == "personal" and machine.owner_id == user.user_id

    def can_see_credentials(self, user: Principal, machine: Machine) -> bool:
        if user.is_admin:
            return True
        if user.user_id is None:
            return False
        return machine.kind == "personal" and machine.owner_id == user.user_id

    def require_use(self, user: Principal, machine: Machine) -> None:
        if not self.can_use(user, machine):
            raise PermissionDeniedError(
                f"No permission to run tasks on machine {machine.name!r}"
            )

    # -- operations -----------------------------------------------------

    def resolve_identity(self, raw_token: str) -> MachineIdentity | None:
        machine = self.machines.get_by_token_hash(hash_token(raw_token))
        if machine is None or machine.status != "active":
            return None
        principal = Principal(
            name=f"machine:{machine.name}", role="machine", machine_id=machine.id
        )
        return MachineIdentity(principal=principal, machine=machine)

    def heartbeat(
        self, machine: Machine, agent_version: str | None, active_task_ids: list[str]
    ) -> dict[str, Any]:
        self.machines.heartbeat(machine.id, agent_version)
        if active_task_ids:
            lease = datetime.utcnow() + timedelta(
                seconds=self.settings.runner.lease_seconds
            )
            self.machines.extend_leases(machine.id, active_task_ids, lease)
        cancel_ids = self.machines.cancel_requested_task_ids(
            machine.id, active_task_ids
        )
        return {"cancel_task_ids": cancel_ids}

    def update(self, machine_id: str, **values: Any) -> None:
        self.machines.update(machine_id, **values)

    def transfer_ownership(
        self, machine: Machine, new_owner_id: str, *, actor: Principal
    ) -> None:
        if machine.kind != "personal":
            raise ValidationError(
                "Only personal machines can be transferred; admin machines are reassigned"
            )
        self.machines.update(machine.id, owner_id=new_owner_id)

    def rotate_token(self, machine: Machine) -> str:
        raw = generate_token(MACHINE_TOKEN_PREFIX)
        self.machines.update(machine.id, token_hash=hash_token(raw))
        return raw

    def read_credentials(self, machine: Machine) -> dict[str, Any] | None:
        if not machine.credentials:
            return None
        if not self.settings.security.secret_key:
            return None
        return decrypt_credentials(machine.credentials, self.settings.security.secret_key)

    def is_online(self, machine: Machine) -> bool:
        if machine.status != "active" or machine.last_heartbeat is None:
            return False
        age = (datetime.utcnow() - machine.last_heartbeat).total_seconds()
        return age <= self.settings.runner.offline_after_seconds


class PermissionService:
    """Effective permission checks across ownership, role, and grants."""

    def __init__(
        self,
        *,
        grants: GrantRepository,
        teams: TeamRepository,
        settings: Settings,
    ) -> None:
        self.grants = grants
        self.teams = teams
        self.settings = settings

    # -- grants ----------------------------------------------------

    def has_grant(
        self,
        user: Principal,
        *,
        resource_type: str,
        resource_id: str,
        permission: str,
    ) -> bool:
        """True when the user (directly or via one of their teams) holds at
        least ``permission`` on the resource. operator ⊃ viewer."""
        if user.is_admin:
            return True
        if user.user_id is None:
            return False
        team_ids = {t.id for t in self.teams.teams_of_user(user.user_id)}
        for grant in self.grants.list_for_grantee(
            user_id=user.user_id, team_ids=team_ids, resource_type=resource_type
        ):
            if grant.resource_id != resource_id:
                continue
            if grant.permission == "operator":
                return True
            if permission == "viewer" and grant.permission == "viewer":
                return True
        return False

    def grants_for(
        self, user: Principal, resource_type: str, resource_id: str
    ) -> list:
        if user.user_id is None:
            return []
        team_ids = {t.id for t in self.teams.teams_of_user(user.user_id)}
        return [
            g
            for g in self.grants.list_for_grantee(
                user_id=user.user_id, team_ids=team_ids, resource_type=resource_type
            )
            if g.resource_id == resource_id
        ]

    # -- resource checks --------------------------------------------

    def machines_can_use(self, user: Principal, machine) -> bool:
        """May the caller submit tasks to this machine?"""
        if user.is_admin:
            return True
        if machine.status != "active" or user.user_id is None:
            return False
        if machine.kind == "personal" and machine.owner_id == user.user_id:
            return True
        if machine.kind == "admin" and machine.assigned_user_id == user.user_id:
            return True
        return self.has_grant(
            user,
            resource_type="machine",
            resource_id=machine.id,
            permission="operator",
        )

    def plugins_can_use(self, user: Principal, plugin_version) -> bool:
        """May the caller reference this plugin in a pipeline/run?

        ``owner_id IS NULL`` marks platform/legacy plugins, usable by all.
        Public plugins must have an approved store review.
        """
        if user.is_admin:
            return True
        plugin = plugin_version.plugin
        if plugin.owner_id is None:
            return True
        if user.user_id is None:
            return False
        if plugin.owner_id == user.user_id:
            return True
        if plugin.visibility == "public" and plugin.review_status == "approved":
            return True
        return self.has_grant(
            user,
            resource_type="plugin",
            resource_id=plugin.id,
            permission="viewer",
        )

    def can_read_resource(
        self,
        user: Principal,
        *,
        resource_type: str,
        resource_id: str,
        owner_id: str | None,
        visibility: str = "private",
    ) -> bool:
        if user.is_admin or owner_id is None:  # NULL owner = platform resource
            return True
        if owner_id == user.user_id:
            return True
        if resource_type == "plugin" and visibility == "public":
            return True
        return self.has_grant(
            user, resource_type=resource_type, resource_id=resource_id, permission="viewer"
        )

    def can_manage_resource(
        self,
        user: Principal,
        *,
        resource_type: str,
        resource_id: str,
        owner_id: str | None,
    ) -> bool:
        if user.is_admin:
            return True
        return owner_id is not None and owner_id == user.user_id


class AuditService:
    def __init__(self, audit: AuditRepository) -> None:
        self.audit = audit

    def record(
        self,
        principal: Principal,
        action: str,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
        detail: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        self.audit.record(
            user_id=principal.user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=detail,
            request_id=request_id,
        )
