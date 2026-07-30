"""Service helpers for run nodes: addressable, reusable execution units."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from mini_pipeline.database.models import RunNode
from mini_pipeline.database.repositories import RunNodeRepository


def _serialize_for_hash(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str, ensure_ascii=False)


def hash_resolved(
    *,
    pipeline_definition_id: str,
    step_name: str,
    plugin_name: str,
    plugin_version: str,
    resolved_params: dict[str, Any],
    inputs_snapshot: dict[str, Any],
) -> str:
    """Stable content hash for matching equivalent executions."""
    payload = {
        "pipeline": pipeline_definition_id,
        "step": step_name,
        "plugin": f"{plugin_name}@{plugin_version}",
        "params": resolved_params,
        "inputs": inputs_snapshot,
    }
    return hashlib.sha256(_serialize_for_hash(payload).encode("utf-8")).hexdigest()


def find_or_create_node(
    repository: RunNodeRepository,
    *,
    pipeline_definition_id: str,
    step_name: str,
    plugin_name: str,
    plugin_version: str,
    resolved_params: dict[str, Any],
    inputs_snapshot: dict[str, Any],
) -> tuple[RunNode, bool]:
    """Return (node, created). Reuses an existing node when its hash matches."""
    digest = hash_resolved(
        pipeline_definition_id=pipeline_definition_id,
        step_name=step_name,
        plugin_name=plugin_name,
        plugin_version=plugin_version,
        resolved_params=resolved_params,
        inputs_snapshot=inputs_snapshot,
    )
    existing = repository.find_by_hash(digest)
    if existing is not None:
        return existing, False
    node = repository.create(
        pipeline_definition_id=pipeline_definition_id,
        step_name=step_name,
        plugin_name=plugin_name,
        plugin_version=plugin_version,
        hash_value=digest,
        resolved_params=resolved_params,
        inputs_snapshot=inputs_snapshot,
    )
    return node, True
