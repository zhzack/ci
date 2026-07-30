"""Pipeline run, task log, and artifact HTTP endpoints."""

from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import NotFoundError

router = APIRouter(prefix="/runs", tags=["runs"])


class RunRequest(BaseModel):
    pipeline: str
    params: dict[str, Any] = Field(default_factory=dict)


class BranchRequest(BaseModel):
    from_step: str
    params: dict[str, Any] = Field(default_factory=dict)


class ArtifactResponse(BaseModel):
    id: str
    name: str
    size: int
    sha256: str

    @classmethod
    def from_entity(cls, entity) -> "ArtifactResponse":
        return cls(id=entity.id, name=entity.name, size=entity.size, sha256=entity.sha256)


class TaskResponse(BaseModel):
    id: str
    name: str
    plugin: str
    status: str
    message: Optional[str]
    outputs: dict[str, Any]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    artifacts: list[ArtifactResponse]

    @classmethod
    def from_entity(cls, entity) -> "TaskResponse":
        return cls(
            id=entity.id,
            name=entity.step_name,
            plugin=f"{entity.plugin_name}@{entity.plugin_version}",
            status=entity.status,
            message=entity.message,
            outputs=entity.outputs or {},
            started_at=entity.started_at,
            finished_at=entity.finished_at,
            artifacts=[ArtifactResponse.from_entity(item) for item in entity.artifacts],
        )


class RunResponse(BaseModel):
    id: str
    pipeline_id: str
    pipeline_name: str
    status: str
    params: dict[str, Any]
    message: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime
    tasks: list[TaskResponse]

    @classmethod
    def from_entity(cls, entity) -> "RunResponse":
        return cls(
            id=entity.id,
            pipeline_id=entity.pipeline_id,
            pipeline_name=entity.pipeline_name,
            status=entity.status,
            params=entity.params or {},
            message=entity.message,
            started_at=entity.started_at,
            finished_at=entity.finished_at,
            created_at=entity.created_at,
            tasks=[TaskResponse.from_entity(item) for item in entity.tasks],
        )


@router.post("", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
def submit_run(
    payload: RunRequest,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    return RunResponse.from_entity(services.runs.submit(payload.pipeline, payload.params))


@router.get("/{run_id}", response_model=RunResponse)
def get_run(
    run_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    return RunResponse.from_entity(services.runs.get(run_id))


@router.get("/{run_id}/tasks/{step_name}/log", response_class=Response)
def get_task_log(
    run_id: str,
    step_name: str,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    return Response(
        content=services.runs.read_log(run_id, step_name),
        media_type="text/plain; charset=utf-8",
    )


@router.get("/{run_id}/artifacts/{artifact_id}", response_class=FileResponse)
def download_artifact(
    run_id: str,
    artifact_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> FileResponse:
    artifact = services.runs.get_artifact(artifact_id)
    if artifact.run_id != run_id:
        raise NotFoundError(f"Artifact {artifact_id!r} was not found in run {run_id!r}")
    return FileResponse(
        path=Path(artifact.storage_path),
        filename=artifact.name,
        media_type="application/octet-stream",
    )


@router.post("/{run_id}/branches", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
def branch_run(
    run_id: str,
    payload: BranchRequest,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    new_run = services.runs.branch_from_step(run_id, payload.from_step, payload.params)
    return RunResponse.from_entity(new_run)


@router.get("/{run_id}/aggregated-log", response_class=Response)
def aggregated_log(
    run_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    return Response(
        content=services.runs.read_aggregated_log(run_id),
        media_type="text/plain; charset=utf-8",
    )
