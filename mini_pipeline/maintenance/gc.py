"""Retention garbage collection for workspaces, logs, artifacts, and temp.

Run it periodically (cron / task scheduler)::

    mini-pipeline-gc                      # apply retention from config
    mini-pipeline-gc --dry-run --verbose  # preview what would be removed

Retention windows come from the ``retention`` section of the YAML config.
Artifacts are removed on disk *and* deleted from the database so the
artifact catalog stays truthful. Terminal runs only — active runs are
never touched.
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
import time
from pathlib import Path

from mini_pipeline.core.config import RetentionConfig, load_settings
from mini_pipeline.core.container import Services
from mini_pipeline.domain.states import TERMINAL_RUN_STATUSES

logger = logging.getLogger("mini_pipeline.gc")


def _age_seconds(path: Path, now: float) -> float:
    try:
        return now - path.stat().st_mtime
    except OSError:
        return 0.0


def _remove(path: Path, dry_run: bool) -> int:
    """Remove a file or directory; returns the number of bytes reclaimed."""
    try:
        if path.is_dir():
            size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        elif path.is_file():
            size = path.stat().st_size
        else:
            return 0
    except OSError:
        return 0
    if not dry_run:
        try:
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            else:
                path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Failed to remove %s: %s", path, exc)
            return 0
    return size


def _task_dirs(storage_root: Path, run_id: str) -> dict[str, Path]:
    return {
        "workspace": storage_root / "workspaces" / run_id,
        "logs": storage_root / "logs" / run_id,
        "artifacts": storage_root / "artifacts" / run_id,
    }


def collect(
    services: Services,
    *,
    dry_run: bool = False,
    now: float | None = None,
) -> dict[str, int]:
    """Apply the retention policy; returns a summary of reclaimed space."""
    settings = services.settings
    retention: RetentionConfig = settings.retention
    storage_root = Path(settings.storage.root)
    now = now if now is not None else time.time()

    summary = {"runs": 0, "artifacts": 0, "bytes": 0}

    repository = services.run_repository
    terminal = {s.value for s in TERMINAL_RUN_STATUSES}
    deadlines = {
        "workspace": retention.workspaces_days * 86400,
        "logs": retention.logs_days * 86400,
        "artifacts": retention.artifacts_days * 86400,
    }

    offset = 0
    batch = 200
    while True:
        runs = repository.list_runs(offset=offset, limit=batch)
        if not runs:
            break
        offset += batch
        for run in runs:
            if run.status not in terminal or run.finished_at is None:
                continue
            age = now - run.finished_at.timestamp()
            per_kind = {
                kind: deadline > 0 and age > deadline
                for kind, deadline in deadlines.items()
            }
            dirs = _task_dirs(storage_root, run.id)
            removed_any = False
            for kind, remove_it in per_kind.items():
                if not remove_it:
                    continue
                path = dirs[kind]
                if not path.exists():
                    continue
                summary["bytes"] += _remove(path, dry_run)
                removed_any = True
            if removed_any:
                summary["runs"] += 1
            # Artifact DB rows follow the artifact window.
            if deadlines["artifacts"] > 0 and age > deadlines["artifacts"]:
                artifacts = services.run_repository.list_artifacts(
                    run_id=run.id, offset=0, limit=10000
                )
                for artifact in artifacts:
                    if not dry_run:
                        services.run_repository.delete_artifact(artifact.id)
                    summary["artifacts"] += 1
        if len(runs) < batch:
            break

    # Stray temp files
    temp_hours = retention.temp_hours * 3600
    temp_dir = storage_root / "tmp"
    if temp_hours > 0 and temp_dir.is_dir():
        for entry in temp_dir.iterdir():
            if _age_seconds(entry, now) > temp_hours:
                summary["bytes"] += _remove(entry, dry_run)

    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mini Pipeline retention GC")
    parser.add_argument("--config", default=None, help="Path to the YAML config")
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
    )
    settings = load_settings(Path(args.config) if args.config else None)
    services = Services.build(settings)
    try:
        summary = collect(services, dry_run=args.dry_run)
    finally:
        services.close()

    scope = "Would reclaim" if args.dry_run else "Reclaimed"
    logger.info(
        "%s %.1f MB across %d run(s), %d artifact record(s)%s",
        scope,
        summary["bytes"] / 1e6,
        summary["runs"],
        summary["artifacts"],
        " (dry run)" if args.dry_run else "",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
