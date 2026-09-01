"""Plugin registration and catalog HTTP endpoints."""

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services
from mini_pipeline.source.git import GitSource
from mini_pipeline.source.upload import FolderFile

router = APIRouter(prefix="/plugins", tags=["plugins"])


class PluginSourceRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    url: Optional[str] = None
    branch: Optional[str] = None
    tag: Optional[str] = None
    revision: Optional[str] = None
    commit: Optional[str] = None
    credential_id: Optional[str] = None


class GitBranchesRequest(BaseModel):
    url: str
    credential_id: Optional[str] = None


class RegisterPluginRequest(BaseModel):
    source: PluginSourceRequest


class PluginResponse(BaseModel):
    id: str
    name: str
    version: str
    description: str
    source_type: str
    source_url: Optional[str]
    source_revision: Optional[str]
    runtime_type: str
    entry: str
    status: str
    plugin_id: str = ""
    owner_id: Optional[str] = None
    visibility: str = "public"
    review_status: str = "approved"

    @classmethod
    def from_entity(cls, entity: Any) -> "PluginResponse":
        plugin = entity.plugin
        return cls(
            id=entity.id,
            name=entity.name,
            version=entity.version,
            description=entity.description,
            source_type=entity.source_type,
            source_url=entity.source_url,
            source_revision=entity.source_revision,
            runtime_type=entity.runtime_type,
            entry=entity.entry,
            status=entity.status,
            plugin_id=entity.plugin_id,
            owner_id=plugin.owner_id if plugin is not None else None,
            visibility=plugin.visibility if plugin is not None else "public",
            review_status=plugin.review_status if plugin is not None else "approved",
        )


@router.post("/register", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
def register_plugin(
    payload: RegisterPluginRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    entity = services.plugins.register(
        payload.source.model_dump(exclude_none=True), owner_id=principal.user_id
    )
    services.audit.record(
        principal, "plugin.register", resource_type="plugin",
        resource_id=entity.id, detail={"ref": f"{entity.name}@{entity.version}"},
    )
    return PluginResponse.from_entity(entity)


@router.post("/git-branches")
def list_git_branches(
    req: GitBranchesRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Probe remote Git repository branches and tags using optional credentials."""
    cred_payload = None
    if req.credential_id:
        cred_payload = services.credentials.resolve_secret(
            req.credential_id, user_id=principal.user_id
        )
    return GitSource.list_remote_branches(req.url, cred_payload)


@router.post("/upload", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
def upload_plugin(
    file: Annotated[UploadFile, File(description="Plugin ZIP archive")],
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    entity = services.plugins.register_upload(file.file, owner_id=principal.user_id)
    services.audit.record(
        principal, "plugin.upload", resource_type="plugin",
        resource_id=entity.id, detail={"ref": f"{entity.name}@{entity.version}"},
    )
    return PluginResponse.from_entity(entity)


@router.post(
    "/upload-folder",
    response_model=PluginResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_plugin_folder(
    files: Annotated[
        list[UploadFile],
        File(description="Plugin folder contents (one multipart per file)"),
    ],
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded")

    folder_files: list[FolderFile] = []
    for upload in files:
        rel_path = upload.filename or ""
        if not rel_path:
            continue
        content = await upload.read()
        folder_files.append(
            FolderFile(path=rel_path, content=content, is_dir=False)
        )

    entity = services.plugins.register_folder(folder_files, owner_id=principal.user_id)
    return PluginResponse.from_entity(entity)


@router.get("", response_model=Page[PluginResponse])
def list_plugins(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
    search: Annotated[Optional[str], Query(max_length=128)] = None,
) -> Page[PluginResponse]:
    rows = services.plugin_repository.list_versions()
    visible = [
        row
        for row in rows
        if services.permissions.can_read_resource(
            principal,
            resource_type="plugin",
            resource_id=row.plugin_id,
            owner_id=row.plugin.owner_id,
            visibility=row.plugin.visibility,
        )
    ]
    if search:
        needle = search.lower()
        visible = [
            row for row in visible
            if needle in row.name.lower() or needle in row.version.lower()
        ]
    total = len(visible)
    items = visible[page_params.offset : page_params.offset + page_params.page_size]
    return page_params.envelope([PluginResponse.from_entity(e) for e in items], total)


@router.get("/{name}/{version}", response_model=PluginResponse)
def get_plugin(
    name: str,
    version: str,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    return PluginResponse.from_entity(services.plugins.get(name, version))


@router.get("/store")
def store_plugins(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
) -> Page[PluginResponse]:
    """Plugin catalog: approved public plugins + everything the caller owns."""
    rows = services.plugin_repository.list_versions()
    visible = [
        row
        for row in rows
        if services.permissions.can_read_resource(
            principal,
            resource_type="plugin",
            resource_id=row.plugin_id,
            owner_id=row.plugin.owner_id,
            visibility=row.plugin.visibility,
        )
    ]
    # Store front page shows installable-by-others plugins first.
    visible.sort(
        key=lambda row: (
            row.plugin.review_status != "approved" or row.plugin.visibility != "public",
            row.name,
        )
    )
    total = len(visible)
    items = visible[page_params.offset : page_params.offset + page_params.page_size]
    return page_params.envelope([PluginResponse.from_entity(e) for e in items], total)


class PublishRequest(BaseModel):
    plugin_id: str


@router.post("/store/publish", status_code=202)
def request_publish(
    payload: PublishRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, str]:
    """Submit a personal plugin for store review (admin approves)."""
    from mini_pipeline.database.account_repositories import set_plugin_review

    plugin = services.plugin_repository.get(payload.plugin_id)
    if not services.permissions.can_manage_resource(
        principal, resource_type="plugin", resource_id=plugin.id, owner_id=plugin.owner_id
    ):
        from mini_pipeline.domain.exceptions import PermissionDeniedError

        raise PermissionDeniedError("Only the plugin owner can publish it")
    if plugin.owner_id is None:
        from mini_pipeline.domain.exceptions import ValidationError

        raise ValidationError("Platform plugins are already public")
    set_plugin_review(services.database, plugin.id, "pending")
    services.audit.record(
        principal, "plugin.publish_request", resource_type="plugin", resource_id=plugin.id,
    )
    return {"plugin_id": plugin.id, "review_status": "pending"}


@router.post("/store/review")
def review_plugin(
    payload: PublishRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    approve: bool = True,
) -> dict[str, str]:
    if not principal.is_admin:
        from mini_pipeline.domain.exceptions import PermissionDeniedError

        raise PermissionDeniedError("Admin role required")
    from mini_pipeline.database.account_repositories import set_plugin_review

    plugin = services.plugin_repository.get(payload.plugin_id)
    if approve:
        set_plugin_review(services.database, plugin.id, "approved", visibility="public")
    else:
        set_plugin_review(services.database, plugin.id, "rejected", visibility="private")
    services.audit.record(
        principal, "plugin.review", resource_type="plugin", resource_id=plugin.id,
        detail={"approved": approve},
    )
    status = "approved" if approve else "rejected"
    return {"plugin_id": plugin.id, "review_status": status}


@router.get("/{name}/{version}/manifest")
def get_plugin_manifest(
    name: str,
    version: str,
    services: Annotated[Services, Depends(get_services)],
) -> dict:
    """Return the parsed plugin manifest (inputs, outputs, runtime) for editor use."""
    from pathlib import Path

    from mini_pipeline.plugin.manifest import load_manifest

    entity = services.plugins.get(name, version)
    plugin_path = Path(entity.install_path)
    manifest = load_manifest(plugin_path)
    payload = manifest.model_dump(mode="json")
    # Backward-compatible top-level aliases: clients written against the
    # legacy manifest layout keep working alongside the v2 `contract` shape.
    contract = payload.get("contract") or {}
    payload.setdefault("inputs", contract.get("inputs", []))
    payload.setdefault("outputs", contract.get("outputs", []))
    return payload


@router.delete("/{name}/{version}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plugin(
    name: str,
    version: str,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    import shutil

    try:
        services.plugins.get(name, version)
    except Exception as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=str(exc)) from exc

    services.plugin_repository.delete_version(name, version)

    target = services.settings.storage.plugins / name / version
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
