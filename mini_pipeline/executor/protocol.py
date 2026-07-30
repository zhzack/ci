"""JSON input/output protocol used by every plugin invocation."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DependencyResult(BaseModel):
    outputs: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)


class PluginInput(BaseModel):
    task_id: str
    workspace: str
    params: dict[str, Any] = Field(default_factory=dict)
    dependencies: dict[str, DependencyResult] = Field(default_factory=dict)


class ArtifactOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    path: str

    @field_validator("name", "path")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value


class PluginOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["success", "failed"]
    message: str = ""
    outputs: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[ArtifactOutput] = Field(default_factory=list)
