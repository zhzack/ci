"""Pipeline definition HTTP endpoints."""

from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.api.pagination import Page, PageParams
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import NotFoundError

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


class PipelineCreateRequest(BaseModel):
    definition: str


class PipelineUpdateRequest(BaseModel):
    definition: str


class ValidateRequest(BaseModel):
    definition: str
    params: dict[str, Any] = Field(default_factory=dict)


class PipelineResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_entity(cls, entity) -> "PipelineResponse":
        return cls(
            id=entity.id,
            name=entity.name,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )


class StepParamSchema(BaseModel):
    """Description of a single step's runtime parameters, used to build a form."""

    name: str
    plugin: str
    depends: list[str]
    fields: list["ParamField"]


class ParamField(BaseModel):
    key: str
    type: str
    source: str = "parameter"
    target: str = ""
    required: bool = False
    default: Optional[Any] = None
    description: str = ""


class PipelineParamsSchema(BaseModel):
    name: str
    global_params: dict[str, Any] = {}
    steps: list[StepParamSchema]


@router.post("", response_model=PipelineResponse, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    payload: PipelineCreateRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PipelineResponse:
    entity = services.pipelines.create(payload.definition, owner_id=principal.user_id)
    services.audit.record(
        principal, "pipeline.create", resource_type="pipeline",
        resource_id=entity.id, detail={"name": entity.name},
    )
    return PipelineResponse.from_entity(entity)


@router.post(
    "/yaml",
    response_model=PipelineResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_pipeline_yaml(
    request: Request,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PipelineResponse:
    definition = (await request.body()).decode("utf-8")
    entity = services.pipelines.create(definition, owner_id=principal.user_id)
    return PipelineResponse.from_entity(entity)


@router.get("", response_model=Page[PipelineResponse])
def list_pipelines(
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
    page_params: Annotated[PageParams, Depends()],
) -> Page[PipelineResponse]:
    items = services.pipeline_repository.list()
    visible = [
        item
        for item in items
        if services.permissions.can_read_resource(
            principal,
            resource_type="pipeline",
            resource_id=item.id,
            owner_id=item.owner_id,
        )
    ]
    total = len(visible)
    window = visible[page_params.offset : page_params.offset + page_params.page_size]
    return page_params.envelope(
        [PipelineResponse.from_entity(item) for item in window], total
    )


@router.get("/{identifier}", response_class=Response)
def get_pipeline(
    identifier: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    pipeline = services.pipelines.get(identifier)
    _ensure_pipeline_visible(services, principal, pipeline)
    return Response(content=pipeline.definition, media_type="application/yaml")


@router.put("/{identifier}", response_model=PipelineResponse)
def update_pipeline(
    identifier: str,
    payload: PipelineUpdateRequest,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> PipelineResponse:
    pipeline = services.pipelines.get(identifier)
    _ensure_pipeline_manage(services, principal, pipeline)
    return PipelineResponse.from_entity(
        services.pipelines.update(identifier, payload.definition)
    )


@router.delete("/{identifier}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pipeline(
    identifier: str,
    principal: PrincipalDep,
    services: Annotated[Services, Depends(get_services)],
) -> Response:
    pipeline = services.pipelines.get(identifier)
    _ensure_pipeline_manage(services, principal, pipeline)
    services.pipelines.delete(identifier)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _ensure_pipeline_visible(services: Services, principal, pipeline) -> None:
    if not services.permissions.can_read_resource(
        principal,
        resource_type="pipeline",
        resource_id=pipeline.id,
        owner_id=pipeline.owner_id,
    ):
        raise NotFoundError(f"Pipeline {pipeline.name!r} was not found")


def _ensure_pipeline_manage(services: Services, principal, pipeline) -> None:
    if not services.permissions.can_manage_resource(
        principal,
        resource_type="pipeline",
        resource_id=pipeline.id,
        owner_id=pipeline.owner_id,
    ):
        raise NotFoundError(f"Pipeline {pipeline.name!r} was not found")


@router.get("/{identifier}/params-schema", response_model=PipelineParamsSchema)
def pipeline_params_schema(
    identifier: str,
    services: Annotated[Services, Depends(get_services)],
) -> PipelineParamsSchema:
    """Return the schema needed to build a parameter form for the Run dialog.

    The per-step fields come from each referenced plugin's manifest. When a
    plugin is missing, the step still appears with an empty fields list so the
    client can fall back to free-form JSON.
    """
    entity, parsed = services.pipelines.get_parsed(identifier)
    steps: list[StepParamSchema] = []
    for step in parsed.steps:
        plugin_name, plugin_version = step.plugin_reference
        try:
            version = services.plugin_repository.get_version(plugin_name, plugin_version)
        except Exception:
            steps.append(
                StepParamSchema(
                    name=step.name,
                    plugin=step.plugin,
                    depends=list(step.depends),
                    fields=[],
                )
            )
            continue

        from pathlib import Path

        from mini_pipeline.plugin.manifest import load_manifest

        try:
            manifest = load_manifest(Path(version.install_path))
        except Exception:
            manifest = None

        fields: list[ParamField] = []
        if manifest is not None:
            inputs = manifest.contract.inputs
            if isinstance(inputs, list):
                for r in inputs:
                    fields.append(
                        ParamField(
                            key=r.name,
                            type=r.type or "string",
                            source=r.source or "parameter",
                            target=r.target or r.name,
                            required=bool(r.required),
                            default=r.default,
                            description=r.description or "",
                        )
                    )
            else:
                for key, spec in inputs.items():
                    fields.append(
                        ParamField(
                            key=key,
                            type=spec.type or "string",
                            source="parameter",
                            target=key,
                            required=bool(spec.required),
                            default=spec.default,
                            description=spec.description or "",
                        )
                    )
        steps.append(
            StepParamSchema(
                name=step.name,
                plugin=step.plugin,
                depends=list(step.depends),
                fields=fields,
            )
        )
    return PipelineParamsSchema(
        name=entity.name,
        global_params=dict(parsed.params),
        steps=steps,
    )


StepParamSchema.model_rebuild()


@router.post("/validate")
def validate_pipeline(
    payload: ValidateRequest,
    services: Annotated[Services, Depends(get_services)],
) -> dict:
    """Check that every required input in every step has a wiring source."""
    return services.pipelines.validate(payload.definition, params=payload.params or {})
