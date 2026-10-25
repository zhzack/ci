"""Application configuration loaded from YAML."""

import os
import re
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.domain.exceptions import ConfigurationError

_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class AppConfig(BaseModel):
    name: str = "Mini Pipeline"
    host: str = "0.0.0.0"
    port: int = Field(default=8000, ge=1, le=65535)
    api_prefix: str = "/api"


class DatabaseConfig(BaseModel):
    url: str
    echo: bool = False


class StorageConfig(BaseModel):
    root: Path
    plugins: Path
    workspaces: Path
    logs: Path
    artifacts: Path
    temp: Path

    def directories(self) -> tuple:
        return (
            self.root,
            self.plugins,
            self.workspaces,
            self.logs,
            self.artifacts,
            self.temp,
        )


class ExecutionConfig(BaseModel):
    coordinator_workers: int = Field(default=2, ge=1)
    task_workers: int = Field(default=4, ge=1)
    task_timeout_seconds: int = Field(default=3600, ge=1)
    # Mark runs still PENDING/RUNNING at startup as FAILED (crash recovery).
    reap_orphans_on_start: bool = True
    # Base delay for step retries; doubles per attempt, capped at 60s.
    retry_backoff_seconds: float = Field(default=2.0, ge=0)


class LoggingConfig(BaseModel):
    level: str = "INFO"
    format: str = Field(default="text", pattern="^(text|json)$")


class ObservabilityConfig(BaseModel):
    metrics_enabled: bool = True


class AuthToken(BaseModel):
    token: str
    name: str = ""
    role: str = Field(default="reader", pattern="^(admin|reader)$")


class AuthConfig(BaseModel):
    enabled: bool = False
    # Open user self-registration (the very first user becomes admin).
    registration_enabled: bool = True
    # Login session lifetime.
    session_ttl_hours: int = Field(default=72, ge=1)
    tokens: list[AuthToken] = Field(default_factory=list)


class SecurityConfig(BaseModel):
    # CORS: empty list disables CORS handling entirely.
    cors_origins: list[str] = Field(default_factory=list)
    # Max mutating (POST/PUT/PATCH/DELETE) requests per client IP per minute.
    # 0 disables rate limiting.
    rate_limit_per_minute: int = Field(default=0, ge=0)
    # Fernet key source for machine credentials at rest. Required when admin
    # machines store credentials.
    secret_key: str = ""


class RunnerConfig(BaseModel):
    """Remote execution (runner agents on user machines)."""

    # A claimed task must be heartbeated at least this often or the lease
    # reaper marks it FAILED. Agents renew via heartbeat while executing.
    lease_seconds: int = Field(default=120, ge=30)
    # Recommended agent heartbeat interval (keep <= lease/2).
    heartbeat_interval_seconds: int = Field(default=15, ge=5)
    # A machine is shown offline when its last heartbeat is older than this.
    offline_after_seconds: int = Field(default=45, ge=10)
    # How often the engine polls a remote task's persisted state.
    poll_interval_seconds: float = Field(default=0.5, ge=0.1)


class RetentionConfig(BaseModel):
    # Days to keep per-run data after a run reaches a terminal state. 0 = keep forever.
    workspaces_days: float = Field(default=14, ge=0)
    logs_days: float = Field(default=30, ge=0)
    artifacts_days: float = Field(default=90, ge=0)
    # Lifetime of stray files under storage/tmp.
    temp_hours: float = Field(default=24, ge=0)


class SourceConfig(BaseModel):
    http_timeout_seconds: int = Field(default=30, ge=1)
    max_archive_bytes: int = Field(default=100 * 1024 * 1024, ge=1)
    max_extracted_bytes: int = Field(default=500 * 1024 * 1024, ge=1)
    max_archive_files: int = Field(default=10_000, ge=1)


class LocalPackageStorageConfig(BaseModel):
    root: Path = Path("./data/packages")


class S3PackageStorageConfig(BaseModel):
    endpoint_url: Optional[str] = None
    bucket_name: str = "mini-pipeline"
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    region: str = "us-east-1"


class PackageStorageConfig(BaseModel):
    driver: str = Field(default="local", pattern="^(local|s3)$")
    local: LocalPackageStorageConfig = Field(default_factory=LocalPackageStorageConfig)
    s3: S3PackageStorageConfig = Field(default_factory=S3PackageStorageConfig)


class ArtifactStorageConfig(BaseModel):
    """Storage backend for run artifacts (and remote task bundle state)."""

    driver: str = Field(default="local", pattern="^(local|s3)$")
    # S3 key prefix under which artifacts are stored.
    prefix: str = "artifacts"
    s3: S3PackageStorageConfig = Field(default_factory=S3PackageStorageConfig)


class EmailConfig(BaseModel):
    enabled: bool = True
    host: str = "smtp.qq.com"
    port: int = 465
    username: str = ""
    # SMTP credentials must come from the environment (SMTP_PASSWORD) or the
    # admin console — never from a source-control default.
    password: str = ""
    sender_email: str = ""
    sender_name: str = "Mini Pipeline CI/CD"
    use_ssl: bool = True
    use_tls: bool = False
    proxy: Optional[str] = None


class DockerRuntimeConfig(BaseModel):
    """Sandbox controls for the Docker runtime (applied on `docker run`).

    Defaults keep the pre-hardening behaviour (no limits, bridge network,
    any image allowed); production deployments should set network to `none`
    and pin an image allowlist. `network: host` is always rejected.
    """

    # --cpus (e.g. "1.5"), --memory (e.g. "512m"), --pids-limit (e.g. 128).
    cpus: Optional[str] = None
    memory: Optional[str] = None
    pids_limit: Optional[int] = None
    # --network; "host" is rejected outright at validation time.
    network: Optional[str] = None
    # fnmatch patterns (e.g. "python:3.12-*"); empty list = any image.
    allowed_images: list[str] = Field(default_factory=list)


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    app: AppConfig
    database: DatabaseConfig
    storage: StorageConfig
    execution: ExecutionConfig
    sources: SourceConfig
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    retention: RetentionConfig = Field(default_factory=RetentionConfig)
    runner: RunnerConfig = Field(default_factory=RunnerConfig)
    packages: PackageStorageConfig = Field(default_factory=PackageStorageConfig)
    artifact_storage: ArtifactStorageConfig = Field(default_factory=ArtifactStorageConfig)
    docker_runtime: DockerRuntimeConfig = Field(default_factory=DockerRuntimeConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)

    def prepare_directories(self) -> None:
        for directory in self.storage.directories():
            directory.mkdir(parents=True, exist_ok=True)
        if self.packages.driver == "local":
            self.packages.local.root.mkdir(parents=True, exist_ok=True)


def _expand_environment(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _expand_environment(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_environment(item) for item in value]
    if not isinstance(value, str):
        return value

    def replace(match: re.Match) -> str:
        variable = match.group(1)
        default = match.group(2)
        if variable in os.environ:
            return os.environ[variable]
        if default is not None:
            return default
        raise ConfigurationError(
            f"Required environment variable {variable!r} is not set"
        )

    return _ENV_PATTERN.sub(replace, value)


def _resolve_storage_paths(data: dict[str, Any], working_directory: Path) -> None:
    storage = data.get("storage")
    if isinstance(storage, dict):
        for key, value in storage.items():
            path = Path(value).expanduser()
            if not path.is_absolute():
                path = working_directory / path
            storage[key] = str(path.resolve())

    packages = data.get("packages")
    if isinstance(packages, dict):
        local = packages.get("local")
        if isinstance(local, dict) and "root" in local:
            path = Path(local["root"]).expanduser()
            if not path.is_absolute():
                path = working_directory / path
            local["root"] = str(path.resolve())


def _load_dotenv() -> None:
    """Load .env from the working directory if python-dotenv is available.

    Real process.env entries always win (override=False), matching
    docker-compose semantics; this only bridges bare ``uvicorn`` runs to the
    same .env file the compose files consume.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:  # dependency optional for pure-compose deployments
        return
    load_dotenv(override=False)


def load_settings(
    path: Optional[Path] = None,
    *,
    working_directory: Optional[Path] = None,
) -> Settings:
    _load_dotenv()
    config_path = Path(path or os.getenv("MINI_PIPELINE_CONFIG", "config/default.yaml"))
    if not config_path.is_absolute():
        config_path = Path.cwd() / config_path
    try:
        with config_path.open("r", encoding="utf-8") as stream:
            raw = yaml.safe_load(stream)
    except FileNotFoundError as exc:
        raise ConfigurationError(f"Configuration file not found: {config_path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigurationError(f"Invalid configuration YAML: {exc}") from exc

    if not isinstance(raw, dict):
        raise ConfigurationError("Configuration root must be a mapping")

    expanded = _expand_environment(raw)
    _resolve_storage_paths(expanded, (working_directory or Path.cwd()).resolve())
    try:
        return Settings.model_validate(expanded)
    except PydanticValidationError as exc:
        raise ConfigurationError(f"Invalid application configuration: {exc}") from exc
