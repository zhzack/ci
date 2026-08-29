"""API authentication and role enforcement (user accounts + legacy tokens).

Token resolution order for normal API routes:

1. auth disabled → anonymous admin (local development);
2. ``mpt_…`` bearer token → user session (DB-backed, admin/user role);
3. static config token (``auth.tokens``) → legacy admin/reader principal;
4. anything else → 401. Machine tokens (``mrt_…``) are only valid on
   ``/api/runner/**`` and are rejected here.

Route-level rules: ``/api/debug/**`` and ``/api/admin/**`` require the admin
role; everything else only requires authentication.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from mini_pipeline.account.service import (
    _ANONYMOUS,
    Principal,
)
from mini_pipeline.core.config import Settings

READ_METHODS = {"GET", "HEAD", "OPTIONS"}
ADMIN_ONLY_PREFIXES = ("/api/debug", "/api/admin")


def _extract_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header:
        scheme, _, value = header.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    return request.headers.get("x-api-key")


def resolve_principal(settings: Settings, services, token: str | None) -> Principal:
    """Resolve any bearer token into a Principal, or raise AuthError."""
    from mini_pipeline.domain.exceptions import AuthFailedError

    if not settings.auth.enabled:
        return _ANONYMOUS
    if not token:
        raise AuthFailedError("Missing API token")
    if token.startswith("mrt_"):
        raise AuthFailedError("Machine tokens are only valid on /api/runner")
    if token.startswith("mpt_"):
        principal = services.account.resolve_session(token)
        if principal is None:
            raise AuthFailedError("Session expired or invalid")
        return principal
    for candidate in settings.auth.tokens:
        import secrets as _secrets

        if _secrets.compare_digest(candidate.token, token):
            # Legacy static tokens keep the reader read-only semantics.
            return Principal(name=candidate.name or "api-key", role=candidate.role)
    raise AuthFailedError("Invalid API token")


def _enforce_route_rules(principal: Principal, path: str, method: str) -> None:
    from mini_pipeline.domain.exceptions import PermissionDeniedError

    is_admin_area = any(path.startswith(prefix) for prefix in ADMIN_ONLY_PREFIXES)
    if is_admin_area and not principal.is_admin:
        raise PermissionDeniedError("Admin role required")
    # Legacy static reader tokens stay read-only.
    if principal.role == "reader" and method not in READ_METHODS:
        raise PermissionDeniedError("Reader tokens cannot mutate")
    if principal.is_machine:
        from mini_pipeline.domain.exceptions import AuthFailedError

        raise AuthFailedError("Machine tokens are only valid on /api/runner")


async def require_auth(request: Request) -> Principal:
    settings: Settings = request.app.state.settings
    services = request.app.state.services
    token = _extract_token(request)
    principal = resolve_principal(settings, services, token)
    _enforce_route_rules(principal, request.url.path, request.method)
    return principal


async def require_admin(principal: Annotated[Principal, Depends(require_auth)]) -> Principal:
    from mini_pipeline.domain.exceptions import PermissionDeniedError

    if not principal.is_admin:
        raise PermissionDeniedError("Admin role required")
    return principal


def resolve_machine_identity(services, token: str | None):
    """Resolve a runner token into a MachineIdentity, or raise AuthFailed."""
    from mini_pipeline.domain.exceptions import AuthFailedError

    if not token or not token.startswith("mrt_"):
        raise AuthFailedError("Runner endpoints require a machine token (mrt_…)")
    identity = services.machines.resolve_identity(token)
    if identity is None:
        raise AuthFailedError("Machine token is invalid or revoked")
    return identity


async def require_machine(request: Request):
    services = request.app.state.services
    return resolve_machine_identity(services, _extract_token(request))


MachinePrincipal = Annotated[object, Depends(require_machine)]
PrincipalDep = Annotated[Principal, Depends(require_auth)]
