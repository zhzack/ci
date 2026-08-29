"""Health, readiness, version, and metrics endpoints."""

from __future__ import annotations

import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text

from mini_pipeline import __version__
from mini_pipeline.api.dependencies import get_services
from mini_pipeline.core.container import Services

router = APIRouter()

_started_at = time.time()


def uptime_seconds() -> float:
    return time.time() - _started_at


@router.get("/health", tags=["system"])
def health() -> dict[str, Any]:
    """Liveness probe: the process is up. Never touches dependencies."""
    return {
        "status": "ok",
        "version": __version__,
        "uptime_seconds": round(uptime_seconds(), 1),
    }


@router.get("/health/ready", tags=["system"])
def ready(
    response: Response,
    services: Annotated[Services, Depends(get_services)],
) -> dict[str, Any]:
    """Readiness probe: verifies every critical dependency.

    Returns 200 only when the database accepts queries and the storage
    root is writable; otherwise 503 so orchestrators stop routing traffic.
    """
    checks: dict[str, str] = {}
    ok = True

    try:
        with services.database.session() as session:
            session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc.__class__.__name__}"
        ok = False

    probe = services.settings.storage.root / ".readiness-probe"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        checks["storage"] = "ok"
    except OSError as exc:
        checks["storage"] = f"error: {exc.__class__.__name__}"
        ok = False

    dispatcher_ok = services.dispatcher.accepting
    checks["dispatcher"] = "ok" if dispatcher_ok else "shutting down"
    ok = ok and dispatcher_ok

    if not ok:
        response.status_code = 503
    return {"status": "ready" if ok else "unavailable", "checks": checks}


@router.get("/health/version", tags=["system"])
def version() -> dict[str, str]:
    return {
        "name": "mini-pipeline",
        "version": __version__,
        "api": "v2",
    }


@router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    from mini_pipeline.server.metrics import render_metrics

    return render_metrics()
