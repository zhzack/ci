"""Safe Pipeline YAML parsing and validation."""

from typing import Any

import yaml
from pydantic import ValidationError as PydanticValidationError

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.pipeline.dag import validate_dag
from mini_pipeline.pipeline.schema import PipelineDefinition


def parse_pipeline(content: str) -> PipelineDefinition:
    try:
        raw: Any = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValidationError(f"Invalid pipeline YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValidationError("Pipeline YAML root must be a mapping")
    try:
        pipeline = PipelineDefinition.model_validate(raw)
    except PydanticValidationError as exc:
        raise ValidationError(f"Invalid pipeline definition: {exc}") from exc
    validate_dag(pipeline)
    return pipeline
