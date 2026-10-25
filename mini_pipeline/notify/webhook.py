"""Run-finished webhook dispatch with HMAC-SHA256 signing.

A pipeline may register outbound webhooks in its definition::

    webhooks:
      - url: https://ci.example.com/hooks/minipipeline
        secret: a-shared-signing-key
        events: [run.finished]

When a run reaches a terminal status the payload is POSTed to every
registered URL. Deliveries run on a small worker pool; failures are logged
and never affect the run itself.

Verification recipe for receivers: the ``X-MiniPipeline-Signature`` header
is ``sha256=<hex>`` of HMAC(secret, ``<timestamp>.<raw body>``) where
``<timestamp>`` is the ``X-MiniPipeline-Timestamp`` header (unix seconds).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="webhook")
_TIMEOUT = 10.0


def sign_payload(secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over ``<timestamp>.<body>`` — mirrored by receivers."""
    mac = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode() + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def build_run_finished_payload(
    *,
    run_id: str,
    pipeline_name: str,
    status: str,
    message: str = "",
    started_at: Any = None,
    finished_at: Any = None,
    tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    duration_s = None
    if started_at is not None and finished_at is not None:
        try:
            duration_s = round((finished_at - started_at).total_seconds(), 3)
        except Exception:
            duration_s = None
    return {
        "event": "run.finished",
        "delivery_id": uuid.uuid4().hex,
        "run_id": run_id,
        "pipeline": pipeline_name,
        "status": status,
        "message": message,
        "duration_s": duration_s,
        "started_at": str(started_at) if started_at else None,
        "finished_at": str(finished_at) if finished_at else None,
        "tasks": tasks or [],
        "timestamp": time.time(),
    }


def dispatch_run_webhooks(
    hooks: list[Any],
    payload: dict[str, Any],
) -> None:
    """Queue one delivery per hook; never raises."""
    for hook in hooks:
        events = getattr(hook, "events", None) or ["run.finished"]
        if "run.finished" not in events:
            continue
        _executor.submit(_deliver, hook, payload)


def _deliver(hook: Any, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, default=str, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-MiniPipeline-Event": str(payload.get("event", "run.finished")),
        "X-MiniPipeline-Delivery": str(payload.get("delivery_id", "")),
        "X-MiniPipeline-Run-Id": str(payload.get("run_id", "")),
    }
    secret = getattr(hook, "secret", None)
    if secret:
        timestamp = str(int(time.time()))
        headers["X-MiniPipeline-Timestamp"] = timestamp
        headers["X-MiniPipeline-Signature"] = sign_payload(secret, timestamp, body)
    try:
        response = httpx.post(hook.url, content=body, headers=headers, timeout=_TIMEOUT)
        logger.info(
            "Webhook %s -> %s delivered (%s) for run %s",
            hook.url, response.status_code, payload.get("event"), payload.get("run_id"),
        )
    except Exception:
        logger.warning(
            "Webhook delivery to %s failed for run %s",
            hook.url, payload.get("run_id"), exc_info=True,
        )
