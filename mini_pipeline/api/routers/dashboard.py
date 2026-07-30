"""Dashboard summary HTTP endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def dashboard_summary(
    request: Request,
    services: Annotated[Services, Depends(get_services)],
) -> dict:
    pipelines = services.pipeline_repository.list()
    plugins = services.plugin_repository.list_versions()
    recent_runs = services.run_repository.list_recent_runs(limit=10)

    def summarize_run(run) -> dict:
        return {
            "id": run.id,
            "pipeline_id": run.pipeline_id,
            "pipeline_name": run.pipeline_name,
            "status": run.status,
            "params": run.params,
            "message": run.message,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "created_at": run.created_at,
            "task_count": len(run.tasks),
        }

    return {
        "counts": {
            "plugins": len(plugins),
            "pipelines": len(pipelines),
            "running_tasks": services.run_repository.count_active_runs(),
            "failed_tasks": services.run_repository.count_failed_tasks(),
        },
        "recent_runs": [summarize_run(run) for run in recent_runs],
        "pipelines": [
            {
                "id": pipeline.id,
                "name": pipeline.name,
                "created_at": pipeline.created_at,
                "updated_at": pipeline.updated_at,
            }
            for pipeline in pipelines
        ],
        "plugins": [
            {
                "id": plugin.id,
                "name": plugin.name,
                "version": plugin.version,
                "description": plugin.description,
                "source_type": plugin.source_type,
                "source_url": plugin.source_url,
                "source_revision": plugin.source_revision,
                "runtime_type": plugin.runtime_type,
                "entry": plugin.entry,
                "status": plugin.status,
            }
            for plugin in plugins
        ],
        "system": {
            "version": "0.1.0",
            "environment": services.settings.app.name,
            "api_url": str(request.base_url).rstrip("/") + services.settings.app.api_prefix,
        },
    }
