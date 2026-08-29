"""State values persisted by the pipeline engine."""

from enum import Enum


class PluginStatus(str, Enum):
    INSTALLING = "INSTALLING"
    READY = "READY"
    FAILED = "FAILED"


class PipelineStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    QUEUED = "QUEUED"  # assigned to a remote machine, not yet claimed
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


TERMINAL_TASK_STATUSES = {
    TaskStatus.SUCCESS,
    TaskStatus.FAILED,
    TaskStatus.SKIPPED,
    TaskStatus.CANCELLED,
}
TERMINAL_RUN_STATUSES = {
    PipelineStatus.SUCCESS,
    PipelineStatus.FAILED,
    PipelineStatus.CANCELLED,
}
