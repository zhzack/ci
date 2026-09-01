"""API endpoints for machine runtime diagnostics, telemetry, process monitor,
file explorer, and web terminal console.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import PermissionDeniedError
from mini_pipeline.machine.diagnostics import (
    BatchDeleteRequest,
    CommandExecRequest,
    CommandExecResult,
    DirectoryEntry,
    DriveInfo,
    FileContentResult,
    NetworkDiagnostics,
    ProcessInfo,
    SaveFileRequest,
    SystemOverview,
)

router = APIRouter(prefix="/machines", tags=["machines-diagnostics"])


def _check_machine_access(services: Services, principal: PrincipalDep, machine_id: str):
    machine = services.machine_repository.get(machine_id)
    if not services.machines.can_use(principal, machine):
        raise PermissionDeniedError("No permission to access this machine diagnostics")
    return machine


@router.get("/{machine_id}/diagnostics/overview", response_model=SystemOverview)
def get_machine_overview(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> SystemOverview:
    """Get real-time CPU, RAM, Disk, GPU, and OS overview of the machine."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.get_overview(machine_id)


@router.get("/{machine_id}/diagnostics/processes", response_model=list[ProcessInfo])
def get_machine_processes(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[ProcessInfo]:
    """Get active processes running on the machine."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.get_processes(machine_id)


@router.get("/{machine_id}/diagnostics/network", response_model=NetworkDiagnostics)
def get_machine_network(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> NetworkDiagnostics:
    """Get comprehensive network diagnostics including interfaces, traffic and active sockets."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.get_network(machine_id)


@router.get("/{machine_id}/diagnostics/drives", response_model=list[DriveInfo])
def get_machine_drives(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[DriveInfo]:
    """Get all mounted disks, logical drives, and storage partitions on target machine."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.list_drives(machine_id)


@router.get("/{machine_id}/diagnostics/files", response_model=list[DirectoryEntry])
def list_machine_directory(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    path: Annotated[str, Query(description="Directory path on target machine")] = "/",
) -> list[DirectoryEntry]:
    """Explore directories and files on the target machine."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.list_directory(machine_id, path)


@router.get("/{machine_id}/diagnostics/files/content", response_model=FileContentResult)
def read_machine_file(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    path: Annotated[str, Query(description="Target file path to read")] = ...,
) -> FileContentResult:
    """Read a text file content for in-place preview and edit."""
    _check_machine_access(services, principal, machine_id)
    return services.diagnostics.read_file_content(machine_id, path)


@router.put("/{machine_id}/diagnostics/files/content")
def save_machine_file(
    machine_id: str,
    payload: SaveFileRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    """Save modified text file content back to the machine."""
    machine = _check_machine_access(services, principal, machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only machine managers/admins can modify remote files")
    services.diagnostics.write_file_content(machine_id, payload.path, payload.content)
    return {"message": "File saved successfully"}


@router.post("/{machine_id}/diagnostics/files/upload")
async def upload_machine_file(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    file: Annotated[UploadFile, File()],
    target_dir: Annotated[str, Form()] = "/",
) -> dict[str, str]:
    """Upload a local file to the target machine directory."""
    machine = _check_machine_access(services, principal, machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only machine managers/admins can upload files")
    content = await file.read()
    filename = file.filename or "uploaded_file"
    services.diagnostics.upload_file(machine_id, target_dir, filename, content)
    return {"message": f"File '{filename}' uploaded successfully"}


@router.get("/{machine_id}/diagnostics/files/download")
def download_machine_files(
    machine_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    paths: Annotated[list[str], Query(description="Files or directories to download as ZIP")] = ...,
) -> Response:
    """Download single or multiple files/folders as a ZIP archive."""
    _check_machine_access(services, principal, machine_id)
    zip_bytes, filename = services.diagnostics.download_files_as_zip(machine_id, paths)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{machine_id}/diagnostics/files/batch-delete")
def batch_delete_machine_files(
    machine_id: str,
    payload: BatchDeleteRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    """Batch delete selected files or directories."""
    machine = _check_machine_access(services, principal, machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only machine managers/admins can delete files")
    services.diagnostics.delete_paths(machine_id, payload.paths)
    return {"message": f"Deleted {len(payload.paths)} items successfully"}


@router.post("/{machine_id}/diagnostics/exec", response_model=CommandExecResult)
def exec_machine_command(
    machine_id: str,
    payload: CommandExecRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> CommandExecResult:
    """Execute a remote shell command against the target machine."""
    machine = _check_machine_access(services, principal, machine_id)
    if not services.machines.can_manage(principal, machine):
        raise PermissionDeniedError("Only machine managers/admins can execute shell commands")
    return services.diagnostics.exec_command(machine_id, payload)

