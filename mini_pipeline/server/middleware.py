"""ASGI middleware: request IDs, access logging, rate limiting."""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from contextvars import ContextVar
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

logger = logging.getLogger("mini_pipeline.access")

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a request id to every request and echo it back.

    The id comes from the client's ``X-Request-ID`` when provided (so
    gateway trace ids survive) or is generated. Access logs and error
    responses carry it, which makes correlating a slow request with its
    server-side log lines trivial.
    """

    def __init__(self, app, access_log: bool = True) -> None:
        super().__init__(app)
        self.access_log = access_log

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        rid = request.headers.get("x-request-id") or _generate_request_id()
        token = request_id_var.set(rid)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        if self.access_log:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.info(
                json.dumps(
                    {
                        "event": "access",
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "duration_ms": round(duration_ms, 1),
                        "request_id": rid,
                    },
                    separators=(",", ":"),
                )
            )
        return response


def _generate_request_id() -> str:
    import uuid

    return uuid.uuid4().hex[:16]


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window per-client-IP limiter for mutating requests.

    Deliberately dependency-free and in-process: it protects the API and
    the scheduler from accidental loops and abusive clients. For horizontal
    deployments put a real gateway (nginx/traefik) in front instead.
    """

    def __init__(self, app, *, requests_per_minute: int) -> None:
        super().__init__(app)
        self.requests_per_minute = max(0, requests_per_minute)
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if (
            self.requests_per_minute <= 0
            or request.method not in _MUTATING_METHODS
        ):
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        window_start = time.time() - 60.0
        with self._lock:
            hits = self._hits[client]
            while hits and hits[0] < window_start:
                hits.popleft()
            if len(hits) >= self.requests_per_minute:
                retry_after = max(1, int(60 - (time.time() - hits[0])))
                return Response(
                    content=json.dumps(
                        {"detail": "Rate limit exceeded; slow down."}
                    ),
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(time.time())
        return await call_next(request)
