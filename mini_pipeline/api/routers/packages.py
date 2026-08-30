"""REST API endpoints for package and artifact repository management with sharing and zones."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.routers.plugins import PluginResponse
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import PermissionDeniedError
from mini_pipeline.storage.base import (
    DirectoryListing,
    FilePreview,
    StorageItem,
    StorageStats,
)

router = APIRouter(prefix="/packages", tags=["packages"])
public_router = APIRouter(prefix="/packages", tags=["packages"])


class CreateDirRequest(BaseModel):
    path: str = Field(default="", description="Parent directory path")
    name: str = Field(min_length=1, max_length=100, description="New directory name")


class SaveTextRequest(BaseModel):
    path: str = Field(min_length=1, description="Target file path")
    content: str = Field(description="Updated text content")


class PublishPluginRequest(BaseModel):
    path: str = Field(min_length=1, description="Path to zip or directory in package store")


class ExtractRequest(BaseModel):
    path: str = Field(min_length=1, description="Path to zip or tar archive in package store")
    target_dir: str | None = Field(default=None, description="Optional extract target directory")


class CopyRequest(BaseModel):
    src_path: str = Field(min_length=1, description="Source path to copy")
    dst_path: str = Field(min_length=1, description="Destination path")


class BatchPathsRequest(BaseModel):
    paths: list[str] = Field(min_length=1, description="List of file/dir paths")


class BatchCopyRequest(BaseModel):
    src_paths: list[str] = Field(min_length=1, description="Source paths to copy")
    dst_dir: str = Field(default="", description="Destination directory path")


class CreateShareRequest(BaseModel):
    source_path: str = Field(min_length=1, description="Path to file or directory to share")
    share_type: str = Field(default="live", pattern="^(live|snapshot)$")
    description: str = Field(default="", max_length=500)
    expires_in_hours: int | None = Field(default=None, ge=1, le=87600)


class ShareLinkResponse(BaseModel):
    id: str
    token: str
    owner_id: str
    source_path: str
    share_type: str
    description: str
    expires_at: datetime | None = None
    created_at: datetime


class ImportShareRequest(BaseModel):
    target_path: str = Field(default="", description="Target path in personal or shared zone")


def _require_write(principal: PrincipalDep) -> None:
    if principal.role == "reader":
        raise PermissionDeniedError("Read-only token cannot modify packages")


@router.get("", response_model=DirectoryListing)
def list_directory(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    path: Annotated[str, Query(description="Relative directory path to list")] = "",
) -> DirectoryListing:
    services.package_storage.check_zone_access(principal, path, write=False)
    return services.package_storage.list_directory(path, principal=principal)


@router.get("/stats", response_model=StorageStats)
def get_storage_stats(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    path: Annotated[str, Query(description="Scope directory path to analyze")] = "",
) -> StorageStats:
    services.package_storage.check_zone_access(principal, path, write=False)
    return services.package_storage.get_stats(path, principal=principal)


@router.post("/mkdir", response_model=StorageItem)
def create_directory(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: CreateDirRequest,
) -> StorageItem:
    _require_write(principal)
    target_zone = f"{body.path}/{body.name}" if body.path else body.name
    services.package_storage.check_zone_access(principal, target_zone, write=True)
    return services.package_storage.create_directory(body.path, body.name)


@router.post("/upload", response_model=StorageItem)
def upload_file(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    file: Annotated[UploadFile, File(...)],
    target_dir: Annotated[str, Form()] = "",
    relative_path: Annotated[str, Form()] = "",
) -> StorageItem:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, target_dir, write=True)
    return services.package_storage.save_uploaded_file(
        target_dir=target_dir,
        filename=file.filename or "upload.bin",
        stream=file.file,
        relative_path=relative_path or None,
    )


@router.post("/extract", response_model=StorageItem)
def extract_archive(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: ExtractRequest,
) -> StorageItem:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.path, write=False)
    target = body.target_dir or body.path
    services.package_storage.check_zone_access(principal, target, write=True)
    return services.package_storage.extract_archive(body.path, target_dir=body.target_dir)


@router.post("/copy", response_model=StorageItem)
def copy_item(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: CopyRequest,
) -> StorageItem:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.src_path, write=False)
    services.package_storage.check_zone_access(principal, body.dst_path, write=True)
    return services.package_storage.copy_item(body.src_path, body.dst_path)


@router.get("/download")
def download_file(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    path: Annotated[str, Query(description="Path to file to download")],
) -> StreamingResponse:
    services.package_storage.check_zone_access(principal, path, write=False)
    stream, mime, size, filename = services.package_storage.get_file(path)
    encoded_filename = quote(filename)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{encoded_filename}"; '
            f"filename*=UTF-8''{encoded_filename}"
        ),
        "Content-Length": str(size),
    }

    def iter_stream():
        try:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(iter_stream(), media_type=mime, headers=headers)


@router.post("/batch-download")
def batch_download_files(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: BatchPathsRequest,
) -> StreamingResponse:
    for path in body.paths:
        services.package_storage.check_zone_access(principal, path, write=False)

    stream, mime, size, filename = services.package_storage.batch_get_files(body.paths)
    encoded_filename = quote(filename)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{encoded_filename}"; '
            f"filename*=UTF-8''{encoded_filename}"
        ),
        "Content-Length": str(size),
    }

    def iter_stream():
        try:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(iter_stream(), media_type=mime, headers=headers)


@router.post("/batch-delete")
def batch_delete_items(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: BatchPathsRequest,
) -> dict[str, Any]:
    _require_write(principal)
    deleted_count = 0
    for path in body.paths:
        services.package_storage.check_zone_access(principal, path, write=True)
        if services.package_storage.delete_item(path, recursive=True):
            deleted_count += 1

    return {"success": True, "deleted_count": deleted_count}


@router.post("/batch-copy")
def batch_copy_items(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: BatchCopyRequest,
) -> dict[str, Any]:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.dst_dir, write=True)
    dst_clean = body.dst_dir.strip().replace("\\", "/").strip("/")

    copied_items: list[StorageItem] = []
    for src in body.src_paths:
        services.package_storage.check_zone_access(principal, src, write=False)
        src_clean = src.strip().replace("\\", "/").strip("/")
        base_name = src_clean.split("/")[-1]
        target_path = f"{dst_clean}/{base_name}" if dst_clean else base_name
        item = services.package_storage.copy_item(src_clean, target_path)
        copied_items.append(item)

    return {"success": True, "copied_count": len(copied_items)}


@router.get("/preview", response_model=FilePreview)
def preview_file(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    path: Annotated[str, Query(description="Path to file to preview")],
) -> FilePreview:
    services.package_storage.check_zone_access(principal, path, write=False)
    return services.package_storage.preview_file(path)


@router.put("/file", response_model=StorageItem)
def save_file(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: SaveTextRequest,
) -> StorageItem:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.path, write=True)
    return services.package_storage.save_text_file(body.path, body.content)


@router.delete("")
def delete_item(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    path: Annotated[str, Query(description="Path to file or directory")],
    recursive: Annotated[bool, Query(description="Recursive delete for directory")] = False,
) -> dict[str, bool]:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, path, write=True)
    success = services.package_storage.delete_item(path, recursive=recursive)
    return {"success": success}


@router.post("/publish-plugin", response_model=PluginResponse)
def publish_plugin(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: PublishPluginRequest,
) -> PluginResponse:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.path, write=False)
    owner_id = getattr(principal, "user_id", None)
    record = services.package_storage.publish_as_plugin(body.path, owner_id=owner_id)
    return PluginResponse.from_entity(record)


# --- Share Link Endpoints ---


@router.post("/share", response_model=ShareLinkResponse)
def create_share_link(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: CreateShareRequest,
) -> ShareLinkResponse:
    _require_write(principal)
    services.package_storage.check_zone_access(principal, body.source_path, write=False)
    owner_id = getattr(principal, "user_id", "") or principal.name
    expires_at = (
        datetime.utcnow() + timedelta(hours=body.expires_in_hours)
        if body.expires_in_hours
        else None
    )
    link = services.package_storage.create_share_link(
        owner_id=owner_id,
        source_path=body.source_path,
        share_type=body.share_type,
        description=body.description,
        expires_at=expires_at,
    )
    return ShareLinkResponse(
        id=link.id,
        token=link.token,
        owner_id=link.owner_id,
        source_path=link.source_path,
        share_type=link.share_type,
        description=link.description,
        expires_at=link.expires_at,
        created_at=link.created_at,
    )


@router.get("/shares", response_model=list[ShareLinkResponse])
def list_user_shares(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> list[ShareLinkResponse]:
    owner_id = getattr(principal, "user_id", "") or principal.name
    links = services.package_storage.list_user_shares(owner_id)
    return [
        ShareLinkResponse(
            id=link.id,
            token=link.token,
            owner_id=link.owner_id,
            source_path=link.source_path,
            share_type=link.share_type,
            description=link.description,
            expires_at=link.expires_at,
            created_at=link.created_at,
        )
        for link in links
    ]


@router.delete("/shares/{token}")
def revoke_share_link(
    token: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> dict[str, bool]:
    _require_write(principal)
    owner_id = None if principal.is_admin else (getattr(principal, "user_id", "") or principal.name)
    success = services.package_storage.delete_share_link(token, owner_id=owner_id)
    return {"success": success}


@public_router.get("/shared/{token}", response_model=DirectoryListing)
def list_shared_content(
    token: str,
    services: Annotated[Services, Depends(get_services)],
    path: Annotated[str, Query(description="Relative sub-path within share")] = "",
) -> DirectoryListing:
    """Browse shared folder contents via share token (no principal needed if token is valid)."""
    return services.package_storage.list_shared_directory(token, sub_path=path)


@public_router.get("/shared/{token}/download")
def download_shared_content(
    token: str,
    services: Annotated[Services, Depends(get_services)],
    path: Annotated[str, Query(description="Relative sub-path within share to download")] = "",
) -> StreamingResponse:
    """Download shared file or folder as zip via share token."""
    stream, mime, size, filename = services.package_storage.get_shared_file(token, sub_path=path)
    encoded_filename = quote(filename)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{encoded_filename}"; '
            f"filename*=UTF-8''{encoded_filename}"
        ),
        "Content-Length": str(size),
    }

    def iter_stream():
        try:
            while True:
                chunk = stream.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            stream.close()

    return StreamingResponse(iter_stream(), media_type=mime, headers=headers)


@router.post("/shared/{token}/import", response_model=StorageItem)
def import_shared_content(
    token: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
    body: ImportShareRequest,
) -> StorageItem:
    """Import a share link into the current user's personal space (Live link or Snapshot copy)."""
    _require_write(principal)
    username = getattr(principal, "name", "") or getattr(principal, "username", "") or "anonymous"
    user_id = getattr(principal, "user_id", "") or username
    return services.package_storage.import_from_share(
        token=token,
        target_path=body.target_path,
        importer_user_id=user_id,
        importer_username=username,
    )


# --- Directory ACL Grants ---


class CreatePackageGrantRequest(BaseModel):
    path: str = Field(min_length=1, description="Path to grant access for")
    grantee_type: str = Field(pattern="^(user|team)$")
    grantee_id: str = Field(min_length=1)
    permission: str = Field(default="viewer", pattern="^(viewer|operator)$")


class PackageGrantResponse(BaseModel):
    id: str
    resource_id: str
    grantee_type: str
    grantee_id: str
    permission: str
    granted_by: str | None
    created_at: datetime


@router.post("/grants", response_model=PackageGrantResponse, status_code=201)
def create_package_grant(
    body: CreatePackageGrantRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PackageGrantResponse:
    _require_write(principal)
    grant = services.package_storage.grant_path_access(
        principal=principal,
        path=body.path,
        grantee_type=body.grantee_type,
        grantee_id=body.grantee_id,
        permission=body.permission,
    )
    return PackageGrantResponse(
        id=grant.id,
        resource_id=grant.resource_id,
        grantee_type=grant.grantee_type,
        grantee_id=grant.grantee_id,
        permission=grant.permission,
        granted_by=grant.granted_by,
        created_at=grant.created_at,
    )


@router.get("/grants", response_model=list[PackageGrantResponse])
def list_package_grants(
    path: Annotated[str, Query(description="Path to query grants for")],
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> list[PackageGrantResponse]:
    grants = services.package_storage.list_path_grants(principal=principal, path=path)
    return [
        PackageGrantResponse(
            id=g.id,
            resource_id=g.resource_id,
            grantee_type=g.grantee_type,
            grantee_id=g.grantee_id,
            permission=g.permission,
            granted_by=g.granted_by,
            created_at=g.created_at,
        )
        for g in grants
    ]


@router.delete("/grants/{grant_id}")
def revoke_package_grant(
    grant_id: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, bool]:
    _require_write(principal)
    services.package_storage.revoke_path_grant(principal=principal, grant_id=grant_id)
    return {"success": True}

