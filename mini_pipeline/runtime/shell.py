"""Local shell process runtime."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult
from mini_pipeline.runtime.base import ProcessRunner

_SHEBANG_INTERPRETERS = {
    "sh": "bash",
    "bash": "bash",
    "dash": "bash",
    "zsh": "bash",
    "ksh": "bash",
}


def resolve_shell_command(entry: Path) -> list[str] | None:
    """Resolve how to launch a shell script on the current platform.

    On POSIX the kernel honours the shebang, so the script is executed
    directly. On Windows a script is not a valid Win32 executable: we parse
    the shebang and dispatch to an interpreter found on PATH (Git Bash's
    ``bash`` covers the common ``#!/bin/sh`` / ``#!/usr/bin/env bash`` cases).
    Returns ``None`` when no resolution is possible.
    """
    if sys.platform != "win32":
        return [str(entry)]
    try:
        first_line = entry.open("r", encoding="utf-8", errors="replace").readline()
    except OSError:
        first_line = ""
    if not first_line.startswith("#!"):
        if entry.suffix.lower() in {".sh", ".bash"}:
            bash = shutil.which("bash")
            return [bash, str(entry)] if bash else None
        return [str(entry)]
    tokens = first_line[2:].strip().split()
    if not tokens:
        return [str(entry)]
    if tokens[0].endswith("env") and len(tokens) > 1:
        tokens = tokens[1:]
    program = Path(tokens[0]).name
    interpreter = _SHEBANG_INTERPRETERS.get(program)
    if interpreter:
        resolved = shutil.which(interpreter)
        return [resolved, str(entry)] if resolved else None
    resolved = shutil.which(program)
    if resolved:
        return [resolved, str(entry)]
    return [str(entry)]


class ShellRuntime:
    runtime_type = "shell"

    def __init__(self) -> None:
        self._runner = ProcessRunner()

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        entry = Path(request.command[0])
        command = resolve_shell_command(entry)
        if command is None:
            return RuntimeResult(
                exit_code=-1,
                error="No shell interpreter found to execute the plugin entry",
            )
        return self._runner.run(command, request)
