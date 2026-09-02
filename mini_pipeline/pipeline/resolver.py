"""Resolve safe pipeline expressions against params and dependency results."""

from __future__ import annotations

import json
import re
from typing import Any

from mini_pipeline.domain.exceptions import ValidationError

_EXPRESSION = re.compile(r"\$\{\{\s*([^{}]+?)\s*\}\}")
_FULL_EXPRESSION = re.compile(r"^\$\{\{\s*([^{}]+?)\s*\}\}$")
_SEGMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*$")


def resolve_parameters(
    value: Any,
    *,
    params: dict[str, Any],
    steps: dict[str, dict[str, Any]],
    secrets: dict[str, Any] | None = None,
) -> Any:
    if isinstance(value, dict):
        return {
            key: resolve_parameters(item, params=params, steps=steps, secrets=secrets)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [
            resolve_parameters(item, params=params, steps=steps, secrets=secrets)
            for item in value
        ]
    if not isinstance(value, str):
        return value

    full = _FULL_EXPRESSION.fullmatch(value)
    if full:
        return _lookup(full.group(1), params=params, steps=steps, secrets=secrets)

    def replace(match: re.Match) -> str:
        resolved = _lookup(match.group(1), params=params, steps=steps, secrets=secrets)
        if isinstance(resolved, str):
            return resolved
        return json.dumps(resolved, separators=(",", ":"), ensure_ascii=False)

    return _EXPRESSION.sub(replace, value)


def _lookup(
    expression: str,
    *,
    params: dict[str, Any],
    steps: dict[str, dict[str, Any]],
    secrets: dict[str, Any] | None = None,
) -> Any:
    parts = expression.strip().split(".")
    if any(not _SEGMENT.fullmatch(part) for part in parts):
        raise ValidationError(f"Invalid pipeline expression: {expression!r}")
    if parts[0] == "secrets":
        if not secrets:
            raise ValidationError(f"No secrets available or unknown secret: {expression}")
        if len(parts) == 2:
            sec_name = parts[1]
            if sec_name not in secrets:
                raise ValidationError(f"Unknown pipeline secret: {sec_name}")
            val = secrets[sec_name]
            if isinstance(val, dict) and "secret" in val and len(val) == 1:
                return val["secret"]
            return val
        if len(parts) == 3:
            sec_name = parts[1]
            sub_key = parts[2]
            if sec_name not in secrets:
                raise ValidationError(f"Unknown pipeline secret: {sec_name}")
            val = secrets[sec_name]
            if not isinstance(val, dict) or sub_key not in val:
                raise ValidationError(f"Unknown key {sub_key!r} in secret {sec_name!r}")
            return val[sub_key]
        raise ValidationError(f"Invalid secret expression: {expression!r}")
    if len(parts) == 2 and parts[0] == "params":
        try:
            return params[parts[1]]
        except KeyError as exc:
            raise ValidationError(f"Unknown pipeline parameter: {parts[1]}") from exc
    if len(parts) == 4 and parts[0] == "steps" and parts[2] == "outputs":
        try:
            return steps[parts[1]]["outputs"][parts[3]]
        except KeyError as exc:
            raise ValidationError(f"Unknown step output: {expression}") from exc
    if (
        len(parts) == 4
        and parts[0] == "all"
        and parts[1] == "deps"
        and parts[2] == "outputs"
    ):
        if not steps:
            raise ValidationError(
                f"No upstream steps to aggregate: {expression}"
            )
        collected: list[Any] = []
        for step_name, step_data in steps.items():
            try:
                collected.append(step_data["outputs"][parts[3]])
            except KeyError as exc:
                raise ValidationError(
                    f"Unknown step output for {step_name!r}: {expression}"
                ) from exc
        return collected
    if len(parts) == 5 and parts[0] == "steps" and parts[2] == "artifacts" and parts[4] == "path":
        try:
            artifacts = steps[parts[1]]["artifacts"]
            artifact = next(item for item in artifacts if item["name"] == parts[3])
            return artifact["path"]
        except (KeyError, StopIteration) as exc:
            raise ValidationError(f"Unknown step artifact: {expression}") from exc
    raise ValidationError(f"Unsupported pipeline expression: {expression!r}")

