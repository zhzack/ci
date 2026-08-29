"""Data shared between a step and its upstream dependencies."""

from typing import Any

from pydantic import BaseModel, Field


class DependencyResult(BaseModel):
    """Outputs and artifacts produced by one upstream step."""

    outputs: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
