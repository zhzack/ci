"""Prometheus metrics for HTTP traffic and pipeline execution."""

from __future__ import annotations

import time

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

REGISTRY = CollectorRegistry(auto_describe=True)

HTTP_REQUESTS_TOTAL = Counter(
    "mini_pipeline_http_requests_total",
    "Total HTTP requests by method, route template and status code.",
    ("method", "route", "status"),
    registry=REGISTRY,
)
HTTP_REQUEST_DURATION = Histogram(
    "mini_pipeline_http_request_duration_seconds",
    "HTTP request latency in seconds by route template.",
    ("method", "route"),
    registry=REGISTRY,
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)
RUNS_TOTAL = Counter(
    "mini_pipeline_runs_total",
    "Pipeline runs by terminal status.",
    ("status",),
    registry=REGISTRY,
)
TASK_DURATION = Histogram(
    "mini_pipeline_task_duration_seconds",
    "Plugin task wall-clock duration by plugin.",
    ("plugin",),
    registry=REGISTRY,
    buckets=(0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600),
)
TASK_RETRIES_TOTAL = Counter(
    "mini_pipeline_task_retries_total",
    "Automatic task retries that were scheduled.",
    ("plugin",),
    registry=REGISTRY,
)

_content_type = "text/plain; version=0.0.4; charset=utf-8"


def render_metrics() -> Response:
    payload = generate_latest(REGISTRY)
    return Response(content=payload, media_type=_content_type)


def observe_run_status(status: str) -> None:
    RUNS_TOTAL.labels(status=status).inc()


def observe_task_duration(plugin: str, seconds: float) -> None:
    TASK_DURATION.labels(plugin=plugin).observe(seconds)


def observe_task_retry(plugin: str) -> None:
    TASK_RETRIES_TOTAL.labels(plugin=plugin).inc()


class MetricsMiddleware(BaseHTTPMiddleware):
    """Count requests and record latency per route template.

    Using ``request.scope["route"].path`` keeps label cardinality bounded
    (e.g. ``/api/runs/{run_id}`` instead of one series per run id).
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            route = request.scope.get("route")
            path = getattr(route, "path", request.url.path)
            method = request.method
            HTTP_REQUESTS_TOTAL.labels(
                method=method, route=path, status=str(status_code)
            ).inc()
            HTTP_REQUEST_DURATION.labels(method=method, route=path).observe(
                time.perf_counter() - started
            )
