"""v2 Output & Artifact collector.

After a plugin finishes, the collector globs the output/ directory
according to the contract's output declarations and produces
Artifact records consumable by downstream steps.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from mini_pipeline.domain.contract import OutputResource, PluginContract, ResourceType

_METADATA_CANDIDATES = (
    "output/metadata.json",
    "output/metadata.yaml",
    "metadata.json",
)


def collect_outputs(
    workspace: Path,
    contract: PluginContract,
    *,
    run_id: str,
    task_id: str,
) -> dict[str, Any]:
    """Glob the workspace output/ directory and produce artifact records.

    Returns:
        dict with keys:
          - outputs: dict[str, Any] — structured outputs for downstream steps
          - artifacts: list[dict] — file artifact records
          - metadata: dict[str, Any] | None — parsed metadata.json if found
    """
    outputs: dict[str, Any] = {}
    artifacts: list[dict[str, Any]] = []
    metadata: dict[str, Any] | None = None

    output_dir = workspace / "output"
    if not output_dir.is_dir():
        return {"outputs": outputs, "artifacts": artifacts, "metadata": metadata}

    # Try metadata
    for candidate in _METADATA_CANDIDATES:
        meta_path = workspace / candidate
        if meta_path.is_file():
            try:
                raw = meta_path.read_text(encoding="utf-8")
                metadata = json.loads(raw) if candidate.endswith(".json") else {"_raw": raw}
            except Exception:
                pass
            break

    # Collect declared outputs
    if contract.outputs:
        for resource in contract.outputs:
            pattern = resource.path.lstrip("/")
            matched = list(output_dir.glob(pattern))
            for path in matched:
                if path.is_file():
                    artifact = _store_artifact(
                        workspace, path, resource.name, run_id=run_id, task_id=task_id
                    )
                    if artifact:
                        artifacts.append(artifact)
                        if resource.type == ResourceType.FILE:
                            outputs[resource.name] = str(path.relative_to(workspace))
                elif path.is_dir():
                    for sub in path.rglob("*"):
                        if sub.is_file():
                            entry_name = f"{resource.name}/{sub.relative_to(path)}"
                            artifact = _store_artifact(
                                workspace, sub, entry_name, run_id=run_id, task_id=task_id
                            )
                            if artifact:
                                artifacts.append(artifact)
    else:
        # No contract: glob everything under output/
        for path in output_dir.rglob("*"):
            if path.is_file():
                entry_name = str(path.relative_to(output_dir))
                artifact = _store_artifact(
                    workspace, path, entry_name, run_id=run_id, task_id=task_id
                )
                if artifact:
                    artifacts.append(artifact)

    return {"outputs": outputs, "artifacts": artifacts, "metadata": metadata}


def _store_artifact(
    workspace: Path,
    source: Path,
    name: str,
    *,
    run_id: str,
    task_id: str,
) -> dict[str, Any] | None:
    """Copy one file to the managed artifact store and return its record."""
    artifact_id = str(uuid.uuid4())
    dest_dir = Path("data/artifacts") / run_id / task_id / artifact_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "content"

    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as inf, dest.open("wb") as outf:
        while True:
            chunk = inf.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
            outf.write(chunk)
    return {
        "id": artifact_id,
        "name": name,
        "size": size,
        "sha256": digest.hexdigest(),
        "storage_path": str(dest.resolve()),
    }


def read_error_json(workspace: Path) -> dict[str, Any] | None:
    """Read error.json if the plugin wrote one."""
    path = workspace / "error.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"code": "UNKNOWN", "message": path.read_text(encoding="utf-8", errors="replace")}
