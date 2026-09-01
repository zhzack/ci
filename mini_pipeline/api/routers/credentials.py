"""Credential & Secret Vault HTTP endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from mini_pipeline.api.auth import PrincipalDep
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter(prefix="/credentials", tags=["credentials"])


class CredentialCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=64, description="Unique identifier for secret")
    type: str = Field(description="username_password | secret_text | ssh_key | secret_file")
    scope: str = Field(default="personal", description="personal | team | global")
    payload: dict[str, Any] = Field(description="Sensitive credential data to encrypt")
    description: str = Field(default="", max_length=500)
    team_id: str | None = None
    domain_patterns: list[str] = Field(
        default_factory=list, description="Optional domain wildcard patterns"
    )


class CredentialUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    scope: str | None = Field(default=None)
    payload: dict[str, Any] | None = None
    team_id: str | None = None
    domain_patterns: list[str] | None = None


@router.get("")
def list_credentials(
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> list[dict[str, Any]]:
    """List all credentials and secrets visible to the current user."""
    return services.credentials.list_credentials_for_user(principal)


@router.get("/match")
def match_credentials(
    url: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> list[dict[str, Any]]:
    """Find credentials matching a specific URL or domain pattern."""
    return services.credentials.match_credentials_for_url(principal, url)


@router.post("", status_code=201)
def create_credential(
    req: CredentialCreateRequest,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> dict[str, Any]:
    """Create and safely encrypt a new credential in the vault."""
    return services.credentials.create_credential(
        user=principal,
        name=req.name,
        type_=req.type,
        scope=req.scope,
        payload=req.payload,
        description=req.description,
        team_id=req.team_id,
        domain_patterns=req.domain_patterns,
    )


@router.get("/{credential_id}")
def get_credential(
    credential_id: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> dict[str, Any]:
    """Get metadata and masked data for a specific credential."""
    return services.credentials.get_credential(principal, credential_id)


@router.get("/{credential_id}/raw")
def get_raw_credential(
    credential_id: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> dict[str, Any]:
    """Get plaintext data for owner or platform admin."""
    return services.credentials.get_raw_credential(principal, credential_id)


@router.put("/{credential_id}")
def update_credential(
    credential_id: str,
    req: CredentialUpdateRequest,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> dict[str, Any]:
    """Update credential metadata or replace secret payload."""
    return services.credentials.update_credential(
        user=principal,
        credential_id=credential_id,
        name=req.name,
        description=req.description,
        scope=req.scope,
        payload=req.payload,
        team_id=req.team_id,
        domain_patterns=req.domain_patterns,
    )


@router.delete("/{credential_id}", status_code=204)
def delete_credential(
    credential_id: str,
    services: Annotated[Services, Depends(get_services)],
    principal: PrincipalDep,
) -> Response:
    """Delete a credential from the vault."""
    services.credentials.delete_credential(principal, credential_id)
    return Response(status_code=204)
