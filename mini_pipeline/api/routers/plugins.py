"""Plugin registration and catalog HTTP endpoints."""

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict

from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services
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

    @classmethod
    def from_entity(cls, entity: Any) -> "PluginResponse":
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
        )


@router.post("/register", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
def register_plugin(
    payload: RegisterPluginRequest,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    entity = services.plugins.register(payload.source.model_dump(exclude_none=True))
    return PluginResponse.from_entity(entity)


@router.post("/upload", response_model=PluginResponse, status_code=status.HTTP_201_CREATED)
def upload_plugin(
    file: Annotated[UploadFile, File(description="Plugin ZIP archive")],
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    entity = services.plugins.register_upload(file.file)
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

    entity = services.plugins.register_folder(folder_files)
    return PluginResponse.from_entity(entity)


@router.get("", response_model=Page[PluginResponse])
def list_plugins(
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
    search: Annotated[Optional[str], Query(max_length=128)] = None,
) -> Page[PluginResponse]:
    items = services.plugin_repository.list_versions_paged(
        offset=page_params.offset, limit=page_params.page_size, search=search
    )
    total = services.plugin_repository.count_versions(search=search)
    return page_params.envelope([PluginResponse.from_entity(e) for e in items], total)


@router.get("/{name}/{version}", response_model=PluginResponse)
def get_plugin(
    name: str,
    version: str,
    services: Annotated[Services, Depends(get_services)],
) -> PluginResponse:
    return PluginResponse.from_entity(services.plugins.get(name, version))


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
