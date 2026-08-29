"""Centralised logging configuration.

Provides two output formats selected by configuration:

* ``text`` — human-friendly console output for local development;
* ``json`` — one JSON object per line (request id, logger, level, message)
  so log collectors (Loki, ELK, Datadog) can index the stream without
  parsing heuristics.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from mini_pipeline.core.config import LoggingConfig
from mini_pipeline.server.middleware import request_id_var

_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename",
    "funcName", "levelname", "levelno", "lineno", "module", "msecs",
    "message", "msg", "name", "pathname", "process", "processName",
    "relativeCreated", "stack_info", "thread", "threadName", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get("-"),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )


def configure_logging(config: LoggingConfig) -> None:
    level = getattr(logging, config.level.upper(), logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    if config.format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(TextFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler]

    # Access logs stay one level quieter than the configured floor unless
    # explicitly asked for, keeping INFO consoles readable.
    logging.getLogger("mini_pipeline.access").setLevel(
        max(level, logging.INFO) if config.format == "text" else level
    )
    for noisy in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logging.getLogger(noisy).handlers = []
        logging.getLogger(noisy).propagate = True
