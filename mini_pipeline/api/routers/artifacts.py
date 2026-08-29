"""Artifact catalog HTTP endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("", response_model=Page[dict[str, Any]])
def list_artifacts(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    page_params: Annotated[PageParams, Depends()],
    run_id: Annotated[str | None, Query(description="Filter by run id")] = None,
) -> Page[dict[str, Any]]:
    items = services.run_repository.list_artifacts(
        offset=0, limit=10_000, run_id=run_id
    )
    visible = []
    seen_runs: set[str] = set()
    for item in items:
        if item.run_id not in seen_runs:
            run = services.runs.get(item.run_id)
            seen_runs[item.run_id] = services.permissions.can_read_resource(
                principal,
                resource_type="run",
                resource_id=run.id,
                owner_id=run.owner_id,
            )
        if seen_runs[item.run_id]:
            visible.append(item)
    total = len(visible)
    window = visible[page_params.offset : page_params.offset + page_params.page_size]
    serialized = [
        {
            "id": item.id,
            "run_id": item.run_id,
            "task_id": item.task_id,
            "name": item.name,
            "size": item.size,
            "sha256": item.sha256,
            "created_at": item.created_at,
        }
        for item in window
    ]
    return page_params.envelope(serialized, total)
