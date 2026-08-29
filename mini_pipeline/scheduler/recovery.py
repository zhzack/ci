"""Crash recovery for runs orphaned by a process restart."""

from __future__ import annotations

import logging

from mini_pipeline.database.repositories import RunRepository

logger = logging.getLogger(__name__)

_ORPHAN_MESSAGE = (
    "Interrupted: the service restarted while this run was in progress"
)


def reap_orphan_runs(repository: RunRepository) -> int:
    """Mark runs stuck in PENDING/RUNNING as FAILED. Returns count reaped."""
    try:
        return repository.reap_orphan_runs(message=_ORPHAN_MESSAGE)
    except Exception:
        logger.exception("Failed to reap orphaned runs")
        return 0
