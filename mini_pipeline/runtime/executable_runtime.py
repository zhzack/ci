"""Native executable runtime: runs a compiled binary directly."""

from __future__ import annotations

import os

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.runtime.base import ProcessRunner


class ExecutableRuntime:
    runtime_type = "executable"

    def __init__(self) -> None:
        self._runner = ProcessRunner()

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        entry = request.command[0]
        if not os.access(entry, os.X_OK):
            return RuntimeResult(exit_code=-1, error=f"Entry is not executable: {entry}")
        return self._runner.run([entry], request)
