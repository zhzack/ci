"""Native executable runtime: runs a compiled binary directly."""

import os
import subprocess
from queue import Empty, Queue
from threading import Thread

from mini_pipeline.domain.runtime import RuntimeRequest, RuntimeResult


class ExecutableRuntime:
    runtime_type = "executable"

    def execute(self, request: RuntimeRequest) -> RuntimeResult:
        entry = request.command[0]
        if not os.access(entry, os.X_OK):
            return RuntimeResult(exit_code=-1, error=f"Entry is not executable: {entry}")
        return self._run([entry], request)

    @staticmethod
    def _run(cmd: list[str], request: RuntimeRequest) -> RuntimeResult:
        env = os.environ.copy()
        env.update(request.environment)
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=request.cwd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
        except OSError as exc:
            return RuntimeResult(exit_code=-1, error=str(exc))
        output: Queue = Queue()
        sentinel = object()

        def read_output() -> None:
            assert proc.stdout is not None
            for line in iter(proc.stdout.readline, ""):
                output.put(line)
            output.put(sentinel)
            proc.stdout.close()

        reader = Thread(target=read_output, daemon=True)
        reader.start()
        finished = False
        try:
            while not finished:
                item = output.get(timeout=0.1)
                if item is sentinel:
                    finished = True
                else:
                    request.log_stream.write(item)
                    request.log_stream.flush()
            proc.wait(timeout=request.timeout_seconds)
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                proc.kill()
            except Exception:
                pass
            proc.wait(timeout=2)
        except Empty:
            timed_out = True
        finally:
            if proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            reader.join(timeout=1)
        if timed_out:
            return RuntimeResult(exit_code=proc.returncode or -1, timed_out=True, error="Timed out")
        return RuntimeResult(exit_code=proc.returncode or 0)
