"""Top-level API router assembly."""

from fastapi import APIRouter, Depends

from mini_pipeline.api.auth import require_auth
from mini_pipeline.api.routers.artifacts import router as artifacts_router
from mini_pipeline.api.routers.dashboard import router as dashboard_router
from mini_pipeline.api.routers.debug import router as debug_router
from mini_pipeline.api.routers.pipelines import router as pipelines_router
from mini_pipeline.api.routers.plugins import router as plugins_router
from mini_pipeline.api.routers.runs import router as runs_router
from mini_pipeline.server.observability import router as observability_router

# Auth is enforced once, for the whole /api surface: unauthenticated
# requests fail with 401, reader tokens get 403 on mutations/debug.
api_router = APIRouter(dependencies=[Depends(require_auth)])
api_router.include_router(plugins_router)
api_router.include_router(pipelines_router)
api_router.include_router(runs_router)
api_router.include_router(artifacts_router)
api_router.include_router(dashboard_router)
api_router.include_router(debug_router)

router = APIRouter()
router.include_router(observability_router)
