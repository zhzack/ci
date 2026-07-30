"""Cross-module data transfer models."""

from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from mini_pipeline.domain.states import PipelineStatus, TaskStatus


class PluginRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: str
    description: str
    source_type: str
    source_url: Optional[str] = None
    install_path: Path
    runtime_type: str
    entry: str
    created_at: datetime


class PipelineRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    definition: str
    created_at: datetime
    updated_at: datetime


class ArtifactRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    task_id: str
    name: str
    storage_path: Path
    size: int
    sha256: str
    created_at: datetime


class TaskRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    step_name: str
    plugin_name: str
    plugin_version: str
    status: TaskStatus
    message: Optional[str] = None
    outputs: dict[str, Any] = Field(default_factory=dict)
    log_path: Optional[Path] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    artifacts: list[ArtifactRecord] = Field(default_factory=list)


class RunRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    pipeline_id: str
    pipeline_name: str
    status: PipelineStatus
    params: dict[str, Any] = Field(default_factory=dict)
    message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    tasks: list[TaskRecord] = Field(default_factory=list)
