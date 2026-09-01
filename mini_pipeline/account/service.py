"""Account, machine, and permission services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from mini_pipeline.account.crypto import decrypt_credentials, encrypt_credentials
from mini_pipeline.account.passwords import hash_password, verify_password
from mini_pipeline.core.config import Settings
from mini_pipeline.database.account_repositories import (
    AuditRepository,
    EmailVerificationRepository,
    GrantRepository,
    MachineRepository,
    SessionRepository,
    TeamRepository,
    UserRepository,
    generate_token,
    hash_token,
)
from mini_pipeline.database.models import Machine, User, utcnow
from mini_pipeline.domain.exceptions import (
    AuthFailedError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from mini_pipeline.email.service import EmailService

MACHINE_TOKEN_PREFIX = "mrt"
SESSION_TOKEN_PREFIX = "mpt"


@dataclass(frozen=True)
class Principal:
    """Who is calling. ``user_id``/``machine_id`` are None for legacy
    anonymous admins (auth disabled or static config token)."""

    name: str
    role: str  # admin | user | machine
    user_id: str | None = None
    username: str | None = None
    email: str | None = None
    must_change_password: bool = False
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
        email_verifications: EmailVerificationRepository | None = None,
        email_service: EmailService | None = None,
    ) -> None:
        self.users = users
        self.sessions = sessions
        self.settings = settings
        self.email_verifications = email_verifications
        self.email_service = email_service

    def registration_open(self) -> bool:
        return self.settings.auth.registration_enabled

    def register(
        self,
        *,
        username: str,
        password: str,
        display_name: str = "",
        email: str | None = None,
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
            email=email,
            role=role,
            must_change_password=False,
        )
        if user.email and self.email_service:
            self.email_service.send_welcome_email(
                to_email=user.email,
                username=user.username,
                display_name=user.display_name,
            )
        return user, self._new_session(user)

    def admin_create_user(
        self,
        *,
        username: str,
        password: str,
        display_name: str = "",
        email: str | None = None,
        role: str = "user",
        must_change_password: bool = True,
    ) -> User:
        """Create a user by admin with optional initial forced password change."""
        username = self._normalize_username(username)
        if len(password) < 8:
            raise ValidationError("Password must be at least 8 characters")
        user = self.users.create(
            username=username,
            password_hash=hash_password(password),
            display_name=display_name,
            email=email,
            role=role,
            must_change_password=must_change_password,
        )
        if user.email and self.email_service:
            self.email_service.send_welcome_email(
                to_email=user.email,
                username=user.username,
                display_name=user.display_name,
            )
        return user

    def send_verification_code(self, email: str, purpose: str) -> None:
        """Issue an OTP verification code and send it via email."""
        if not self.email_verifications or not self.email_service:
            raise ValidationError("邮件服务未启用")

        email_clean = email.strip().lower()
        if not email_clean or "@" not in email_clean:
            raise ValidationError("请输入有效的邮箱地址")

        valid_purposes = {"register", "login", "reset_password", "bind_email", "test"}
        if purpose not in valid_purposes:
            raise ValidationError(f"无效的验证码用途: {purpose}")

        if purpose in {"login", "reset_password"}:
            user = self.users.get_by_email(email_clean)
            if user is None:
                raise NotFoundError("未找到该邮箱关联的用户账号")
            if user.status != "active":
                raise PermissionDeniedError("该账号已被停用")

        if purpose == "register":
            existing = self.users.get_by_email(email_clean)
            if existing is not None:
                raise ConflictError("该邮箱已被注册，请直接登录")

        # Cooldown check
        self.email_verifications.check_rate_limit(email_clean, cooldown_seconds=60)
        # Generate & save code
        code = self.email_verifications.create_code(email_clean, purpose, expires_minutes=5)
        # Send email
        self.email_service.send_verification_code(email_clean, code, purpose=purpose)

    def login_with_otp(self, *, email: str, code: str) -> tuple[User, str]:
        """Verify OTP code and authenticate user."""
        if not self.email_verifications:
            raise ValidationError("邮件服务未启用")

        email_clean = email.strip().lower()
        self.email_verifications.verify_code(email_clean, code, purpose="login")

        user = self.users.get_by_email(email_clean)
        if user is None:
            raise NotFoundError("未找到该邮箱关联的用户账号")
        if user.status != "active":
            raise PermissionDeniedError("该账号已被停用")

        return user, self._new_session(user)

    def register_with_otp(
        self,
        *,
        username: str,
        password: str,
        email: str,
        code: str,
        display_name: str = "",
    ) -> tuple[User, str]:
        """Verify registration OTP code and register user."""
        if not self.email_verifications:
            raise ValidationError("邮件服务未启用")

        email_clean = email.strip().lower()
        self.email_verifications.verify_code(email_clean, code, purpose="register")

        return self.register(
            username=username,
            password=password,
            display_name=display_name,
            email=email_clean,
        )

    def reset_password_with_otp(
        self,
        *,
        email: str,
        code: str,
        new_password: str,
    ) -> None:
        """Verify OTP code and set new password without old password."""
        if not self.email_verifications:
            raise ValidationError("邮件服务未启用")

        email_clean = email.strip().lower()
        self.email_verifications.verify_code(email_clean, code, purpose="reset_password")

        user = self.users.get_by_email(email_clean)
        if user is None:
            raise NotFoundError("未找到该邮箱关联的用户账号")

        if len(new_password) < 8:
            raise ValidationError("新密码长度不能少于 8 位")

        new_hash = hash_password(new_password)
        self.users.set_password(user.id, new_hash, must_change_password=False)

    def bind_email_with_otp(
        self,
        *,
        user_id: str,
        email: str,
        code: str,
    ) -> User:
        """Verify OTP code and update user email."""
        if not self.email_verifications:
            raise ValidationError("邮件服务未启用")

        email_clean = email.strip().lower()
        self.email_verifications.verify_code(email_clean, code, purpose="bind_email")

        existing = self.users.get_by_email(email_clean)
        if existing and existing.id != user_id:
            raise ConflictError("该邮箱已被其他账号绑定")

        return self.users.update_profile(user_id, email=email_clean)

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
            username=user.username,
            email=user.email,
            must_change_password=user.must_change_password,
        )

    def change_password(
        self,
        *,
        user_id: str,
        old_password: str | None = None,
        new_password: str,
        is_admin_override: bool = False,
        must_change_password: bool = False,
    ) -> None:
        """Change user password. If user is changing own password, verify old password."""
        user = self.users.get(user_id)
        if not is_admin_override:
            if not old_password or not verify_password(old_password, user.password_hash):
                raise AuthFailedError("Current password verification failed")
        if len(new_password) < 8:
            raise ValidationError("New password must be at least 8 characters")

        new_hash = hash_password(new_password)
        self.users.set_password(
            user_id, new_hash, must_change_password=must_change_password
        )

    def update_profile(
        self,
        *,
        user_id: str,
        display_name: str | None = None,
        email: str | None = None,
    ) -> User:
        return self.users.update_profile(
            user_id, display_name=display_name, email=email
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
        grants: GrantRepository | None = None,
    ) -> None:
        self.machines = machines
        self.permissions = permissions
        self.settings = settings
        self.grants = grants

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
            lease = utcnow() + timedelta(
                seconds=self.settings.runner.lease_seconds
            )
            self.machines.extend_leases(machine.id, active_task_ids, lease)
        cancel_ids = self.machines.cancel_requested_task_ids(
            machine.id, active_task_ids
        )
        return {"cancel_task_ids": cancel_ids}

    def update(self, machine_id: str, **values: Any) -> None:
        self.machines.update(machine_id, **values)

    def revoke(self, machine_id: str) -> None:
        self.machines.update(machine_id, status="revoked")
        if self.grants is not None:
            self.grants.delete_for_resource("machine", machine_id)

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
        age = (utcnow() - machine.last_heartbeat).total_seconds()
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

    def package_can_access(
        self, user: Principal, path: str, write: bool = False
    ) -> bool:
        """Check if user has access to package path via zone or grant."""
        if user.is_admin:
            return True
        clean = path.strip().replace("\\", "/").strip("/")
        if not clean:
            return not write
        parts = clean.split("/")
        top_zone = parts[0]
        if top_zone in {"shared", "plugins"}:
            return True
        if top_zone == "artifacts":
            return not write

        user_name = user.username or user.name
        if top_zone == "personal":
            if len(parts) >= 2 and parts[1] == user_name:
                return True

        # Check directory grants: exact match or parent directory grant
        required_perm = "operator" if write else "viewer"
        if user.user_id is None:
            return False
        team_ids = {t.id for t in self.teams.teams_of_user(user.user_id)}
        for grant in self.grants.list_for_grantee(
            user_id=user.user_id, team_ids=team_ids, resource_type="package"
        ):
            grant_path = grant.resource_id.strip().replace("\\", "/").strip("/")
            if clean == grant_path or clean.startswith(f"{grant_path}/"):
                if grant.permission == "operator":
                    return True
                if required_perm == "viewer" and grant.permission == "viewer":
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
