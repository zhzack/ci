"""v2 Pipeline Runtime Protocol: Resource types, sources, and contracts.

The v2 protocol replaces the flat `params` dict with typed Resources.
Each input declares its type (string/number/boolean/file/directory/json/list)
and source (parameter/upload/url/artifact/generated). The Executor resolves
every input and populates the workspace accordingly before execution.
"""

from pathlib import PurePosixPath
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ResourceType(str):
    """The shape of a resource."""

    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    JSON = "json"
    FILE = "file"
    DIRECTORY = "directory"
    LIST = "list"


class ResourceSource(str):
    """Where the resource value comes from."""

    PARAMETER = "parameter"  # user fills in at run-time
    UPLOAD = "upload"  # uploaded at run-time (file)
    URL = "url"  # downloaded by Executor
    ARTIFACT = "artifact"  # copied from upstream step's output
    GENERATED = "generated"  # platform-provided (task_id, workspace, etc.)


# ---------------------------------------------------------------------------
# Input Resource
# ---------------------------------------------------------------------------


class InputResource(BaseModel):
    """A single input declared in the plugin contract."""

    model_config = ConfigDict(extra="forbid")

    name: str
    type: str = ResourceType.STRING
    source: str = ResourceSource.PARAMETER
    target: str = ""  # relative path inside workspace/input/
    default: Optional[Any] = None
    required: bool = False
    description: str = ""
    from_: Optional[str] = Field(
        default=None, alias="from"
    )  # upstream <step>.<output> for source=artifact

    @field_validator("target", mode="before")
    @classmethod
    def _default_target(cls, value: Optional[str], info: Any) -> str:
        if value:
            return str(value)
        name = info.data.get("name", "resource") if isinstance(info.data, dict) else "resource"
        return str(PurePosixPath(name))


# ---------------------------------------------------------------------------
# Output Resource
# ---------------------------------------------------------------------------


class OutputResource(BaseModel):
    """A single output declared in the plugin contract."""

    model_config = ConfigDict(extra="forbid")

    name: str
    type: str = ResourceType.FILE
    path: str = ""  # glob pattern relative to workspace (e.g. "output/**/*.json")

    @field_validator("path", mode="before")
    @classmethod
    def _default_path(cls, value: Optional[str], info: Any) -> str:
        if value:
            return str(value)
        name = info.data.get("name", "output") if isinstance(info.data, dict) else "output"
        return str(PurePosixPath("output") / name)


# ---------------------------------------------------------------------------
# Plugin Contract
# ---------------------------------------------------------------------------


class PluginContract(BaseModel):
    """The full contract section of a v2 plugin.yaml."""

    model_config = ConfigDict(extra="forbid")

    inputs: list[InputResource] = Field(default_factory=list)
    outputs: list[OutputResource] = Field(default_factory=list)

    def required_inputs(self) -> list[InputResource]:
        return [r for r in self.inputs if r.required]

    def inputs_by_source(self, source: str) -> list[InputResource]:
        return [r for r in self.inputs if r.source == source]

    def outputs_by_glob(self) -> list[OutputResource]:
        return [r for r in self.outputs if r.type in (ResourceType.FILE, ResourceType.DIRECTORY)]


# ---------------------------------------------------------------------------
# v2 Manifest
# ---------------------------------------------------------------------------


class PluginManifestV2(BaseModel):
    """v2 plugin manifest corresponding to the new plugin.yaml format."""

    model_config = ConfigDict(extra="forbid")

    name: str
    version: str
    description: str = ""
    runtime: dict[str, str] = Field(default_factory=lambda: {"type": "shell"})
    contract: PluginContract
