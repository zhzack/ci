"""Artifact catalog HTTP endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import NotFoundError, PermissionDeniedError
from mini_pipeline.storage.base import StorageItem

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class PublishToPackagesRequest(BaseModel):
    target_dir: str = Field(default="artifacts", description="Target folder in package hub")
    filename: str | None = Field(default=None, description="Optional custom filename")


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


@router.post("/{artifact_id}/publish-to-packages", response_model=StorageItem)
def publish_artifact_to_packages(
    artifact_id: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: PublishToPackagesRequest | None = None,
) -> StorageItem:
    req = body or PublishToPackagesRequest()
    artifact = services.run_repository.get_artifact(artifact_id)
    run = services.runs.get(artifact.run_id)
    if not services.permissions.can_read_resource(
        principal, resource_type="run", resource_id=run.id, owner_id=run.owner_id
    ):
        raise PermissionDeniedError("Cannot access this artifact's run")
    if principal.role == "reader":
        raise PermissionDeniedError("Reader cannot publish to packages")

    artifact_path = Path(artifact.storage_path)
    if not artifact_path.is_file():
        raise NotFoundError(f"Artifact file on disk not found: {artifact.storage_path}")

    filename = req.filename or artifact.name
    with artifact_path.open("rb") as stream:
        return services.package_storage.save_uploaded_file(
            target_dir=req.target_dir,
            filename=filename,
            stream=stream,
        )
