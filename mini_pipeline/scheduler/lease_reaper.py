"""Background lease reaper for remote tasks.

A runner claims a task and must heartbeat (renewing the lease) while it
executes. If a runner dies or loses connectivity, the lease expires; this
reaper marks such tasks FAILED so their runs do not hang forever.
"""

from __future__ import annotations

import logging
import threading

from mini_pipeline.database.models import utcnow

logger = logging.getLogger(__name__)


class LeaseReaper:
    def __init__(self, *, runs_repository, interval_seconds: float = 15.0) -> None:
        self._runs = runs_repository
        self._interval = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._loop, name="lease-reaper", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self.reap_once()
            except Exception:
                logger.exception("Lease reaper pass failed")

    def reap_once(self) -> int:
        cutoff = utcnow()
        reaped = self._runs.fail_expired_leases(
            cutoff=cutoff,
            message="Runner lost: task lease expired without a heartbeat",
        )
        if reaped:
            logger.warning("Reaped %d remote task(s) with expired leases", reaped)
        return reaped
