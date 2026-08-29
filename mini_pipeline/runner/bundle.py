"""Server-side task bundle construction for remote runners.

When a runner claims a task it downloads a self-contained ZIP: the plugin
directory plus a fully resolved v2 workspace (``input/`` tree, ``input.json``,
``context.json``). The runner extracts it as the workspace root, executes the
plugin, and streams logs / artifacts / status back over the runner API.
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path
from typing import Any

from mini_pipeline.database.models import PluginVersion, TaskRun
from mini_pipeline.executor.context import (
    create_workspace,
    resolve_inputs,
    write_context,
    write_legacy_input_json,
)
from mini_pipeline.plugin.manifest import load_manifest


def build_task_bundle(
    *,
    task: TaskRun,
    plugin: PluginVersion,
    resolved_params: dict[str, Any],
    dependencies: dict[str, Any],
    uploads: dict[str, Path] | None,
    temp_root: Path,
    run_id: str,
    run_params: dict[str, Any] | None = None,
) -> Path:
    """Create (or reuse) the bundle ZIP for one remote task. Returns its path."""
    bundle_dir = Path(temp_root) / "bundles"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = bundle_dir / f"{task.id}.zip"
    if bundle_path.is_file():
        return bundle_path

    staging = bundle_dir / f"{task.id}.stage"
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)

    # Plugin content at the workspace root (same layout as local execution).
    shutil.copytree(plugin.install_path, staging, dirs_exist_ok=True)
    create_workspace(staging)
    write_context(staging, pipeline_id=run_id, task_id=task.id, task_name=task.step_name)
    manifest = load_manifest(Path(plugin.install_path))
    resolve_inputs(
        staging,
        manifest.contract,
        params=resolved_params,
        dependencies=dependencies,
        uploads=uploads,
    )
    write_legacy_input_json(
        staging,
        task_id=task.id,
        params={**(run_params or {}), **resolved_params},
        dependencies=dependencies,
    )

    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(staging).as_posix())

    shutil.rmtree(staging, ignore_errors=True)
    return bundle_path
