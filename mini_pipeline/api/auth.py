"""API key authentication with coarse-grained roles.

Tokens live in the YAML configuration (``auth.tokens``) and are compared
with constant-time equality. Two roles exist:

* **reader** — every GET/HEAD request (read-only API surface);
* **admin** — everything, including mutations and ``/api/debug``.

When ``auth.enabled`` is false (the development default) every request is
treated as an anonymous admin so local development needs zero setup.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import HTTPException, Request

from mini_pipeline.core.config import Settings

READ_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class Principal:
    name: str
    role: str  # "admin" | "reader"

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


_ANONYMOUS = Principal(name="anonymous", role="admin")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


def _extract_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header:
        scheme, _, value = header.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    return request.headers.get("x-api-key")


def authenticate(settings: Settings, request: Request) -> Principal:
    """Resolve the caller's principal from the request, or raise 401."""
    if not settings.auth.enabled:
        return _ANONYMOUS

    token = _extract_token(request)
    if not token:
        raise _unauthorized("Missing API token")
    for candidate in settings.auth.tokens:
        if secrets.compare_digest(candidate.token, token):
            return Principal(name=candidate.name or "api-key", role=candidate.role)
    raise _unauthorized("Invalid API token")


async def require_auth(request: Request) -> Principal:
    """FastAPI dependency: authenticate and enforce role-based access.

    Reader tokens may only issue read requests; mutations and the debug
    router require an admin token. Mounted as a router-level dependency.
    """
    settings: Settings = request.app.state.settings
    principal = authenticate(settings, request)

    is_debug = request.url.path.startswith(f"{settings.app.api_prefix}/debug")
    if (is_debug or request.method not in READ_METHODS) and not principal.is_admin:
        raise _forbidden("Admin role required for this operation")
    return principal
