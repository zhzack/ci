"""Plugin manifest schema and validation (v2 unified).

Accepts two formats:
1. v2 native: name, version, runtime (with entry), contract {inputs, outputs}
2. v1 legacy: name, version, runtime, entry (top-level), inputs, outputs
   → auto-upgraded to v2 on load.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.domain.contract import (
    PluginContract,
)
from mini_pipeline.domain.exceptions import ValidationError

_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_VERSION_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


class RuntimeSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    image: str = ""
    entry: str = ""

    @field_validator("type")
    @classmethod
    def validate_runtime(cls, value: str) -> str:
        allowed = {"shell", "python", "node", "executable", "docker"}
        if value not in allowed:
            raise ValueError(
                f"Unsupported runtime type {value!r}. Allowed: {', '.join(sorted(allowed))}"
            )
        return value


class PluginManifest(BaseModel):
    """Unified plugin manifest — v2 native with v1 auto-upgrade."""

    model_config = ConfigDict(extra="allow")

    name: str
    version: str
    description: str = ""
    runtime: RuntimeSpec
    contract: PluginContract = Field(default_factory=PluginContract)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not _NAME_PATTERN.fullmatch(value):
            raise ValueError("must start with a letter and contain only letters, numbers, ._- ")
        return value

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if not _VERSION_PATTERN.fullmatch(value):
            raise ValueError("must be a semantic version such as 1.0.0")
        return value

    @property
    def entry(self) -> str:
        """Return the entry point: runtime.entry if set, else 'run.sh'."""
        return self.runtime.entry or "run.sh"


def load_manifest(plugin_directory: Path) -> PluginManifest:
    manifest_path = plugin_directory / "plugin.yaml"
    try:
        content = manifest_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ValidationError("Plugin archive does not contain plugin.yaml") from exc
    try:
        raw = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValidationError(f"Invalid plugin.yaml: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValidationError("plugin.yaml root must be a mapping")

    # v1 → v2 auto-upgrade
    if "contract" not in raw:
        raw = _upgrade_v1_to_v2(raw)

    # Pull runtime.entry to top-level if needed (v2 convention)
    if isinstance(raw.get("runtime"), dict):
        runtime_entry = raw["runtime"].get("entry")
        if runtime_entry and "entry" not in raw:
            raw["entry"] = runtime_entry

    try:
        manifest = PluginManifest.model_validate(raw)
    except PydanticValidationError as exc:
        raise ValidationError(f"Invalid plugin manifest: {exc}") from exc

    root = plugin_directory.resolve()
    entry_path = (root / manifest.entry).resolve()
    if not entry_path.is_relative_to(root) or not entry_path.is_file():
        raise ValidationError(
            f"Plugin entry does not exist inside the plugin: {manifest.entry}"
        )
    return manifest


def _upgrade_v1_to_v2(raw: dict) -> dict:
    """Convert v1 flat inputs/outputs to v2 contract."""
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
        out_type = spec.get("type", "file")
        outputs.append(
            {
                "name": name,
                "type": out_type,
                "path": f"output/{name}",
            }
        )
    raw["contract"] = {"inputs": inputs, "outputs": outputs}
    # Move entry inside runtime if it's top-level
    if "entry" in raw and isinstance(raw.get("runtime"), dict):
        if not raw["runtime"].get("entry"):
            raw["runtime"]["entry"] = raw.pop("entry")
    return raw


def manifest_from_version(version):
    """Compatibility wrapper: returns PluginManifest from DB version entity."""
    return load_manifest(Path(version.install_path))
