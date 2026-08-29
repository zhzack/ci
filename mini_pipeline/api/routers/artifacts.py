"""Artifact catalog HTTP endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("", response_model=Page[dict[str, Any]])
def list_artifacts(
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
    run_id: Annotated[str | None, Query(description="Filter by run id")] = None,
) -> Page[dict[str, Any]]:
    items = services.run_repository.list_artifacts(
        offset=page_params.offset, limit=page_params.page_size, run_id=run_id
    )
    total = services.run_repository.count_artifacts(run_id=run_id)
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
        for item in items
    ]
    return page_params.envelope(serialized, total)
