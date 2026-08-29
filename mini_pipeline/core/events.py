"""In-process event bus and cancellation registry for the scheduler.

The :class:`EventBus` fans run/task state changes out to SSE subscribers
(:api route ``/api/runs/{id}/events``). Subscribers are plain
``queue.Queue`` objects so producers (worker threads) never block on slow
consumers: events are dropped when a subscriber queue is full.

The :class:`CancellationRegistry` maps a run id to the ``threading.Event``
objects its executing tasks poll. Setting the events makes the runtime
terminate the underlying process trees (see ``runtime/base.py``).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from queue import Full, Queue
from typing import Any

SubscriberQueue = Queue

_SUBSCRIBER_QUEUE_SIZE = 256


@dataclass(frozen=True)
class RunEvent:
    """One state change worth pushing to live clients."""

    run_id: str
    type: str  # "run.status" | "task.status"
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: float = 0.0
    task_id: str | None = None
    step_name: str | None = None

    def to_sse(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "run_id": self.run_id,
            "task_id": self.task_id,
            "step_name": self.step_name,
            "data": self.data,
            "timestamp": self.timestamp,
        }


class EventBus:
    """Thread-safe publish/subscribe hub for run lifecycle events."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[int, SubscriberQueue] = {}
        self._next_id = 0

    def subscribe(self, run_id: str) -> tuple[int, SubscriberQueue]:
        """Register a subscriber; returns (subscriber_id, queue).

        Subscribers receive all events and filter by ``run_id`` themselves.
        """
        queue: SubscriberQueue = Queue(maxsize=_SUBSCRIBER_QUEUE_SIZE)
        with self._lock:
            self._next_id += 1
            subscriber_id = self._next_id
            self._subscribers[subscriber_id] = queue
        return subscriber_id, queue

    def unsubscribe(self, subscriber_id: int) -> None:
        with self._lock:
            self._subscribers.pop(subscriber_id, None)

    def publish(self, event: RunEvent) -> None:
        with self._lock:
            subscribers = list(self._subscribers.items())
        for _subscriber_id, queue in subscribers:
            try:
                queue.put_nowait(event)
            except Full:
                # Slow consumer: drop the event rather than blocking a
                # worker thread. Clients reconcile via the DB snapshot.
                continue

    def publish_run_status(self, run_id: str, status: str, message: str = "") -> None:
        self.publish(
            RunEvent(
                run_id=run_id,
                type="run.status",
                data={"status": status, "message": message},
                timestamp=time.time(),
            )
        )


class CancellationRegistry:
    """Track cancellation events for in-flight runs."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: dict[str, threading.Event] = {}

    def register(self, run_id: str) -> threading.Event:
        event = threading.Event()
        with self._lock:
            self._events[run_id] = event
        return event

    def release(self, run_id: str) -> None:
        with self._lock:
            self._events.pop(run_id, None)

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            event = self._events.get(run_id)
        if event is None:
            return False
        event.set()
        return True

    def is_cancelled(self, run_id: str) -> bool:
        with self._lock:
            event = self._events.get(run_id)
        return bool(event and event.is_set())
