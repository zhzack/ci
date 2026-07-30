"""Plugin manifest schema and validation."""

import re
from pathlib import Path, PurePosixPath
from typing import Any, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.domain.exceptions import ValidationError

_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_VERSION_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


class ValueSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "string"
    required: bool = False
    description: str = ""
    default: Optional[Any] = None


class RuntimeSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str

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
    model_config = ConfigDict(extra="forbid")

    name: str
    version: str
    description: str = ""
    runtime: RuntimeSpec
    entry: str
    inputs: dict[str, ValueSpec] = Field(default_factory=dict)
    outputs: dict[str, ValueSpec] = Field(default_factory=dict)

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

    @field_validator("entry")
    @classmethod
    def validate_entry(cls, value: str) -> str:
        path = PurePosixPath(value)
        if not value or path.is_absolute() or ".." in path.parts:
            raise ValueError("must be a relative path contained by the plugin directory")
        return value


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
    try:
        manifest = PluginManifest.model_validate(raw)
    except PydanticValidationError as exc:
        raise ValidationError(f"Invalid plugin manifest: {exc}") from exc

    root = plugin_directory.resolve()
    entry = (root / manifest.entry).resolve()
    if not entry.is_relative_to(root) or not entry.is_file():
        raise ValidationError(f"Plugin entry does not exist inside the plugin: {manifest.entry}")
    return manifest
