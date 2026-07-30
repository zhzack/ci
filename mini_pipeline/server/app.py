"""FastAPI application factory and lifecycle."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from mini_pipeline import __version__
from mini_pipeline.api.router import api_router, router
from mini_pipeline.core.config import Settings, load_settings
from mini_pipeline.core.container import Services
from mini_pipeline.domain.exceptions import (
    ConflictError,
    MiniPipelineError,
    NotFoundError,
    ValidationError,
)

DEFAULT_CONFIG_CANDIDATES = (
    "config/default.yaml",
    "../config/default.yaml",
    "../../config/default.yaml",
)


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

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services = Services.build(resolved_settings)
        app.state.services = services
        try:
            yield
        finally:
            services.close()

    app = FastAPI(title=resolved_settings.app.name, version=__version__, lifespan=lifespan)
    app.include_router(router)
    app.include_router(api_router, prefix=resolved_settings.app.api_prefix)

    @app.exception_handler(MiniPipelineError)
    async def domain_error_handler(_request: Request, exc: MiniPipelineError) -> JSONResponse:
        if isinstance(exc, NotFoundError):
            status_code = 404
        elif isinstance(exc, ConflictError):
            status_code = 409
        elif isinstance(exc, ValidationError):
            status_code = 422
        else:
            status_code = 400
        return JSONResponse(status_code=status_code, content={"detail": str(exc)})

    return app


app = create_app()
