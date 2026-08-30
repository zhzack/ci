"""SQLAlchemy persistence models."""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from mini_pipeline.domain.states import PipelineStatus, PluginStatus, TaskStatus


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.utcnow()


class Base(DeclarativeBase):
    pass


class Plugin(Base):
    __tablename__ = "plugins"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # NULL owner = platform/legacy plugin, visible to everyone.
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # private | public  (public requires an approved store review)
    visibility: Mapped[str] = mapped_column(String(16), default="private", nullable=False)
    # none | pending | approved | rejected  (store publish review)
    review_status: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    versions: Mapped[list["PluginVersion"]] = relationship(
        back_populates="plugin", cascade="all, delete-orphan"
    )


class PluginVersion(Base):
    __tablename__ = "plugin_versions"
    __table_args__ = (
        UniqueConstraint("plugin_id", "version", name="uq_plugin_version"),
        Index("ix_plugin_versions_name_version", "name", "version", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    plugin_id: Mapped[str] = mapped_column(
        ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(Text)
    source_revision: Mapped[Optional[str]] = mapped_column(String(256))
    install_path: Mapped[str] = mapped_column(Text, nullable=False)
    runtime_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entry: Mapped[str] = mapped_column(Text, nullable=False)
    manifest: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default=PluginStatus.READY.value, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    plugin: Mapped[Plugin] = relationship(back_populates="versions")


class PipelineDefinition(Base):
    __tablename__ = "pipeline_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    definition: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL owner = platform/legacy pipeline, visible to everyone.
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    runs: Mapped[list["PipelineRun"]] = relationship(back_populates="pipeline")


class Machine(Base):
    """A registered execution host.

    kind='admin' machines are created by platform admins and *assigned* to a
    user: the assignee can run tasks but never sees `credentials`.
    kind='personal' machines belong to `owner_id`, who has admin-equivalent
    control (shares, transfer, token rotation) for that machine.

    connection_type='agent' machines run the mini-pipeline-runner agent
    (pull model). connection_type='ssh' machines are reached by the server
    over SSH: `credentials` holds {host, port, username, password/private_key}
    and no agent needs to be installed on the target.
    """

    __tablename__ = "machines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="personal", nullable=False)
    # agent (runner pulls) | ssh (server pushes over SSH)
    connection_type: Mapped[str] = mapped_column(String(16), default="agent", nullable=False)
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    labels: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Fernet-encrypted JSON; only platform admins and the personal owner can read.
    credentials: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    agent_version: Mapped[Optional[str]] = mapped_column(String(64))
    last_heartbeat: Mapped[Optional[datetime]] = mapped_column(DateTime)
    # active | revoked
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pipeline_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("pipeline_definitions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pipeline_name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default=PipelineStatus.PENDING.value, nullable=False, index=True
    )
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    # Run submitter; NULL = legacy/anonymous.
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Execution target: NULL = built-in local runner.
    machine_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("machines.id", ondelete="SET NULL"), nullable=True, index=True
    )
    message: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    parent_run_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("pipeline_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    branched_from_step: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    pipeline: Mapped[Optional[PipelineDefinition]] = relationship(back_populates="runs")
    tasks: Mapped[list["TaskRun"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="TaskRun.position"
    )


class TaskRun(Base):
    __tablename__ = "task_runs"
    __table_args__ = (UniqueConstraint("run_id", "step_name", name="uq_run_step"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_name: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    plugin_name: Mapped[str] = mapped_column(String(128), nullable=False)
    plugin_version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default=TaskStatus.PENDING.value, nullable=False, index=True
    )
    # 1-based execution attempt; > 1 when automatic retries were applied.
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Execution target: NULL = built-in local runner.
    machine_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("machines.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Remote-execution lease; refreshed by runner heartbeats while executing.
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    message: Mapped[Optional[str]] = mapped_column(Text)
    outputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    log_path: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    run: Mapped[PipelineRun] = relationship(back_populates="tasks")
    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("pipeline_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_id: Mapped[str] = mapped_column(
        ForeignKey("task_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    task: Mapped[TaskRun] = relationship(back_populates="artifacts")



class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    # admin | user
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    # active | disabled
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # sha256 hex of the opaque bearer token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    members: Mapped[list["TeamMember"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    team: Mapped[Team] = relationship(back_populates="members")


class ShareGrant(Base):
    """A permission row tying a resource to a user or team.

    resource_type: pipeline | plugin | machine
    grantee_type:  user | team
    permission:    viewer (read) | operator (read + run)
    """

    __tablename__ = "share_grants"
    __table_args__ = (
        UniqueConstraint(
            "resource_type", "resource_id", "grantee_type", "grantee_id",
            name="uq_share_grant",
        ),
        Index("ix_share_grant_resource", "resource_type", "resource_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    resource_type: Mapped[str] = mapped_column(String(16), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    grantee_type: Mapped[str] = mapped_column(String(16), nullable=False)
    grantee_id: Mapped[str] = mapped_column(String(36), nullable=False)
    permission: Mapped[str] = mapped_column(String(16), default="viewer", nullable=False)
    granted_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[Optional[str]] = mapped_column(String(16))
    resource_id: Mapped[Optional[str]] = mapped_column(String(36))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    request_id: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class PackageShareLink(Base):
    """A share link granting external or cross-user access to a package path.

    share_type: 'live' (always points to source, updates in real-time)
              | 'snapshot' (import creates an independent physical copy)
    """

    __tablename__ = "package_share_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token: Mapped[str] = mapped_column(
        String(48), unique=True, nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    # live | snapshot
    share_type: Mapped[str] = mapped_column(String(16), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class EmailVerificationCode(Base):
    __tablename__ = "email_verifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    # purpose: register | login | reset_password | bind_email
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    attempts_left: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class RuntimeEnvironment(Base):
    __tablename__ = "runtime_environments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    env_type: Mapped[str] = mapped_column(String(32), default="python", nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    os_arch: Mapped[str] = mapped_column(String(32), default="linux-x86_64", nullable=False)
    # Storage path in package hub or direct download URL
    package_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    download_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    deploy_tasks: Mapped[list["EnvironmentDeployTask"]] = relationship(
        back_populates="environment", cascade="all, delete-orphan"
    )


class EnvironmentDeployTask(Base):
    __tablename__ = "environment_deploy_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    environment_id: Mapped[str] = mapped_column(
        ForeignKey("runtime_environments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    machine_id: Mapped[str] = mapped_column(
        ForeignKey("machines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # pending | transferring | extracting | configuring | validating | success | failed
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    logs: Mapped[str] = mapped_column(Text, default="", nullable=False)
    triggered_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    environment: Mapped[RuntimeEnvironment] = relationship(back_populates="deploy_tasks")
    machine: Mapped[Machine] = relationship()



