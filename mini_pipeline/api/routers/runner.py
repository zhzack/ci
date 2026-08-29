"""Runner agent API: claim tasks, heartbeat, stream logs, report results.

All endpoints authenticate with a per-machine token (``mrt_…``). Tokens are
issued at registration and shown once; the server only stores their SHA-256.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from mini_pipeline.account.service import MachineIdentity
from mini_pipeline.api.auth import require_machine
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services
from mini_pipeline.database.models import TaskRun
from mini_pipeline.domain.exceptions import NotFoundError, ValidationError
from mini_pipeline.domain.states import TaskStatus
from mini_pipeline.runner.bundle import build_task_bundle

router = APIRouter(prefix="/runner", tags=["runner"])

_TERMINAL = {"SUCCESS", "FAILED", "CANCELLED"}


def _json_response(payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(content=payload)


def _own_task(services: Services, identity: MachineIdentity, task_id: str) -> TaskRun:
    try:
        task = services.run_repository.get_task_by_id(task_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if task.machine_id != identity.machine.id:
        raise HTTPException(
            status_code=403, detail="Task is assigned to a different machine"
        )
    return task


class HeartbeatRequest(BaseModel):
    agent_version: str | None = None
    active_task_ids: list[str] = Field(default_factory=list)


@router.post("/heartbeat")
def heartbeat(
    payload: HeartbeatRequest,
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Renew leases for executing tasks; returns cancel directives."""
    return services.machines.heartbeat(
        identity.machine, payload.agent_version, payload.active_task_ids
    )


@router.post("/tasks/claim")
def claim_task(
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    """Atomically claim the next QUEUED task for this machine (204 if none)."""
    task = services.run_repository.claim_next_task(
        machine_id=identity.machine.id,
        lease_seconds=services.settings.runner.lease_seconds,
    )
    if task is None:
        return Response(status_code=204)
    engine = services.engine
    remote = engine.remote_inputs.get(task.id)
    plugin = remote.plugin if remote else None
    return _json_response({
        "task_id": task.id,
        "run_id": task.run_id,
        "step_name": task.step_name,
        "attempt": task.attempt,
        "plugin": {
            "name": task.plugin_name,
            "version": task.plugin_version,
            "runtime_type": plugin.runtime_type if plugin else "shell",
            "entry": plugin.entry if plugin else "run.sh",
        },
        "timeout_seconds": remote.timeout_seconds if remote else 3600,
        "params": remote.params if remote else {},
    })


class TaskLogChunk(BaseModel):
    chunk: str


@router.post("/tasks/{task_id}/logs", status_code=202)
def push_logs(
    task_id: str,
    payload: TaskLogChunk,
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    task = _own_task(services, identity, task_id)
    log_path = (
        services.settings.storage.logs / task.run_id / f"{task.id}.log"
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as sink:
        sink.write(payload.chunk)
    if not task.log_path:
        services.run_repository.set_task_state(
            task.id, TaskStatus(task.status), log_path=str(log_path)
        )
    return {"status": "accepted"}


@router.get("/tasks/{task_id}/bundle")
def download_bundle(
    task_id: str,
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
) -> FileResponse:
    task = _own_task(services, identity, task_id)
    remote = services.engine.remote_inputs.get(task.id)
    if remote is None:
        raise HTTPException(
            status_code=404, detail="Task inputs are no longer available (expired)"
        )
    if remote.bundle_path is None or not Path(remote.bundle_path).is_file():
        remote.bundle_path = build_task_bundle(
            task=task,
            plugin=remote.plugin,
            resolved_params=remote.params,
            dependencies=remote.dependencies,
            uploads=remote.uploads,
            temp_root=services.settings.storage.temp,
            run_id=remote.run_id,
            run_params=remote.run_params,
        )
    return FileResponse(
        path=Path(remote.bundle_path),
        filename=f"{task.id}.zip",
        media_type="application/zip",
    )


class TaskStatusReport(BaseModel):
    status: str
    message: str = ""
    outputs: dict[str, Any] = Field(default_factory=dict)


@router.post("/tasks/{task_id}/status")
def report_status(
    task_id: str,
    payload: TaskStatusReport,
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    task = _own_task(services, identity, task_id)
    if payload.status not in _TERMINAL:
        raise ValidationError(
            f"Runner may only report terminal statuses, got {payload.status!r}"
        )
    if task.status in _TERMINAL:
        return {"status": "ignored", "detail": "Task already terminal"}
    log_path = services.settings.storage.logs / task.run_id / f"{task.id}.log"
    services.run_repository.set_task_state(
        task.id,
        TaskStatus(payload.status),
        message=payload.message or None,
        outputs=payload.outputs or None,
        log_path=str(log_path) if log_path.is_file() else task.log_path,
        finished_at=datetime.utcnow(),
    )
    services.engine._publish(
        task.run_id, "task.status",
        task_id=task.id, step_name=task.step_name,
        data={"status": payload.status, "message": payload.message},
    )
    return {"status": "accepted"}


@router.post("/tasks/{task_id}/artifacts", status_code=201)
def upload_artifacts(
    task_id: str,
    identity: Annotated[MachineIdentity, Depends(require_machine)],
    services: Annotated[Services, Depends(get_services)],
    files: Annotated[list[UploadFile], File(description="Artifact files")] = None,
) -> dict[str, Any]:
    """Persist artifact files reported by the runner; names come from the
    multipart filenames (artifact display name)."""
    import hashlib
    import shutil as _shutil
    import tempfile

    if files is None:
        files = []
    task = _own_task(services, identity, task_id)
    stored: list[dict[str, Any]] = []
    for upload in files or []:
        name = Path(upload.filename or "").name
        if not name:
            continue
        tmp_dir = Path(tempfile.mkdtemp(prefix="mp_runner_art_"))
        tmp_path = tmp_dir / name
        digest = hashlib.sha256()
        size = 0
        with tmp_path.open("wb") as sink:
            while chunk := upload.file.read(1024 * 1024):
                sink.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        # store() persists the artifact and its DB record in one step.
        record = services.artifacts.store(
            run_id=task.run_id, task_id=task.id, name=name, source=tmp_path
        )
        _shutil.rmtree(tmp_dir, ignore_errors=True)
        stored.append(
            {"id": record.id, "name": record.name, "size": record.size,
             "sha256": record.sha256}
        )
        _ = digest
    return {"artifacts": stored}
