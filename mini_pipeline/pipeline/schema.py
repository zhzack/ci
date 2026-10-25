"""Pipeline definition schema."""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from mini_pipeline.domain.exceptions import ValidationError

_STEP_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
_PLUGIN_REF_PATTERN = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z0-9_.-]{0,127})@"
    r"(?P<version>(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$"
)


class PipelineStep(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    plugin: str
    depends: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict, alias="with")
    # Automatic retry count for this step after a failure (0 = no retry).
    retries: int = Field(default=0, ge=0, le=10)
    # Optional execution target: machine id or name. Overrides the run-level
    # machine. Resolved and validated at submit time.
    machine: str | None = None
    # Enable content-addressed result caching for this step
    cache: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not _STEP_NAME_PATTERN.fullmatch(value):
            raise ValueError("invalid step name")
        return value

    @field_validator("plugin")
    @classmethod
    def validate_plugin(cls, value: str) -> str:
        if not _PLUGIN_REF_PATTERN.fullmatch(value):
            raise ValueError("plugin must use name@semantic-version")
        return value

    @field_validator("depends")
    @classmethod
    def unique_dependencies(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("dependencies must be unique")
        return value

    @property
    def plugin_reference(self) -> tuple[str, str]:
        match = _PLUGIN_REF_PATTERN.fullmatch(self.plugin)
        if match is None:  # Guard for constructed models that skipped validation.
            raise ValidationError(f"Invalid plugin reference: {self.plugin}")
        return match.group("name"), match.group("version")


MASK = "******"


def secret_param_names(params_def: dict[str, Any] | None) -> set[str]:
    """Names of parameters declared as secrets.

    A parameter is a secret when its definition is a mapping containing
    ``secret: true``::

        params:
          api_key:
            secret: true
            description: Third-party API key

    Secret values must be supplied by the run request; they are stored out of
    the visible params payload and injected as ``MP_SECRET_<NAME>`` env vars.
    """
    names: set[str] = set()
    for key, spec in (params_def or {}).items():
        if isinstance(spec, dict) and spec.get("secret") is True:
            names.add(key)
    return names


def split_secret_params(
    params_def: dict[str, Any] | None,
    run_params: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Split run params into (masked, real) using the pipeline definition.

    Values for secret parameters are pulled out of the visible payload
    (replaced with ``******``) and returned separately for durable storage.
    """
    secrets = secret_param_names(params_def)
    if not secrets:
        return dict(run_params), {}
    masked = dict(run_params)
    real: dict[str, Any] = {}
    for key in secrets:
        if key in masked:
            real[key] = masked.pop(key)
            masked[key] = MASK
    return masked, real


class WebhookConfig(BaseModel):
    """Outbound webhook registered on a pipeline for run-finished events."""

    model_config = ConfigDict(extra="forbid")

    url: str
    # HMAC-SHA256 signing key; omit to deliver unsigned.
    secret: str | None = None
    # Which events to receive; "run.finished" is the only one today.
    events: list[str] = Field(default_factory=lambda: ["run.finished"])

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("webhook url must start with http:// or https://")
        return value


class PipelineDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    # Outbound run-finished callbacks (HMAC-signed when secret is set).
    webhooks: list[WebhookConfig] = Field(default_factory=list)
    steps: list[PipelineStep] = Field(min_length=1)

    @field_validator("name", mode="before")
    @classmethod
    def _coerce_name(cls, value: Any) -> str:
        """Accept numbers and booleans as string names (YAML auto-typing)."""
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value:
            raise ValueError("Pipeline name is required")
        if not value[0].isalpha():
            raise ValueError(
                "Pipeline name must start with a letter (A-Z, a-z), "
                f"but got {value!r}"
            )
        if not _STEP_NAME_PATTERN.fullmatch(value):
            raise ValueError(
                "Pipeline name must start with a letter and only contain "
                "letters, digits, dots, underscores, and hyphens"
            )
        return value

    @model_validator(mode="after")
    def validate_steps(self) -> PipelineDefinition:
        names = [step.name for step in self.steps]
        if len(names) != len(set(names)):
            raise ValueError("step names must be unique")
        known = set(names)
        for step in self.steps:
            missing = set(step.depends) - known
            if missing:
                raise ValueError(f"step {step.name!r} depends on missing steps: {sorted(missing)}")
            if step.name in step.depends:
                raise ValueError(f"step {step.name!r} cannot depend on itself")
        return self
