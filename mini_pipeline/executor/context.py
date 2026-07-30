"""v2 Workspace context generation.

Create the standard workspace directory layout and write context.json
before the plugin executes. The Executor then resolves each input
resource into its declared location.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from mini_pipeline.domain.contract import (
    InputResource,
    PluginContract,
    ResourceSource,
)


def create_workspace(root: Path) -> dict[str, Path]:
    """Create the v2 standard workspace layout and return the directory map."""
    dirs = {
        "input": root / "input",
        "output": root / "output",
        "temp": root / "temp",
        "cache": root / "cache",
        "logs": root / "logs",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


def write_context(
    workspace: Path,
    *,
    pipeline_id: str,
    task_id: str,
    task_name: str,
) -> Path:
    """Write context.json to the workspace root."""
    payload: dict[str, Any] = {
        "pipeline": {"id": pipeline_id},
        "task": {"id": task_id, "name": task_name},
        "workspace": str(workspace.resolve()),
    }
    path = workspace / "context.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def resolve_inputs(
    workspace: Path,
    contract: PluginContract,
    *,
    params: dict[str, Any],
    dependencies: dict[str, Any],
    uploads: dict[str, Path] | None = None,
) -> dict[str, Any]:
    """Copy / write every declared input to its target location.

    Returns a dict mapping input name → resolved value (for parameter /
    number / boolean / json types) or → target path (for file / directory types).
    """
    dirs = create_workspace(workspace)
    resolved: dict[str, Any] = {}
    uploads = uploads or {}

    for resource in contract.inputs:
        source = resource.source
        target = dirs["input"] / resource.target
        target.parent.mkdir(parents=True, exist_ok=True)

        if source == ResourceSource.PARAMETER:
            value = params.get(resource.name, resource.default)
            if resource.type in ("string", "list", "json"):
                if isinstance(value, str):
                    target.write_text(value, encoding="utf-8")
                elif isinstance(value, (list, dict)):
                    target.write_text(
                        json.dumps(value, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                resolved[resource.name] = value
            elif resource.type in ("number", "boolean"):
                try:
                    resolved[resource.name] = float(value) if resource.type == "number" else bool(value)
                except (ValueError, TypeError):
                    resolved[resource.name] = resource.default
            else:
                # file / directory → no type-level resolution, just note
                resolved[resource.name] = str(target)
        elif source == ResourceSource.UPLOAD:
            src = uploads.get(resource.name)
            if src is not None and src.exists():
                if src.is_dir():
                    shutil.copytree(src, target, dirs_exist_ok=True)
                else:
                    shutil.copy2(src, target)
            resolved[resource.name] = str(target)
        elif source == ResourceSource.URL:
            # URL resources are downloaded by the caller before create_workspace.
            # Here we only record the target for the plugin to consume.
            resolved[resource.name] = str(target)
        elif source == ResourceSource.ARTIFACT:
            # Copy from upstream step's artifact.
            from_ref = resource.from_
            if from_ref and "." in from_ref:
                dep_name, output_name = from_ref.split(".", 1)
                dep_data = dependencies.get(dep_name, {})
                artifacts = dep_data.get("artifacts", [])
                match = next(
                    (a for a in artifacts if a.get("name") == output_name), None
                )
                if match and Path(match["path"]).exists():
                    shutil.copy2(match["path"], target)
            resolved[resource.name] = str(target)
        elif source == ResourceSource.GENERATED:
            generated = {
                "task_id": params.get("_task_id", ""),
                "workspace": str(workspace.resolve()),
            }
            resolved[resource.name] = generated.get(resource.name, "")
            target.write_text(
                json.dumps(resolved[resource.name], ensure_ascii=False),
                encoding="utf-8",
            )
        else:
            resolved[resource.name] = params.get(resource.name, resource.default)

    # Also write a legacy params.json for backward compat with v1 scripts
    params_path = workspace / "params.json"
    params_path.write_text(
        json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return resolved
