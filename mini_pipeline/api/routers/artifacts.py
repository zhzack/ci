"""Artifact catalog HTTP endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("")
def list_artifacts(
    services: Annotated[Services, Depends(get_services)],
) -> list[dict]:
    artifacts = services.run_repository.list_artifacts()
    return [
        {
            "id": item.id,
            "run_id": item.run_id,
            "task_id": item.task_id,
            "name": item.name,
            "size": item.size,
            "sha256": item.sha256,
            "created_at": item.created_at,
        }
        for item in artifacts
    ]
