"""Thread-level concurrency tests for the scheduling layer.

These cover the races that API-level end-to-end tests never exercise:
multiple runner agents claiming the same QUEUED task, the LeaseReaper
background thread reaping expired leases on its own, and the EventBus
fan-out under concurrent publishers.
"""

from __future__ import annotations

import threading
import time
from datetime import timedelta

from mini_pipeline.core.events import EventBus, RunEvent
from mini_pipeline.database.models import (
    Machine,
    PipelineDefinition,
    Plugin,
    PluginVersion,
    TaskRun,
    utcnow,
)
from mini_pipeline.domain.states import TaskStatus
from mini_pipeline.scheduler.lease_reaper import LeaseReaper


def _seed_plugin_and_pipeline(services, name: str = "echo") -> str:
    """Insert one plugin version + pipeline definition row; returns pipeline id."""
    with services.database.session() as session:
        plugin = Plugin(name=name)
        session.add(plugin)
        session.flush()
        session.add(
            PluginVersion(
                plugin_id=plugin.id,
                name=name,
                version="1.0.0",
                source_type="upload",
                install_path="/nonexistent",
                runtime_type="shell",
                entry="run.sh",
            )
        )
        pipeline = PipelineDefinition(name="race-demo", definition="steps: []")
        session.add(pipeline)
        session.flush()
        return pipeline.id


def _seed_machine(services, name: str = "race-box") -> str:
    with services.database.session() as session:
        machine = Machine(name=name, token_hash=f"hash-{name}")
        session.add(machine)
        session.flush()
        return machine.id


def _queued_task(services, pipeline_id: str, machine_id: str):
    run = services.run_repository.create(
        pipeline_id=pipeline_id,
        pipeline_name="race-demo",
        params={},
        tasks=[("go", "echo", "1.0.0")],
        machine_id=machine_id,
    )
    task = run.tasks[0]
    services.run_repository.set_task_state(task.id, TaskStatus.QUEUED)
    return task


def test_concurrent_claim_single_winner(client) -> None:
    """Eight runner threads race for one QUEUED task; exactly one wins."""
    services = client.app.state.services
    pipeline_id = _seed_plugin_and_pipeline(services)
    machine_id = _seed_machine(services)
    task = _queued_task(services, pipeline_id, machine_id)

    threads = 8
    barrier = threading.Barrier(threads)
    results: list[bool] = []
    lock = threading.Lock()

    def claim() -> None:
        barrier.wait()
        won = (
            services.run_repository.claim_next_task(
                machine_id=machine_id, lease_seconds=60
            )
            is not None
        )
        with lock:
            results.append(won)

    workers = [threading.Thread(target=claim) for _ in range(threads)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert sum(results) == 1, f"expected exactly one winner, got {sum(results)}"
    fresh = services.run_repository.get_task_by_id(task.id)
    assert fresh.status == TaskStatus.RUNNING.value
    assert fresh.lease_expires_at is not None


def test_lease_reaper_thread_fails_expired_tasks(client) -> None:
    """A live LeaseReaper reaps expired leases without manual prodding."""
    services = client.app.state.services
    pipeline_id = _seed_plugin_and_pipeline(services)
    machine_id = _seed_machine(services, "reaper-box")
    task = _queued_task(services, pipeline_id, machine_id)

    # Claim (transitions to RUNNING + lease) then age the lease into the past.
    assert services.run_repository.claim_next_task(
        machine_id=machine_id, lease_seconds=60
    ) is not None
    with services.database.session() as session:
        row = session.get(TaskRun, task.id)
        row.lease_expires_at = utcnow() - timedelta(seconds=1)

    reaper = LeaseReaper(runs_repository=services.run_repository, interval_seconds=0.1)
    reaper.start()
    try:
        deadline = time.monotonic() + 5
        status = None
        while time.monotonic() < deadline:
            status = services.run_repository.get_task_by_id(task.id).status
            if status == TaskStatus.FAILED.value:
                break
            time.sleep(0.05)
    finally:
        reaper.stop()

    assert status == TaskStatus.FAILED.value
    fresh = services.run_repository.get_task_by_id(task.id)
    assert "lease expired" in (fresh.message or "").lower()


def test_eventbus_fanout_under_concurrent_publishers() -> None:
    """One subscriber receives every event from concurrent publishers."""
    bus = EventBus()
    subscriber_id, queue = bus.subscribe("run-1")
    publishers = 4
    per_publisher = 25

    def publish(publisher_index: int) -> None:
        for i in range(per_publisher):
            bus.publish(
                RunEvent(
                    run_id="run-1",
                    type="task.status",
                    data={"seq": publisher_index * per_publisher + i},
                    timestamp=time.time(),
                )
            )

    workers = [threading.Thread(target=publish, args=(i,)) for i in range(publishers)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    received = []
    while not queue.empty():
        received.append(queue.get_nowait())
    assert len(received) == publishers * per_publisher
    assert {event.data["seq"] for event in received} == set(
        range(publishers * per_publisher)
    )
    bus.unsubscribe(subscriber_id)

    bus.publish_run_status("run-1", "SUCCESS")
    assert queue.empty()  # unsubscribed: no further delivery


def test_lease_reaper_reap_once_returns_count(client) -> None:
    services = client.app.state.services
    pipeline_id = _seed_plugin_and_pipeline(services)
    machine_id = _seed_machine(services, "reaper-count-box")
    _queued_task(services, pipeline_id, machine_id)

    # Claim (fresh lease, far from expiry) → nothing to reap yet.
    assert services.run_repository.claim_next_task(
        machine_id=machine_id, lease_seconds=3600
    ) is not None
    assert services.run_repository.fail_expired_leases(
        cutoff=utcnow(), message="x"
    ) == 0
