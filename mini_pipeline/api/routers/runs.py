"""Pipeline run, task log, artifact HTTP endpoints and SSE streams."""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import NotFoundError

router = APIRouter(prefix="/runs", tags=["runs"])

SSE_POLL_INTERVAL = 1.0
LOG_STREAM_POLL_INTERVAL = 0.3


class RunRequest(BaseModel):
    pipeline: str
    params: dict[str, Any] = Field(default_factory=dict)
    # Optional execution target: machine id or name (built-in runner if omitted).
    machine: str | None = None
    parent_run_id: str | None = None
    reuse_uploads: bool = True


class BranchRequest(BaseModel):
    from_step: str
    params: dict[str, Any] = Field(default_factory=dict)
    reuse_uploads: bool = True



class ArtifactResponse(BaseModel):
    id: str
    name: str
    size: int
    sha256: str

    @classmethod
    def from_entity(cls, entity) -> ArtifactResponse:
        return cls(id=entity.id, name=entity.name, size=entity.size, sha256=entity.sha256)


class TaskResponse(BaseModel):
    id: str
    name: str
    plugin: str
    status: str
    attempt: int = 1
    message: str | None
    outputs: dict[str, Any]
    started_at: datetime | None
    finished_at: datetime | None
    artifacts: list[ArtifactResponse]

    @classmethod
    def from_entity(cls, entity) -> TaskResponse:
        return cls(
            id=entity.id,
            name=entity.step_name,
            plugin=f"{entity.plugin_name}@{entity.plugin_version}",
            status=entity.status,
            attempt=getattr(entity, "attempt", 1) or 1,
            message=entity.message,
            outputs=entity.outputs or {},
            started_at=entity.started_at,
            finished_at=entity.finished_at,
            artifacts=[ArtifactResponse.from_entity(item) for item in entity.artifacts],
        )


class RunSummary(BaseModel):
    id: str
    pipeline_id: str
    pipeline_name: str
    status: str
    message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    task_count: int = 0
    failed_tasks: int = 0

    @classmethod
    def from_entity(cls, entity) -> RunSummary:
        tasks = entity.tasks or []
        return cls(
            id=entity.id,
            pipeline_id=entity.pipeline_id,
            pipeline_name=entity.pipeline_name,
            status=entity.status,
            message=entity.message,
            started_at=entity.started_at,
            finished_at=entity.finished_at,
            created_at=entity.created_at,
            task_count=len(tasks),
            failed_tasks=sum(
                1 for t in tasks if t.status in {"FAILED", "SKIPPED", "CANCELLED"}
            ),
        )


class RunResponse(RunSummary):
    params: dict[str, Any]
    uploads: dict[str, Any] = Field(default_factory=dict)
    tasks: list[TaskResponse]

    @classmethod
    def from_entity(cls, entity) -> RunResponse:
        base = RunSummary.from_entity(entity)
        return cls(
            **base.model_dump(),
            params=entity.params or {},
            uploads=entity.uploads or {},
            tasks=[TaskResponse.from_entity(item) for item in entity.tasks],
        )


@router.post("", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
def submit_run(
    payload: RunRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    run = services.runs.submit(
        payload.pipeline,
        payload.params,
        principal=principal,
        machine=payload.machine,
        parent_run_id=payload.parent_run_id,
        reuse_uploads=payload.reuse_uploads,
    )
    services.audit.record(
        principal, "run.submit", resource_type="run", resource_id=run.id,
        detail={"pipeline": run.pipeline_name, "machine": payload.machine},
    )
    return RunResponse.from_entity(run)


@router.post("/upload", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_run_with_files(
    request: Request,
    principal: PrincipalDep = None,
    services: Annotated[Services, Depends(get_services)] = None,
) -> RunResponse:
    form = await request.form()
    pipeline = str(form.get("pipeline", ""))
    params_json = str(form.get("params_json", "{}"))
    machine_val = form.get("machine")
    machine = str(machine_val) if machine_val else None
    parent_run_id_val = form.get("parent_run_id")
    parent_run_id = str(parent_run_id_val) if parent_run_id_val else None
    reuse_uploads_val = form.get("reuse_uploads")
    reuse_uploads = str(reuse_uploads_val).lower() != "false" if reuse_uploads_val else True

    try:
        params: dict[str, Any] = json.loads(params_json)
    except json.JSONDecodeError:
        params = {}

    uploads: dict[str, Path] = {}
    for key, value in form.multi_items():
        if isinstance(value, UploadFile) and value.filename:
            input_name = key
            if input_name.startswith("file_"):
                input_name = input_name[5:]
            if input_name.endswith("_file"):
                input_name = input_name[:-5]
            tmp_dir = Path(tempfile.mkdtemp(prefix="mp_upload_"))
            tmp_file = tmp_dir / value.filename
            with tmp_file.open("wb") as dest:
                shutil.copyfileobj(value.file, dest)
            uploads[input_name] = tmp_file
            uploads[value.filename] = tmp_file
            uploads[key] = tmp_file

    run = services.runs.submit_with_uploads(
        pipeline,
        params,
        uploads,
        principal=principal,
        machine=machine,
        parent_run_id=parent_run_id,
        reuse_uploads=reuse_uploads,
    )
    services.audit.record(
        principal, "run.submit", resource_type="run", resource_id=run.id,
        detail={"pipeline": run.pipeline_name, "machine": machine},
    )

    return RunResponse.from_entity(run)



@router.get("", response_model=Page[RunSummary])
def list_runs(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
    run_status: Annotated[str | None, Query(alias="status")] = None,
    pipeline: Annotated[str | None, Query()] = None,
) -> Page[RunSummary]:
    """Paginated run history, newest first, filterable by status/pipeline."""
    items, _ = services.runs.list(
        offset=0, limit=10_000, status=run_status, pipeline_name=pipeline
    )
    visible = [
        run
        for run in items
        if services.permissions.can_read_resource(
            principal, resource_type="run", resource_id=run.id, owner_id=run.owner_id
        )
    ]
    total = len(visible)
    window = visible[page_params.offset : page_params.offset + page_params.page_size]
    return page_params.envelope([RunSummary.from_entity(r) for r in window], total)


@router.get("/{run_id}", response_model=RunResponse)
def get_run(
    run_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    run = services.runs.get(run_id)
    _require_run_visible(services, principal, run)
    return RunResponse.from_entity(run)


@router.post("/{run_id}/cancel", response_model=RunResponse)
def cancel_run(
    run_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    """Cancel a pending/running run and terminate running plugin processes."""
    run = services.runs.get(run_id)
    _require_run_visible(services, principal, run)
    if not services.permissions.can_manage_resource(
        principal, resource_type="run", resource_id=run.id, owner_id=run.owner_id
    ):
        from mini_pipeline.domain.exceptions import PermissionDeniedError

        raise PermissionDeniedError("Only the run owner or an admin can cancel it")
    services.runs.cancel(run_id)
    return RunResponse.from_entity(services.runs.get(run_id))


def _require_run_visible(services: Services, principal, run) -> None:
    if not services.permissions.can_read_resource(
        principal, resource_type="run", resource_id=run.id, owner_id=run.owner_id
    ):
        raise NotFoundError(f"Pipeline run {run.id!r} was not found")


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
    request: Request,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    artifact = services.runs.get_artifact(artifact_id)
    if artifact.run_id != run_id:
        raise NotFoundError(f"Artifact {artifact_id!r} was not found in run {run_id!r}")
    run = services.runs.get(run_id)
    _require_run_visible(services, principal, run)
    # Strong validator: repeat downloads hit the client cache (304) instead
    # of re-transferring the body — large artifacts cost one conditional GET.
    etag = f'"{artifact.sha256}"'
    headers = {"ETag": etag, "Cache-Control": "private, max-age=31536000, immutable"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return FileResponse(
        path=Path(artifact.storage_path),
        filename=artifact.name,
        media_type="application/octet-stream",
        headers=headers,
    )


@router.post("/{run_id}/branches", response_model=RunResponse, status_code=status.HTTP_202_ACCEPTED)
def branch_run(
    run_id: str,
    payload: BranchRequest,
    services: Annotated[Services, Depends(get_services)],
) -> RunResponse:
    new_run = services.runs.branch_from_step(
        run_id, payload.from_step, payload.params, reuse_uploads=payload.reuse_uploads
    )
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


# ---------------------------------------------------------------------------
# Server-Sent Events: push-based progress with sub-second latency instead
# of aggressive client polling.
# ---------------------------------------------------------------------------


def _sse(payload: dict[str, Any], event: str = "message") -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


@router.get("/{run_id}/events")
async def stream_run_events(
    run_id: str,
    services: Annotated[Services, Depends(get_services)],
) -> StreamingResponse:
    """Live run/task state as an SSE stream.

    Events are pushed from the in-process event bus; a periodic DB snapshot
    acts as reconciliation so a client that missed an event still converges.
    The stream ends after the run reaches a terminal status.
    """

    async def generator() -> AsyncIterator[str]:
        from queue import Empty

        from mini_pipeline.domain.states import TERMINAL_RUN_STATUSES

        run = services.runs.get(run_id)
        yield _sse(RunResponse.from_entity(run).model_dump(mode="json"), "snapshot")

        subscriber_id, queue = services.events.subscribe(run_id)
        last_status = run.status
        try:
            while True:
                try:
                    event = await asyncio.to_thread(queue.get, True, SSE_POLL_INTERVAL)
                except Empty:
                    event = None

                if event is not None:
                    yield _sse(event.to_sse(), "event")
                    if event.type == "run.status":
                        last_status = str(event.data.get("status", last_status))
                        if last_status in {s.value for s in TERMINAL_RUN_STATUSES}:
                            return

                # Periodic reconciliation so missed queue events cannot hang
                # a client on a stale status forever.
                current = services.runs.get(run_id)
                if current.status != last_status:
                    last_status = current.status
                    yield _sse(
                        RunResponse.from_entity(current).model_dump(mode="json"),
                        "snapshot",
                    )
                    if last_status in {s.value for s in TERMINAL_RUN_STATUSES}:
                        return
        finally:
            services.events.unsubscribe(subscriber_id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{run_id}/tasks/{step_name}/log/stream")
async def stream_task_log(
    run_id: str,
    step_name: str,
    services: Annotated[Services, Depends(get_services)],
) -> StreamingResponse:
    """Tail a task's log file as SSE `log` events until the task finishes."""

    async def generator() -> AsyncIterator[str]:
        task = services.runs.get_task(run_id, step_name)
        path = Path(task.log_path) if task.log_path else None
        offset = 0
        while True:
            fresh = services.runs.get_task(run_id, step_name)
            terminal = fresh.status in {"SUCCESS", "FAILED", "SKIPPED", "CANCELLED"}
            if path is None or not path.is_file():
                if terminal:
                    return
                await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)
                continue
            size = path.stat().st_size
            if size > offset:
                with path.open("r", encoding="utf-8", errors="replace") as src:
                    src.seek(offset)
                    chunk = src.read()
                    offset = src.tell()
                if chunk:
                    yield _sse({"chunk": chunk, "offset": offset}, "log")
            if terminal and offset >= size:
                yield _sse(
                    {"status": fresh.status, "attempt": getattr(fresh, "attempt", 1)},
                    "end",
                )
                return
            await asyncio.sleep(LOG_STREAM_POLL_INTERVAL)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
