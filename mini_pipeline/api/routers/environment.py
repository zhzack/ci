"""API Router for Runtime Environments and Remote Machine Deployments."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse

from mini_pipeline.account.service import Principal
from mini_pipeline.api.auth import require_admin, require_auth
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services
from mini_pipeline.environment.models import (
    CreateRuntimeEnvironmentRequest,
    DeployEnvironmentRequest,
    EnvironmentDeployTaskOut,
    RuntimeEnvironmentOut,
    UpdateRuntimeEnvironmentRequest,
)

router = APIRouter(prefix="/environments", tags=["environments"])

AuthPrincipal = Annotated[Principal, Depends(require_auth)]
AdminPrincipal = Annotated[Principal, Depends(require_admin)]


@router.get("", response_model=list[RuntimeEnvironmentOut])
def list_environments(
    principal: AuthPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> list[RuntimeEnvironmentOut]:
    _ = principal
    return services.environments.list_environments()


@router.post("", response_model=RuntimeEnvironmentOut, status_code=status.HTTP_201_CREATED)
def create_environment(
    payload: CreateRuntimeEnvironmentRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> RuntimeEnvironmentOut:
    _ = principal
    return services.environments.create_environment(payload)


@router.get("/deploy-tasks", response_model=list[EnvironmentDeployTaskOut])
def list_deploy_tasks(
    principal: AuthPrincipal,
    services: Annotated[Services, Depends(get_services)],
    limit: int = 50,
) -> list[EnvironmentDeployTaskOut]:
    _ = principal
    return services.environments.list_deploy_tasks(limit=limit)


@router.get("/deploy-tasks/{task_id}", response_model=EnvironmentDeployTaskOut)
def get_deploy_task(
    task_id: str,
    principal: AuthPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> EnvironmentDeployTaskOut:
    _ = principal
    return services.environments.get_deploy_task(task_id)


@router.get("/deploy-tasks/{task_id}/events")
async def stream_deploy_task_events(
    task_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> StreamingResponse:
    """SSE endpoint streaming live progress, status transitions and logs for a deployment task."""

    async def event_generator():
        async for event in services.environments.stream_task_events(task_id):
            data_str = json.dumps(event.model_dump(), ensure_ascii=False)
            yield f"data: {data_str}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{env_id}", response_model=RuntimeEnvironmentOut)
def get_environment(
    env_id: str,
    principal: AuthPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> RuntimeEnvironmentOut:
    _ = principal
    return services.environments.get_environment(env_id)


@router.patch("/{env_id}", response_model=RuntimeEnvironmentOut)
def update_environment(
    env_id: str,
    payload: UpdateRuntimeEnvironmentRequest,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> RuntimeEnvironmentOut:
    _ = principal
    return services.environments.update_environment(env_id, payload)


@router.delete("/{env_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_environment(
    env_id: str,
    principal: AdminPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> None:
    _ = principal
    services.environments.delete_environment(env_id)


@router.post("/{env_id}/deploy", response_model=list[EnvironmentDeployTaskOut])
def deploy_environment(
    env_id: str,
    payload: DeployEnvironmentRequest,
    principal: AuthPrincipal,
    services: Annotated[Services, Depends(get_services)],
) -> list[EnvironmentDeployTaskOut]:
    """Batch deploy runtime environment to selected machines."""
    user_id = principal.user_id if principal else None
    return services.environments.deploy_environment(
        env_id, payload, triggered_by=user_id
    )
