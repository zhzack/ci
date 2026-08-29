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


def _find_windows_bash() -> str | None:
    """Find a functional bash interpreter on Windows (preferring Git Bash)."""
    import os

    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    program_files_x86 = Path(
        os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    )
    local_appdata = Path(os.environ.get("LOCALAPPDATA", ""))
    candidates = [
        program_files / "Git" / "bin" / "bash.exe",
        program_files / "Git" / "usr" / "bin" / "bash.exe",
        program_files_x86 / "Git" / "bin" / "bash.exe",
        local_appdata / "Programs" / "Git" / "bin" / "bash.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)

    git = shutil.which("git")
    if git:
        git_dir = Path(git).resolve().parents[1]
        for rel in ("bin/bash.exe", "usr/bin/bash.exe"):
            c = git_dir / rel
            if c.is_file():
                return str(c)

    found = shutil.which("bash")
    if found and "system32" not in found.lower():
        return found
    return None


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
            bash = _find_windows_bash()
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
        resolved = _find_windows_bash() if interpreter == "bash" else shutil.which(interpreter)
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
