"""Repositories for users, sessions, teams, grants, machines, and audit."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from mini_pipeline.database.models import (
    AuditLog,
    AuthSession,
    EmailVerificationCode,
    Machine,
    PackageShareLink,
    ShareGrant,
    SystemSetting,
    Team,
    TeamMember,
    User,
    utcnow,
)
from mini_pipeline.database.session import Database
from mini_pipeline.domain.exceptions import ConflictError, NotFoundError, ValidationError


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


class UserRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        username: str,
        password_hash: str,
        display_name: str = "",
        email: str | None = None,
        role: str = "user",
        must_change_password: bool = False,
    ) -> User:
        try:
            with self.database.session() as session:
                user = User(
                    username=username,
                    password_hash=password_hash,
                    display_name=display_name or username,
                    email=email.strip().lower() if email else None,
                    role=role,
                    must_change_password=must_change_password,
                )
                session.add(user)
                session.flush()
                session.expunge(user)
                return user
        except IntegrityError as exc:
            raise ConflictError(f"Username {username!r} already exists") from exc

    def count(self) -> int:
        with self.database.session() as session:
            from sqlalchemy import func

            return int(session.scalar(select(func.count(User.id))) or 0)

    def get(self, user_id: str) -> User:
        with self.database.session() as session:
            user = session.get(User, user_id)
            if user is None:
                raise NotFoundError(f"User {user_id!r} was not found")
            session.expunge(user)
            return user

    def get_by_username(self, username: str) -> User | None:
        with self.database.session() as session:
            user = session.scalar(select(User).where(User.username == username))
            if user is None:
                return None
            session.expunge(user)
            return user

    def get_by_email(self, email: str) -> User | None:
        with self.database.session() as session:
            user = session.scalar(select(User).where(User.email == email.strip().lower()))
            if user is None:
                return None
            session.expunge(user)
            return user

    def list(self) -> list[User]:
        with self.database.session() as session:
            rows = list(session.scalars(select(User).order_by(User.created_at)))
            for row in rows:
                session.expunge(row)
            return rows

    def set_status(self, user_id: str, status: str) -> None:
        with self.database.session() as session:
            session.execute(
                update(User).where(User.id == user_id).values(status=status)
            )

    def set_role(self, user_id: str, role: str) -> None:
        with self.database.session() as session:
            session.execute(
                update(User).where(User.id == user_id).values(role=role)
            )

    def update_profile(
        self,
        user_id: str,
        *,
        display_name: str | None = None,
        email: str | None = None,
    ) -> User:
        values: dict[str, Any] = {}
        if display_name is not None:
            values["display_name"] = display_name
        if email is not None:
            values["email"] = email.strip().lower() if email else None
        with self.database.session() as session:
            if values:
                session.execute(
                    update(User).where(User.id == user_id).values(**values)
                )
            user = session.get(User, user_id)
            if user is None:
                raise NotFoundError(f"User {user_id!r} not found")
            session.expunge(user)
            return user

    def set_password(
        self,
        user_id: str,
        password_hash: str,
        *,
        must_change_password: bool = False,
    ) -> None:
        with self.database.session() as session:
            session.execute(
                update(User)
                .where(User.id == user_id)
                .values(
                    password_hash=password_hash,
                    must_change_password=must_change_password,
                )
            )



class SessionRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, *, user_id: str, ttl_hours: int) -> tuple[str, AuthSession]:
        raw = generate_token("mpt")
        with self.database.session() as session:
            auth_session = AuthSession(
                user_id=user_id,
                token_hash=hash_token(raw),
                expires_at=utcnow() + timedelta(hours=ttl_hours),
            )
            session.add(auth_session)
            session.flush()
            session.expunge(auth_session)
        return raw, auth_session

    def resolve(self, raw_token: str) -> tuple[AuthSession, User] | None:
        """Return (session, user) for a valid, unexpired token."""
        token_hash = hash_token(raw_token)
        with self.database.session() as session:
            auth_session = session.scalar(
                select(AuthSession).where(AuthSession.token_hash == token_hash)
            )
            if auth_session is None:
                return None
            if auth_session.expires_at < utcnow():
                return None
            user = session.get(User, auth_session.user_id)
            if user is None or user.status != "active":
                return None
            session.execute(
                update(AuthSession)
                .where(AuthSession.id == auth_session.id)
                .values(last_seen_at=utcnow())
            )
            session.expunge(auth_session)
            session.expunge(user)
            return auth_session, user

    def revoke(self, raw_token: str) -> None:
        with self.database.session() as session:
            session.execute(
                delete(AuthSession).where(
                    AuthSession.token_hash == hash_token(raw_token)
                )
            )

    def revoke_user_sessions(self, user_id: str) -> None:
        with self.database.session() as session:
            session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))


class TeamRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, *, name: str, created_by: str | None) -> Team:
        try:
            with self.database.session() as session:
                team = Team(name=name, created_by=created_by)
                session.add(team)
                session.flush()
                session.expunge(team)
                return team
        except IntegrityError as exc:
            raise ConflictError(f"Team {name!r} already exists") from exc

    def list(self) -> list[Team]:
        with self.database.session() as session:
            rows = list(session.scalars(select(Team).order_by(Team.name)))
            for row in rows:
                session.expunge(row)
            return rows

    def get(self, team_id: str) -> Team:
        with self.database.session() as session:
            team = session.get(Team, team_id)
            if team is None:
                raise NotFoundError(f"Team {team_id!r} was not found")
            session.expunge(team)
            return team

    def add_member(self, *, team_id: str, user_id: str) -> None:
        try:
            with self.database.session() as session:
                session.add(TeamMember(team_id=team_id, user_id=user_id))
        except IntegrityError as exc:
            raise ConflictError("User is already a team member") from exc

    def remove_member(self, *, team_id: str, user_id: str) -> None:
        with self.database.session() as session:
            session.execute(
                delete(TeamMember).where(
                    TeamMember.team_id == team_id, TeamMember.user_id == user_id
                )
            )

    def members_of(self, team_id: str) -> list[TeamMember]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(TeamMember).where(TeamMember.team_id == team_id)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def member_user_ids(self, team_ids: set[str]) -> set[str]:
        if not team_ids:
            return set()
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(TeamMember.user_id).where(TeamMember.team_id.in_(team_ids))
                )
            )
            return set(rows)

    def teams_of_user(self, user_id: str) -> list[Team]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(Team)
                    .join(TeamMember, TeamMember.team_id == Team.id)
                    .where(TeamMember.user_id == user_id)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows


class GrantRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        resource_type: str,
        resource_id: str,
        grantee_type: str,
        grantee_id: str,
        permission: str,
        granted_by: str | None,
    ) -> ShareGrant:
        try:
            with self.database.session() as session:
                grant = ShareGrant(
                    resource_type=resource_type,
                    resource_id=resource_id,
                    grantee_type=grantee_type,
                    grantee_id=grantee_id,
                    permission=permission,
                    granted_by=granted_by,
                )
                session.add(grant)
                session.flush()
                session.expunge(grant)
                return grant
        except IntegrityError as exc:
            raise ConflictError("Grant already exists") from exc

    def get(self, grant_id: str) -> ShareGrant | None:
        with self.database.session() as session:
            grant = session.get(ShareGrant, grant_id)
            if grant is None:
                return None
            session.expunge(grant)
            return grant

    def list_for_resource(
        self, resource_type: str, resource_id: str
    ) -> list[ShareGrant]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(ShareGrant)
                    .where(
                        ShareGrant.resource_type == resource_type,
                        ShareGrant.resource_id == resource_id,
                    )
                    .order_by(ShareGrant.created_at)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def list_for_grantee(
        self, *, user_id: str, team_ids: set[str], resource_type: str | None = None
    ) -> list[ShareGrant]:
        """All grants that effectively apply to this user."""
        grantee_ids = {user_id, *team_ids}
        with self.database.session() as session:
            query = select(ShareGrant).where(ShareGrant.grantee_id.in_(grantee_ids))
            if resource_type:
                query = query.where(ShareGrant.resource_type == resource_type)
            rows = list(session.scalars(query))
            for row in rows:
                session.expunge(row)
            return rows

    def delete(self, grant_id: str) -> None:
        with self.database.session() as session:
            session.execute(delete(ShareGrant).where(ShareGrant.id == grant_id))

    def delete_for_resource(self, resource_type: str, resource_id: str) -> None:
        with self.database.session() as session:
            session.execute(
                delete(ShareGrant).where(
                    ShareGrant.resource_type == resource_type,
                    ShareGrant.resource_id == resource_id,
                )
            )


class MachineRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        name: str,
        kind: str,
        owner_id: str | None,
        assigned_user_id: str | None,
        token_hash: str,
        labels: dict[str, Any],
        max_concurrency: int,
        credentials: str | None,
        notes: str,
        connection_type: str = "agent",
    ) -> Machine:
        try:
            with self.database.session() as session:
                machine = Machine(
                    name=name,
                    kind=kind,
                    connection_type=connection_type,
                    owner_id=owner_id,
                    assigned_user_id=assigned_user_id,
                    token_hash=token_hash,
                    labels=labels,
                    max_concurrency=max_concurrency,
                    credentials=credentials,
                    notes=notes,
                )
                session.add(machine)
                session.flush()
                session.expunge(machine)
                return machine
        except IntegrityError as exc:
            raise ConflictError("Machine token collision; retry") from exc

    def get(self, machine_id: str) -> Machine:
        with self.database.session() as session:
            machine = session.get(Machine, machine_id)
            if machine is None:
                raise NotFoundError(f"Machine {machine_id!r} was not found")
            session.expunge(machine)
            return machine

    def get_by_token_hash(self, token_hash: str) -> Machine | None:
        with self.database.session() as session:
            machine = session.scalar(
                select(Machine).where(Machine.token_hash == token_hash)
            )
            if machine is None:
                return None
            session.expunge(machine)
            return machine

    def list(self) -> list[Machine]:
        with self.database.session() as session:
            rows = list(
                session.scalars(select(Machine).order_by(Machine.created_at.desc()))
            )
            for row in rows:
                session.expunge(row)
            return rows

    def heartbeat(self, machine_id: str, agent_version: str | None) -> None:
        with self.database.session() as session:
            values: dict[str, Any] = {"last_heartbeat": utcnow()}
            if agent_version:
                values["agent_version"] = agent_version
            session.execute(
                update(Machine).where(Machine.id == machine_id).values(**values)
            )

    def extend_leases(
        self, machine_id: str, task_ids: list[str], lease_until: datetime
    ) -> None:
        if not task_ids:
            return
        with self.database.session() as session:
            from mini_pipeline.database.models import TaskRun

            session.execute(
                update(TaskRun)
                .where(
                    TaskRun.id.in_(task_ids),
                    TaskRun.machine_id == machine_id,
                    TaskRun.status == "RUNNING",
                )
                .values(lease_expires_at=lease_until)
            )

    def cancel_requested_task_ids(
        self, machine_id: str, active_task_ids: list[str]
    ) -> list[str]:
        """Active tasks of this machine whose parent run was cancelled."""
        if not active_task_ids:
            return []
        with self.database.session() as session:
            from mini_pipeline.database.models import PipelineRun, TaskRun

            rows = list(
                session.execute(
                    select(TaskRun.id)
                    .join(PipelineRun, PipelineRun.id == TaskRun.run_id)
                    .where(
                        TaskRun.id.in_(active_task_ids),
                        TaskRun.machine_id == machine_id,
                        PipelineRun.status == "CANCELLED",
                    )
                )
            )
            return [r[0] for r in rows]

    def update(
        self,
        machine_id: str,
        *,
        name: str | None = None,
        assigned_user_id: Any = "__unset__",
        labels: dict[str, Any] | None = None,
        max_concurrency: int | None = None,
        credentials: Any = "__unset__",
        notes: Any = "__unset__",
        owner_id: Any = "__unset__",
        status: str | None = None,
        token_hash: str | None = None,
    ) -> None:
        values: dict[str, Any] = {}
        if name is not None:
            values["name"] = name
        if assigned_user_id != "__unset__":
            values["assigned_user_id"] = assigned_user_id
        if labels is not None:
            values["labels"] = labels
        if max_concurrency is not None:
            values["max_concurrency"] = max_concurrency
        if credentials != "__unset__":
            values["credentials"] = credentials
        if notes != "__unset__":
            values["notes"] = notes
        if owner_id != "__unset__":
            values["owner_id"] = owner_id
        if status is not None:
            values["status"] = status
        if token_hash is not None:
            values["token_hash"] = token_hash
        if not values:
            return
        with self.database.session() as session:
            session.execute(update(Machine).where(Machine.id == machine_id).values(**values))

    def delete(self, machine_id: str) -> None:
        with self.database.session() as session:
            machine = session.get(Machine, machine_id)
            if machine is not None:
                session.delete(machine)


class AuditRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def record(
        self,
        *,
        user_id: str | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        detail: dict[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        try:
            with self.database.session() as session:
                session.add(
                    AuditLog(
                        user_id=user_id,
                        action=action,
                        resource_type=resource_type,
                        resource_id=resource_id,
                        detail=detail or {},
                        request_id=request_id,
                    )
                )
        except Exception:
            # Audit failures must never break the request path.
            import logging

            logging.getLogger(__name__).exception("Failed to write audit log")

    def list(self, *, limit: int = 200) -> list[AuditLog]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(AuditLog)
                    .order_by(AuditLog.created_at.desc())
                    .limit(limit)
                )
            )
            for row in rows:
                session.expunge(row)
            return rows


def set_plugin_review(
    database: Database, plugin_id: str, review_status: str, visibility: str | None = None
) -> None:
    """Update a plugin's store review state (and optionally its visibility)."""
    from sqlalchemy import update

    from mini_pipeline.database.models import Plugin

    values: dict[str, Any] = {"review_status": review_status}
    if visibility is not None:
        values["visibility"] = visibility
    with database.session() as session:
        session.execute(update(Plugin).where(Plugin.id == plugin_id).values(**values))


class PackageShareRepository:
    """Repository for managing package share links."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def create(
        self,
        *,
        owner_id: str,
        source_path: str,
        share_type: str,
        description: str = "",
        expires_at: datetime | None = None,
    ) -> PackageShareLink:
        token = generate_token("psl")
        with self.database.session() as session:
            link = PackageShareLink(
                token=token,
                owner_id=owner_id,
                source_path=source_path.strip().replace("\\", "/").strip("/"),
                share_type=share_type,
                description=description,
                expires_at=expires_at,
            )
            session.add(link)
            session.flush()
            session.expunge(link)
            return link

    def get_by_token(self, token: str) -> PackageShareLink | None:
        with self.database.session() as session:
            link = session.scalar(
                select(PackageShareLink).where(PackageShareLink.token == token)
            )
            if link is None:
                return None
            session.expunge(link)
            return link

    def list_by_owner(self, owner_id: str) -> list[PackageShareLink]:
        with self.database.session() as session:
            rows = list(
                session.scalars(
                    select(PackageShareLink)
                    .where(PackageShareLink.owner_id == owner_id)
                    .order_by(PackageShareLink.created_at.desc())
                )
            )
            for row in rows:
                session.expunge(row)
            return rows

    def delete_by_token(self, token: str, owner_id: str | None = None) -> bool:
        with self.database.session() as session:
            query = delete(PackageShareLink).where(PackageShareLink.token == token)
            if owner_id is not None:
                query = query.where(PackageShareLink.owner_id == owner_id)
            res = session.execute(query)
            return (res.rowcount or 0) > 0


class EmailVerificationRepository:
    """Repository for email verification codes."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def check_rate_limit(self, email: str, cooldown_seconds: int = 60) -> None:
        """Ensure no new code was issued for this email in the last `cooldown_seconds`."""
        email_clean = email.strip().lower()
        cutoff = utcnow() - timedelta(seconds=cooldown_seconds)
        with self.database.session() as session:
            recent = session.scalar(
                select(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == email_clean,
                    EmailVerificationCode.created_at > cutoff,
                )
                .order_by(EmailVerificationCode.created_at.desc())
            )
            if recent is not None:
                raise ValidationError("验证码发送过于频繁，请稍候再试 (60秒冷却)")

    def create_code(
        self,
        email: str,
        purpose: str,
        expires_minutes: int = 5,
    ) -> str:
        email_clean = email.strip().lower()
        code = f"{secrets.randbelow(900000) + 100000:06d}"
        expires_at = utcnow() + timedelta(minutes=expires_minutes)

        with self.database.session() as session:
            # Invalidate older unused codes for same email & purpose
            session.execute(
                update(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == email_clean,
                    EmailVerificationCode.purpose == purpose,
                    EmailVerificationCode.is_used.is_(False),
                )
                .values(is_used=True)
            )

            record = EmailVerificationCode(
                email=email_clean,
                code=code,
                purpose=purpose,
                expires_at=expires_at,
                attempts_left=5,
                is_used=False,
            )
            session.add(record)

        return code

    def verify_code(self, email: str, code: str, purpose: str) -> bool:
        email_clean = email.strip().lower()
        now = utcnow()
        attempts_left: int | None = None
        is_expired_or_not_found = False
        is_too_many_attempts = False
        is_wrong_code = False

        with self.database.session() as session:
            record = session.scalar(
                select(EmailVerificationCode)
                .where(
                    EmailVerificationCode.email == email_clean,
                    EmailVerificationCode.purpose == purpose,
                    EmailVerificationCode.is_used.is_(False),
                    EmailVerificationCode.expires_at > now,
                )
                .order_by(EmailVerificationCode.created_at.desc())
            )
            if record is None:
                is_expired_or_not_found = True
            elif record.attempts_left <= 0:
                record.is_used = True
                is_too_many_attempts = True
            elif record.code != code.strip():
                record.attempts_left -= 1
                attempts_left = record.attempts_left
                if record.attempts_left <= 0:
                    record.is_used = True
                is_wrong_code = True
            else:
                # Correct code
                record.is_used = True
                return True

        if is_expired_or_not_found:
            raise ValidationError("验证码已过期或不存在，请重新获取")
        if is_too_many_attempts:
            raise ValidationError("验证码尝试次数过多，请重新获取")
        if is_wrong_code:
            if attempts_left is not None and attempts_left <= 0:
                raise ValidationError("验证码错误次数过多已失效，请重新获取")
            raise ValidationError(f"验证码错误，还剩 {attempts_left} 次尝试机会")
        return True


class SystemSettingRepository:
    """Repository for persisting dynamic system settings (e.g. SMTP config)."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def get(self, key: str) -> dict[str, Any] | None:
        with self.database.session() as session:
            record = session.get(SystemSetting, key)
            if record is None:
                return None
            return dict(record.value)

    def set(self, key: str, value: dict[str, Any]) -> None:
        with self.database.session() as session:
            record = session.get(SystemSetting, key)
            if record is None:
                record = SystemSetting(key=key, value=value, updated_at=utcnow())
                session.add(record)
            else:
                record.value = value
                record.updated_at = utcnow()


