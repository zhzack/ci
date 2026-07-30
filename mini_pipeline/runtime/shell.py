"""Local shell process runtime."""

import os
import subprocess
import time
from queue import Empty, Queue
from threading import Thread

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult


class ShellRuntime:
    runtime_type = "shell"

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        environment = os.environ.copy()
        environment.update(request.environment)
        try:
            process = subprocess.Popen(
                list(request.command),
                cwd=request.cwd,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                start_new_session=True,
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

        reader = Thread(target=read_output, daemon=True)
        reader.start()
        timed_out = False
        finished_reading = False
        deadline = time.monotonic() + request.timeout_seconds
        try:
            while not finished_reading:
                if time.monotonic() >= deadline and not timed_out:
                    timed_out = True
                    self._terminate_process_group(process)
                try:
                    item = output.get(timeout=0.1)
                except Empty:
                    continue
                if item is sentinel:
                    finished_reading = True
                else:
                    request.log_stream.write(item)
                    request.log_stream.flush()
            exit_code = process.wait(timeout=5)
        finally:
            if process.poll() is None:
                self._terminate_process_group(process)
            reader.join(timeout=1)

        if timed_out:
            return RuntimeResult(exit_code=exit_code, timed_out=True, error="Execution timed out")
        return RuntimeResult(exit_code=exit_code)

    @staticmethod
    def _terminate_process_group(process: subprocess.Popen) -> None:
        try:
            os.killpg(process.pid, 15)
            process.wait(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, 9)
            except ProcessLookupError:
                pass
