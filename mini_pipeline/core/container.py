"""Application service container and dependency construction."""

from dataclasses import dataclass

from mini_pipeline.account.credential_service import CredentialService
from mini_pipeline.account.service import (
    AccountService,
    AuditService,
    MachineService,
    PermissionService,
)
from mini_pipeline.artifact.base import ArtifactStore
from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.artifact.s3 import S3ArtifactStore
from mini_pipeline.core.config import Settings
from mini_pipeline.core.events import EventBus
from mini_pipeline.core.ssh_identity import ServerSshIdentity
from mini_pipeline.database.account_repositories import (
    AuditRepository,
    CredentialRepository,
    EmailVerificationRepository,
    GrantRepository,
    MachineRepository,
    PackageShareRepository,
    SessionRepository,
    SystemSettingRepository,
    TeamRepository,
    UserRepository,
)
from mini_pipeline.database.environment_repositories import (
    EnvironmentDeployTaskRepository,
    EnvironmentRepository,
)
from mini_pipeline.database.repositories import (
    PipelineRepository,
    PluginRepository,
    RunRepository,
    TaskCacheRepository,
)
from mini_pipeline.database.session import Database
from mini_pipeline.email.models import SmtpSettings
from mini_pipeline.email.service import EmailService
from mini_pipeline.environment.service import EnvironmentService
from mini_pipeline.executor.task_executor import TaskExecutor
from mini_pipeline.machine.diagnostics import MachineDiagnosticsService
from mini_pipeline.pipeline.service import PipelineService
from mini_pipeline.plugin.service import PluginService
from mini_pipeline.runner.ssh_executor import SshExecutor
from mini_pipeline.runtime.docker import DockerRuntime
from mini_pipeline.runtime.executable_runtime import ExecutableRuntime
from mini_pipeline.runtime.node_runtime import NodeRuntime
from mini_pipeline.runtime.python_runtime import PythonRuntime
from mini_pipeline.runtime.registry import RuntimeRegistry
from mini_pipeline.runtime.shell import ShellRuntime
from mini_pipeline.scheduler.dispatcher import Dispatcher
from mini_pipeline.scheduler.engine import PipelineEngine
from mini_pipeline.scheduler.lease_reaper import LeaseReaper
from mini_pipeline.scheduler.recovery import reap_orphan_runs
from mini_pipeline.scheduler.service import RunService
from mini_pipeline.source.git import GitSource
from mini_pipeline.source.http import HttpSource
from mini_pipeline.source.registry import SourceRegistry
from mini_pipeline.source.toolhub import ToolhubSource
from mini_pipeline.source.upload import UploadSource
from mini_pipeline.storage.service import PackageStorageService


def build_artifact_store(settings: Settings, run_repository: RunRepository) -> ArtifactStore:
    """Select the artifact backend from configuration (local disk or S3)."""
    if settings.artifact_storage.driver == "s3":
        return S3ArtifactStore(settings.artifact_storage, run_repository)
    return LocalArtifactStore(settings.storage, run_repository)


@dataclass
class Services:
    settings: Settings
    database: Database
    plugins: PluginService
    pipelines: PipelineService
    runs: RunService
    artifacts: ArtifactStore
    dispatcher: Dispatcher
    events: EventBus
    plugin_repository: PluginRepository
    pipeline_repository: PipelineRepository
    run_repository: RunRepository
    task_cache: TaskCacheRepository
    engine: PipelineEngine
    account: AccountService
    machines: MachineService
    permissions: PermissionService
    audit: AuditService
    lease_reaper: LeaseReaper
    # registries for sharing UI / admin console
    users: UserRepository
    sessions: SessionRepository
    teams: TeamRepository
    grants: GrantRepository
    machine_repository: MachineRepository
    ssh_executor: SshExecutor
    package_storage: PackageStorageService
    package_shares: PackageShareRepository
    email_service: EmailService
    email_verifications: EmailVerificationRepository
    system_settings: SystemSettingRepository
    environment_repo: EnvironmentRepository
    environment_tasks: EnvironmentDeployTaskRepository
    environments: EnvironmentService
    diagnostics: MachineDiagnosticsService
    credential_repository: CredentialRepository
    credentials: CredentialService
    ssh_identity: ServerSshIdentity

    @classmethod
    def build(cls, settings: Settings) -> "Services":
        settings.prepare_directories()
        database = Database(settings.database)
        database.create_schema()

        plugin_repository = PluginRepository(database)
        pipeline_repository = PipelineRepository(database)
        run_repository = RunRepository(database)
        task_cache = TaskCacheRepository(database)
        users = UserRepository(database)
        sessions = SessionRepository(database)
        teams = TeamRepository(database)
        grants = GrantRepository(database)
        machine_repository = MachineRepository(database)
        audit_repository = AuditRepository(database)
        package_shares = PackageShareRepository(database)
        email_verifications = EmailVerificationRepository(database)
        system_settings = SystemSettingRepository(database)
        environment_repo = EnvironmentRepository(database)
        environment_tasks = EnvironmentDeployTaskRepository(database)
        environment_repo.seed_defaults()

        environment_service = EnvironmentService(
            environment_repo=environment_repo,
            deploy_task_repo=environment_tasks,
            machine_repo=machine_repository,
        )

        # Initialize EmailService from config, applying dynamic DB override if present
        smtp_cfg = SmtpSettings(**settings.email.model_dump())
        saved_smtp = system_settings.get("smtp_config")
        if saved_smtp:
            if not saved_smtp.get("password") and smtp_cfg.password:
                saved_smtp["password"] = smtp_cfg.password
            smtp_cfg = SmtpSettings(**saved_smtp)
        email_service = EmailService(default_settings=smtp_cfg)

        # Crash recovery: runs left pending/running by a previous process
        # can never finish — mark them failed before accepting new work.
        reaped = reap_orphan_runs(run_repository)
        if reaped:
            import logging

            logging.getLogger(__name__).warning(
                "Reaped %d orphaned run(s) left behind by a previous process", reaped
            )

        credential_repository = CredentialRepository(database)
        credentials = CredentialService(
            credential_repo=credential_repository,
            team_repo=teams,
            user_repo=users,
            settings=settings,
        )

        upload_source = UploadSource(settings.sources)
        sources = SourceRegistry()
        sources.register(GitSource())
        sources.register(HttpSource(settings.sources))
        sources.register(ToolhubSource(settings.sources))
        sources.register(upload_source)

        plugins = PluginService(
            storage=settings.storage,
            repository=plugin_repository,
            sources=sources,
            upload_source=upload_source,
            credentials=credentials,
        )
        pipelines = PipelineService(
            pipeline_repository, plugin_repository=plugin_repository
        )
        permissions = PermissionService(
            grants=grants, teams=teams, settings=settings
        )
        account = AccountService(
            users=users,
            sessions=sessions,
            settings=settings,
            email_verifications=email_verifications,
            email_service=email_service,
        )
        package_storage = PackageStorageService(
            settings=settings,
            plugin_service=plugins,
            shares=package_shares,
            permissions=permissions,
            grants=grants,
            teams=teams,
        )

        artifacts = build_artifact_store(settings, run_repository)
        runtimes = RuntimeRegistry()
        runtimes.register(ShellRuntime())
        runtimes.register(PythonRuntime())
        runtimes.register(NodeRuntime())
        runtimes.register(ExecutableRuntime())
        runtimes.register(DockerRuntime(settings.docker_runtime))
        executor = TaskExecutor(
            storage=settings.storage,
            execution=settings.execution,
            runtimes=runtimes,
            artifact_store=artifacts,
        )
        dispatcher = Dispatcher(
            coordinator_workers=settings.execution.coordinator_workers,
            task_workers=settings.execution.task_workers,
        )
        ssh_executor = SshExecutor(
            machine_repository=machine_repository,
            settings=settings,
            artifact_store=artifacts,
        )
        events = EventBus()
        machines = MachineService(
            machines=machine_repository,
            permissions=permissions,
            settings=settings,
            grants=grants,
        )
        machines.ensure_builtin_master_machine()
        audit = AuditService(audit_repository)
        engine = PipelineEngine(
            plugins=plugin_repository,
            runs=run_repository,
            executor=executor,
            dispatcher=dispatcher,
            events=events,
            retry_backoff_seconds=settings.execution.retry_backoff_seconds,
            storage=settings.storage,
            ssh_executor=ssh_executor,
            email_service=email_service,
            users=users,
            task_cache=task_cache,
            credentials=credentials,
        )
        runs = RunService(
            pipelines=pipelines,
            repository=run_repository,
            engine=engine,
            permissions=permissions,
            machine_repository=machine_repository,
            plugin_repository=plugin_repository,
        )
        lease_reaper = LeaseReaper(
            runs_repository=run_repository,
            interval_seconds=max(5.0, settings.runner.lease_seconds / 8),
        )
        lease_reaper.start()
        # Generate or load the platform RSA keypair for zero-config SSH access
        ssh_identity = ServerSshIdentity(settings.storage.root)

        diagnostics_service = MachineDiagnosticsService(
            machine_repository=machine_repository,
            settings=settings,
            ssh_identity=ssh_identity,
        )

        return cls(
            settings=settings,
            database=database,
            plugins=plugins,
            pipelines=pipelines,
            runs=runs,
            artifacts=artifacts,
            dispatcher=dispatcher,
            events=events,
            engine=engine,
            plugin_repository=plugin_repository,
            pipeline_repository=pipeline_repository,
            run_repository=run_repository,
            task_cache=task_cache,
            account=account,
            machines=machines,
            permissions=permissions,
            audit=audit,
            lease_reaper=lease_reaper,
            users=users,
            sessions=sessions,
            teams=teams,
            grants=grants,
            machine_repository=machine_repository,
            ssh_executor=ssh_executor,
            package_storage=package_storage,
            package_shares=package_shares,
            email_service=email_service,
            email_verifications=email_verifications,
            system_settings=system_settings,
            environment_repo=environment_repo,
            environment_tasks=environment_tasks,
            environments=environment_service,
            diagnostics=diagnostics_service,
            credential_repository=credential_repository,
            credentials=credentials,
            ssh_identity=ssh_identity,
        )

    def close(self) -> None:
        self.engine.shutdown_event.set()
        self.lease_reaper.stop()
        self.dispatcher.close()
        self.database.close()
