"""Top-level API router assembly."""

from fastapi import APIRouter

from mini_pipeline.api.routers.artifacts import router as artifacts_router
from mini_pipeline.api.routers.dashboard import router as dashboard_router
from mini_pipeline.api.routers.debug import router as debug_router
from mini_pipeline.api.routers.pipelines import router as pipelines_router
from mini_pipeline.api.routers.plugins import router as plugins_router
from mini_pipeline.api.routers.runs import router as runs_router

router = APIRouter()
api_router = APIRouter()
api_router.include_router(plugins_router)
api_router.include_router(pipelines_router)
api_router.include_router(runs_router)
api_router.include_router(artifacts_router)
api_router.include_router(dashboard_router)
api_router.include_router(debug_router)


@router.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok"}
