"""Python runtime: executes a .py file as a plugin."""

from __future__ import annotations

import shutil
import sys

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.runtime.base import ProcessRunner


class PythonRuntime:
    runtime_type = "python"

    def __init__(self) -> None:
        self._runner = ProcessRunner()

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        interpreter = self._resolve_interpreter()
        command = [interpreter, "-u", str(request.command[0])]
        return self._runner.run(command, request)

    @staticmethod
    def _resolve_interpreter() -> str:
        # On POSIX `python3` is the canonical name. On Windows `python3`
        # usually resolves to the Microsoft Store alias stub (exit code
        # 9009), so prefer `python` there and fall back to the running
        # interpreter.
        if sys.platform == "win32":
            return shutil.which("python") or sys.executable
        return shutil.which("python3") or sys.executable
