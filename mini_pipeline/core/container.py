"""Application service container and dependency construction."""

from dataclasses import dataclass

from mini_pipeline.artifact.local import LocalArtifactStore
from mini_pipeline.core.config import Settings
from mini_pipeline.core.events import EventBus
from mini_pipeline.database.repositories import PipelineRepository, PluginRepository, RunRepository
from mini_pipeline.database.session import Database
from mini_pipeline.executor.task_executor import TaskExecutor
from mini_pipeline.pipeline.service import PipelineService
from mini_pipeline.plugin.service import PluginService
from mini_pipeline.runtime.executable_runtime import ExecutableRuntime
from mini_pipeline.runtime.node_runtime import NodeRuntime
from mini_pipeline.runtime.python_runtime import PythonRuntime
from mini_pipeline.runtime.registry import RuntimeRegistry
from mini_pipeline.runtime.shell import ShellRuntime
from mini_pipeline.scheduler.dispatcher import Dispatcher
from mini_pipeline.scheduler.engine import PipelineEngine
from mini_pipeline.scheduler.recovery import reap_orphan_runs
from mini_pipeline.scheduler.service import RunService
from mini_pipeline.source.git import GitSource
from mini_pipeline.source.http import HttpSource
from mini_pipeline.source.registry import SourceRegistry
from mini_pipeline.source.toolhub import ToolhubSource
from mini_pipeline.source.upload import UploadSource


@dataclass
class Services:
    settings: Settings
    database: Database
    plugins: PluginService
    pipelines: PipelineService
    runs: RunService
    artifacts: LocalArtifactStore
    dispatcher: Dispatcher
    events: EventBus
    plugin_repository: PluginRepository
    pipeline_repository: PipelineRepository
    run_repository: RunRepository

    @classmethod
    def build(cls, settings: Settings) -> "Services":
        settings.prepare_directories()
        database = Database(settings.database)
        database.create_schema()

        plugin_repository = PluginRepository(database)
        pipeline_repository = PipelineRepository(database)
        run_repository = RunRepository(database)

        # Crash recovery: runs left pending/running by a previous process
        # can never finish — mark them failed before accepting new work.
        reaped = reap_orphan_runs(run_repository)
        if reaped:
            import logging

            logging.getLogger(__name__).warning(
                "Reaped %d orphaned run(s) left behind by a previous process", reaped
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
        )
        pipelines = PipelineService(
            pipeline_repository, plugin_repository=plugin_repository
        )

        artifacts = LocalArtifactStore(settings.storage, run_repository)
        runtimes = RuntimeRegistry()
        runtimes.register(ShellRuntime())
        runtimes.register(PythonRuntime())
        runtimes.register(NodeRuntime())
        runtimes.register(ExecutableRuntime())
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
        events = EventBus()
        engine = PipelineEngine(
            plugins=plugin_repository,
            runs=run_repository,
            executor=executor,
            dispatcher=dispatcher,
            events=events,
            retry_backoff_seconds=settings.execution.retry_backoff_seconds,
        )
        runs = RunService(
            pipelines=pipelines,
            repository=run_repository,
            engine=engine,
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
            plugin_repository=plugin_repository,
            pipeline_repository=pipeline_repository,
            run_repository=run_repository,
        )

    def close(self) -> None:
        self.dispatcher.close()
        self.database.close()
