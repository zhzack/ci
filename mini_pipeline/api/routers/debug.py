"""Debug endpoints for inspecting pipeline state without CLI access.

Admin-only (enforced by the auth dependency on the /api router). All data
is served through the ORM repositories so these endpoints work identically
on SQLite and PostgreSQL.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/debug", tags=["debug"])


class PipelineSummary(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class PluginSummary(BaseModel):
    name: str
    version: str
    description: str
    source_type: str
    runtime_type: str
    entry: str


@router.get("/pipelines", response_model=list[PipelineSummary])
def list_pipelines(
    services: Annotated[Services, Depends(get_services)],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> list[dict[str, Any]]:
    items = services.pipeline_repository.list_paged(offset=0, limit=limit)
    return [
        PipelineSummary.model_validate(item, from_attributes=True).model_dump()
        for item in items
    ]


@router.get("/pipelines/{pipeline_id}")
def pipeline_detail(
    pipeline_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    try:
        pipeline = services.pipeline_repository.get(pipeline_id)
    except Exception:
        raise HTTPException(
            status_code=404, detail=f"Pipeline {pipeline_id!r} not found"
        ) from None
    runs = services.run_repository.list_runs(pipeline_name=pipeline.name, limit=1)
    return {
        "id": pipeline.id,
        "name": pipeline.name,
        "created_at": pipeline.created_at,
        "updated_at": pipeline.updated_at,
        "latest_run": (
            {
                "id": runs[0].id,
                "status": runs[0].status,
                "created_at": runs[0].created_at,
            }
            if runs
            else None
        ),
    }


@router.get("/runs")
def list_runs(
    services: Annotated[Services, Depends(get_services)],
    pipeline: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 20,
) -> list[dict[str, Any]]:
    items = services.run_repository.list_runs(
        offset=0, limit=limit, pipeline_name=pipeline
    )
    return [
        {
            "id": r.id,
            "pipeline_id": r.pipeline_id,
            "pipeline_name": r.pipeline_name,
            "status": r.status,
            "created_at": r.created_at,
            "started_at": r.started_at,
            "finished_at": r.finished_at,
            "message": r.message,
            "parent_run_id": r.parent_run_id,
            "branched_from_step": r.branched_from_step,
        }
        for r in items
    ]


@router.get("/runs/{run_id}")
def run_detail(
    run_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    try:
        run = services.run_repository.get(run_id)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found") from None
    return {
        "id": run.id,
        "pipeline_name": run.pipeline_name,
        "status": run.status,
        "params": run.params,
        "message": run.message,
        "created_at": run.created_at,
        "tasks": [
            {
                "name": t.step_name,
                "plugin": f"{t.plugin_name}@{t.plugin_version}",
                "status": t.status,
                "attempt": t.attempt,
                "message": t.message,
                "outputs": t.outputs,
                "artifacts": [
                    {"id": a.id, "name": a.name, "size": a.size, "sha256": a.sha256}
                    for a in t.artifacts
                ],
            }
            for t in run.tasks
        ],
    }


@router.get("/plugins", response_model=list[PluginSummary])
def list_plugins(
    services: Annotated[Services, Depends(get_services)],
) -> list[dict[str, Any]]:
    items = services.plugin_repository.list_versions()
    return [PluginSummary.model_validate(item, from_attributes=True).model_dump() for item in items]


@router.get("/filesystem")
def filesystem_summary(
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    root = Path(services.settings.storage.root).resolve()
    out: dict[str, Any] = {"root": str(root)}
    for sub in ("plugins", "workspaces", "logs", "artifacts", "tmp"):
        path = root / sub
        out[sub] = {
            "path": str(path),
            "exists": path.exists(),
            "size_bytes": (
                sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
                if path.exists()
                else 0
            ),
            "file_count": (
                sum(1 for _ in path.rglob("*") if _.is_file()) if path.exists() else 0
            ),
        }
    return out


@router.get("/on-disk/{plugin_name}")
def on_disk_plugin(
    plugin_name: str,
    services: Annotated[Services, Depends(get_services)],
    version: str | None = None,
) -> dict[str, Any]:
    base = Path(services.settings.storage.plugins) / plugin_name
    if not base.exists():
        raise HTTPException(status_code=404, detail=f"No plugin {plugin_name!r} on disk")
    versions = sorted(p.name for p in base.iterdir() if p.is_dir())
    if version and version not in versions:
        raise HTTPException(status_code=404, detail=f"Version {version!r} not found")
    target = base / version if version else base / versions[-1]
    files = []
    for p in target.rglob("*"):
        if p.is_file():
            files.append({
                "path": str(p.relative_to(target)),
                "size": p.stat().st_size,
            })
    manifest = (target / "plugin.yaml").read_text(encoding="utf-8")
    return {
        "plugin": plugin_name,
        "version": target.name,
        "path": str(target),
        "files": files,
        "plugin_yaml": manifest,
    }
