"""Node.js runtime: executes a .js file as a plugin."""

from __future__ import annotations

import shutil

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.runtime.base import ProcessRunner


class NodeRuntime:
    runtime_type = "node"

    def __init__(self) -> None:
        self._runner = ProcessRunner()

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        node = shutil.which("node")
        if node is None:
            return RuntimeResult(exit_code=-1, error="Node.js executable not found")
        command = [node, str(request.command[0])]
        return self._runner.run(command, request)
