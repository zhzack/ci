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
    packages_dir: Path | None = None,
    package_storage: Any | None = None,
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
        rel_target = resource.target or resource.name or "resource"
        target = dirs["input"] / rel_target
        if target.exists() and target.is_dir():
            # A leftover dir from a previous plugin copy; remove so we can
            # write the file. This guards against plugins that ship a
            # sample input/ tree inside their bundle.
            shutil.rmtree(target, ignore_errors=True)
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
                else:
                    # Number/boolean passed but resource declared as string —
                    # stringify so shell `cat input/<key>` works.
                    target.write_text(str(value), encoding="utf-8")
                resolved[resource.name] = value
            elif resource.type in ("number", "integer", "boolean"):
                # Also persist as a text file so plugins can `cat input/<key>`
                try:
                    resolved[resource.name] = float(value) if resource.type == "number" else (
                        int(value) if resource.type == "integer" else bool(value)
                    )
                except (ValueError, TypeError):
                    resolved[resource.name] = resource.default
                target.write_text(str(value), encoding="utf-8")
            else:
                # file / directory → no type-level resolution, just note
                resolved[resource.name] = str(target)
        elif source == ResourceSource.UPLOAD:
            # Try exact match first, then fall back to any available upload.
            src = uploads.get(resource.name)
            if src is None or not src.exists():
                # Fall back: the uploader may have sent the file with a
                # different field name or filename. Take the first upload
                # that exists or the one matching the target name.
                for _name, _path in uploads.items():
                    if _path.exists():
                        src = _path
                        break
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
                dep_entry = dependencies.get(dep_name) if isinstance(dependencies, dict) else None
                if dep_entry is None and hasattr(dependencies, dep_name):
                    dep_entry = getattr(dependencies, dep_name)
                artifacts: list[Any] = []
                if dep_entry is not None:
                    if isinstance(dep_entry, dict):
                        artifacts = dep_entry.get("artifacts", []) or []
                    else:
                        artifacts = getattr(dep_entry, "artifacts", []) or []
                match = next(
                    (a for a in artifacts if (
                        (isinstance(a, dict) and a.get("name") == output_name)
                        or (hasattr(a, "name") and a.name == output_name)
                    )),
                    None,
                )
                if match is not None:
                    src_path = (
                        match.get("path")
                        if isinstance(match, dict)
                        else getattr(match, "path", None)
                    )
                    if src_path and Path(str(src_path)).exists():
                        shutil.copy2(str(src_path), target)
            resolved[resource.name] = str(target)
        elif source == ResourceSource.PACKAGE:
            pkg_path = params.get(resource.name) or resource.from_ or resource.default
            if pkg_path:
                clean_pkg = str(pkg_path).strip().replace("\\", "/").strip("/")
                if package_storage is not None:
                    try:
                        stream, _, _, _ = package_storage.get_file(clean_pkg)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with target.open("wb") as out:
                            shutil.copyfileobj(stream, out)
                    except Exception:
                        pass
                elif packages_dir is not None:
                    src = (packages_dir / clean_pkg).resolve()
                    if src.exists() and src.is_relative_to(packages_dir.resolve()):
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if src.is_dir():
                            shutil.copytree(src, target, dirs_exist_ok=True)
                        else:
                            shutil.copy2(src, target)
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


def write_legacy_input_json(
    workspace: Path,
    *,
    task_id: str,
    params: dict[str, Any],
    dependencies: dict[str, Any],
) -> Path:
    """Write the v1-protocol ``input.json`` at the workspace root.

    v1 plugins read a single JSON payload ``{task_id, workspace, params,
    dependencies}`` instead of the v2 ``input/`` directory tree. Writing
    both keeps every historical plugin working on the v2 executor.
    """
    payload = {
        "task_id": task_id,
        "workspace": str(workspace.resolve()),
        "params": params,
        "dependencies": {
            name: entry.model_dump() if hasattr(entry, "model_dump") else entry
            for name, entry in (dependencies or {}).items()
        },
    }
    path = workspace / "input.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path
