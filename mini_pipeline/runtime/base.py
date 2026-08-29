"""Shared process execution engine for all runtimes.

Every runtime (shell/python/node/executable) resolves a command and hands it
to :class:`ProcessRunner`, which owns the whole process lifecycle:

* spawn with an isolated process group (POSIX) / process tree (Windows);
* pump stdout (stderr merged) line by line into the caller's log stream;
* enforce the wall-clock deadline;
* support cooperative cancellation via a ``threading.Event``;
* terminate the whole process tree on POSIX (``killpg``) and Windows
  (``taskkill /T``) so child processes cannot outlive the task.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from queue import Empty, Queue

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult

_POLL_INTERVAL = 0.1


def terminate_process_tree(process: subprocess.Popen) -> None:
    """Terminate a process and all of its children, cross-platform."""
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, 15)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, 9)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


class ProcessRunner:
    """Runs one external process to completion with log streaming."""

    def run(self, command: list[str], request: RuntimeRequest) -> RuntimeResult:
        environment = os.environ.copy()
        environment.update(request.environment)
        popen_kwargs: dict = {}
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True
        try:
            process = subprocess.Popen(
                command,
                cwd=request.cwd,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                **popen_kwargs,
            )
        except OSError as exc:
            return RuntimeResult(exit_code=-1, error=str(exc))

        output: Queue = Queue()
        sentinel = object()

        def read_output() -> None:
            assert process.stdout is not None
            try:
                for line in iter(process.stdout.readline, ""):
                    output.put(line)
            finally:
                output.put(sentinel)
                process.stdout.close()

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()

        timed_out = False
        cancelled = False
        finished_reading = False
        deadline = time.monotonic() + request.timeout_seconds
        try:
            while not finished_reading:
                if cancel_event := request.cancel_event:
                    if cancel_event.is_set():
                        cancelled = True
                        terminate_process_tree(process)
                if not cancelled and time.monotonic() >= deadline and not timed_out:
                    timed_out = True
                    terminate_process_tree(process)
                try:
                    item = output.get(timeout=_POLL_INTERVAL)
                except Empty:
                    continue
                if item is sentinel:
                    finished_reading = True
                else:
                    request.log_stream.write(item)
                    request.log_stream.flush()
            try:
                exit_code: int | None = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                terminate_process_tree(process)
                exit_code = process.wait(timeout=5)
        finally:
            if process.poll() is None:
                terminate_process_tree(process)
            reader.join(timeout=2)

        if cancelled:
            return RuntimeResult(
                exit_code=exit_code if exit_code is not None else -1,
                cancelled=True,
                error="Cancelled",
            )
        if timed_out:
            return RuntimeResult(
                exit_code=exit_code if exit_code is not None else -1,
                timed_out=True,
                error="Execution timed out",
            )
        return RuntimeResult(exit_code=exit_code if exit_code is not None else -1)
