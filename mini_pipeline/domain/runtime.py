"""Protocols shared by runtime implementations."""

import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol, TextIO


@dataclass(frozen=True)
class RuntimeRequest:
    command: Sequence[str]
    cwd: Path
    environment: Mapping[str, str]
    timeout_seconds: int
    log_stream: TextIO
    cancel_event: Optional[threading.Event] = None


@dataclass(frozen=True)
class RuntimeResult:
    exit_code: int
    timed_out: bool = False
    cancelled: bool = False
    error: Optional[str] = None


class Runtime(Protocol):
    runtime_type: str

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        """Execute one plugin invocation and return its process result."""
