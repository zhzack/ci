"""v2 Plugin Manifest loader.

The v2 plugin.yaml supports the new contract-based format with
typed inputs (Resource) and glob-based output declarations.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.domain.contract import PluginManifestV2
from mini_pipeline.domain.exceptions import ValidationError

_NAME_CHARS = "A-Za-z0-9_.-/:"
_SEMVER_RE = r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"


def load_manifest_v2(plugin_directory: Path) -> PluginManifestV2:
    """Load and validate the v2 plugin manifest.

    Falls back to v1 format if the file contains `inputs:` / `outputs:` at
    the top level (without a `contract:` section).
    """
    manifest_path = plugin_directory / "plugin.yaml"
    try:
        content = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ValidationError(
            "Plugin archive does not contain plugin.yaml"
        ) from exc
    try:
        raw = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValidationError(f"Invalid plugin.yaml: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValidationError("plugin.yaml root must be a mapping")

    # Auto-detect: v1 format (inputs/outputs at top level) → upgrade to v2
    if "contract" not in raw:
        raw = _upgrade_v1_to_v2(raw)

    try:
        return PluginManifestV2.model_validate(raw)
    except PydanticValidationError as exc:
        raise ValidationError(f"Invalid v2 plugin manifest: {exc}") from exc


def _upgrade_v1_to_v2(raw: dict) -> dict:
    """Convert a v1 plugin.yaml (top-level inputs/outputs) to v2 contract format."""
    inputs = []
    for name, spec in (raw.pop("inputs", None) or {}).items():
        inputs.append(
            {
                "name": name,
                "type": spec.get("type", "string"),
                "source": "parameter",
                "required": spec.get("required", False),
                "default": spec.get("default"),
                "description": spec.get("description", ""),
                "target": name,
            }
        )
    outputs = []
    for name, spec in (raw.pop("outputs", None) or {}).items():
        outputs.append(
            {
                "name": name,
                "type": spec.get("type", "file"),
                "path": f"output/{name}",
            }
        )
    contract = {"inputs": inputs, "outputs": outputs}
    raw["contract"] = contract
    return raw
