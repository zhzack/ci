"""Separate thread pools for run coordination and task execution."""

from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from typing import Any, Callable


class Dispatcher:
    def __init__(self, *, coordinator_workers: int, task_workers: int) -> None:
        self._coordinators = ThreadPoolExecutor(
            max_workers=coordinator_workers,
            thread_name_prefix="pipeline-run",
        )
        self._tasks = ThreadPoolExecutor(
            max_workers=task_workers,
            thread_name_prefix="pipeline-task",
        )
        self._lock = Lock()
        self._accepting = True

    def submit_run(
        self,
        function: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> Future:
        with self._lock:
            if not self._accepting:
                raise RuntimeError("Dispatcher is shutting down")
            return self._coordinators.submit(function, *args, **kwargs)

    def submit_task(
        self,
        function: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> Future:
        with self._lock:
            if not self._accepting:
                raise RuntimeError("Dispatcher is shutting down")
            return self._tasks.submit(function, *args, **kwargs)

    def close(self) -> None:
        with self._lock:
            self._accepting = False
        self._coordinators.shutdown(wait=True, cancel_futures=True)
        self._tasks.shutdown(wait=True, cancel_futures=True)
