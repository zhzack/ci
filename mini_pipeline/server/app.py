"""FastAPI application factory and lifecycle."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from mini_pipeline import __version__
from mini_pipeline.api.router import (
    account_public_api_router,
    api_router,
    router,
    runner_api_router,
)
from mini_pipeline.core.config import Settings, load_settings
from mini_pipeline.core.container import Services
from mini_pipeline.core.logging import configure_logging
from mini_pipeline.domain.exceptions import (
    AuthFailedError,
    ConflictError,
    MiniPipelineError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from mini_pipeline.server.installer import installer_router
from mini_pipeline.server.middleware import RateLimitMiddleware, RequestIDMiddleware

DEFAULT_CONFIG_CANDIDATES = (
    "config/default.yaml",
    "../config/default.yaml",
    "../../config/default.yaml",
)

_TAGS_METADATA = [
    {
        "name": "plugins",
        "description": "Register, inspect, and remove plugin versions.",
    },
    {
        "name": "pipelines",
        "description": "Create and manage pipeline YAML definitions.",
    },
    {
        "name": "runs",
        "description": (
            "Submit runs, follow live progress, cancel, and fetch logs and artifacts."
        ),
    },
    {
        "name": "artifacts",
        "description": "Cross-run artifact catalog and downloads.",
    },
    {
        "name": "dashboard",
        "description": "Aggregated statistics for the overview page.",
    },
    {
        "name": "debug",
        "description": "Raw database/storage inspection. Admin only — never expose publicly.",
    },
    {
        "name": "system",
        "description": "Health, readiness, version and metrics endpoints.",
    },
]


def _default_config_path() -> Path:
    explicit = os.getenv("MINI_PIPELINE_CONFIG")
    if explicit:
        return Path(explicit)
    module_path = Path(__file__).resolve()
    for parent in module_path.parents:
        for candidate in DEFAULT_CONFIG_CANDIDATES:
            path = parent / candidate
            if path.is_file():
                return path
    return Path("config/default.yaml")


def create_app(
    settings: Optional[Settings] = None,
    *,
    config_path: Optional[Path] = None,
) -> FastAPI:
    resolved_settings = settings or load_settings(
        config_path or _default_config_path()
    )
    configure_logging(resolved_settings.logging)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services = Services.build(resolved_settings)
        app.state.services = services
        app.state.settings = resolved_settings
        try:
            yield
        finally:
            services.close()

    app = FastAPI(
        title=resolved_settings.app.name,
        version=__version__,
        lifespan=lifespan,
        description=(
            "Lightweight pipeline execution platform: plugins are plain "
            "processes, pipelines are YAML DAGs, results are addressable "
            "artifacts. See `docs/architecture.md` for the design."
        ),
        openapi_tags=_TAGS_METADATA,
    )

    # Middleware (outermost last): request-id + access log wrap everything,
    # metrics observe after rate limiting, gzip sits closest to the app.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if resolved_settings.security.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=resolved_settings.security.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["X-Request-ID"],
        )
    app.add_middleware(RateLimitMiddleware,
                       requests_per_minute=resolved_settings.security.rate_limit_per_minute)
    if resolved_settings.observability.metrics_enabled:
        from mini_pipeline.server.metrics import MetricsMiddleware

        app.add_middleware(MetricsMiddleware)
    app.add_middleware(RequestIDMiddleware)

    app.include_router(router)
    app.include_router(installer_router)
    app.include_router(api_router, prefix=resolved_settings.app.api_prefix)
    app.include_router(
        account_public_api_router, prefix=resolved_settings.app.api_prefix
    )
    app.include_router(runner_api_router, prefix=resolved_settings.app.api_prefix)

    @app.exception_handler(MiniPipelineError)
    async def domain_error_handler(_request: Request, exc: MiniPipelineError) -> JSONResponse:
        headers = {"X-Request-ID": _request.headers.get("x-request-id", "")}
        if isinstance(exc, NotFoundError):
            status_code = 404
        elif isinstance(exc, ConflictError):
            status_code = 409
        elif isinstance(exc, ValidationError):
            status_code = 422
        elif isinstance(exc, AuthFailedError):
            status_code = 401
            headers["WWW-Authenticate"] = "Bearer"
        elif isinstance(exc, PermissionDeniedError):
            status_code = 403
        else:
            status_code = 400
        return JSONResponse(
            status_code=status_code,
            content={"detail": str(exc)},
            headers=headers,
        )

    return app


app = create_app()
