"""Data models and Pydantic schemas for runtime environments and provisioning."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RuntimeEnvironmentOut(BaseModel):
    id: str
    name: str
    env_type: str = "python"
    version: str
    os_arch: str = "linux-x86_64"
    package_path: str | None = None
    download_url: str | None = None
    description: str = ""
    is_default: bool = False
    created_at: datetime
    updated_at: datetime


class CreateRuntimeEnvironmentRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    env_type: str = Field("python", max_length=32)
    version: str = Field(..., min_length=1, max_length=32)
    os_arch: str = Field("linux-x86_64", max_length=32)
    package_path: str | None = None
    download_url: str | None = None
    description: str = Field("", max_length=500)
    is_default: bool = False


class UpdateRuntimeEnvironmentRequest(BaseModel):
    name: str | None = None
    env_type: str | None = None
    version: str | None = None
    os_arch: str | None = None
    package_path: str | None = None
    download_url: str | None = None
    description: str | None = None
    is_default: bool | None = None


class DeployEnvironmentRequest(BaseModel):
    machine_ids: list[str] = Field(..., min_length=1)


class EnvironmentDeployTaskOut(BaseModel):
    id: str
    environment_id: str
    environment_name: str
    environment_version: str
    machine_id: str
    machine_name: str
    machine_host: str
    status: str
    progress: int
    message: str
    logs: str
    triggered_by: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class DeployEvent(BaseModel):
    task_id: str
    machine_id: str
    machine_name: str
    status: str
    progress: int
    message: str
    log_chunk: str = ""
    timestamp: float
