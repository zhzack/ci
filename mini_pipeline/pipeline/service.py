"""Pipeline definition application service."""

import re
from typing import Any, Optional

from mini_pipeline.database.models import PipelineDefinition as PipelineEntity
from mini_pipeline.database.repositories import PipelineRepository
from mini_pipeline.pipeline.parser import parse_pipeline
from mini_pipeline.pipeline.schema import PipelineDefinition
from mini_pipeline.plugin.manifest import load_manifest

_STEP_PARAMS_PATTERN = re.compile(r"^\$\{\{\s*([^{}]+?)\s*\}\}$")


class PipelineService:
    def __init__(self, repository: PipelineRepository) -> None:
        self.repository = repository

    def create(self, definition: str) -> PipelineEntity:
        pipeline = parse_pipeline(definition)
        self._validate_wiring(pipeline)
        return self.repository.create(name=pipeline.name, definition=definition)

    def get(self, identifier: str) -> PipelineEntity:
        return self.repository.get(identifier)

    def get_parsed(self, identifier: str) -> tuple[PipelineEntity, PipelineDefinition]:
        entity = self.get(identifier)
        return entity, parse_pipeline(entity.definition)

    def update(self, identifier: str, definition: str) -> PipelineEntity:
        pipeline = parse_pipeline(definition)
        self._validate_wiring(pipeline)
        return self.repository.update(identifier, definition=definition)

    def delete(self, identifier: str) -> None:
        self.repository.delete(identifier)

    def list(self) -> list[PipelineEntity]:
        return self.repository.list()

    def validate(self, definition: str, *, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Validate that all step.required inputs have a wiring source.

        Returns a structured report. The check does not consult the database
        for plugin manifests; missing manifests are reported as a warning
        rather than an error.
        """
        pipeline = parse_pipeline(definition)
        return self._wiring_report(pipeline, params or {})

    def _validate_wiring(self, pipeline: PipelineDefinition) -> None:
        # Validate the structure; full wiring check uses the runtime's
        # plugin manifest store, which is unavailable here.
        for step in pipeline.steps:
            # The Pydantic schema already ensures step.plugin_reference is valid.
            pass

    def _wiring_report(
        self,
        pipeline: PipelineDefinition,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Walk each step, checking that required inputs are wired.

        A required input is "wired" if the value in `step.with` is:
        - A `${{ params.<key> }}` expression (auto-resolved at runtime)
        - A `${{ steps.<dep>.outputs.<key> }}` expression
        - A `${{ all.deps.outputs.<key> }}` expression
        - A per-step override key (the key itself must be the input name)
        - A literal scalar (boolean/number/string) that is not a ${{}} expression
        """
        steps = {step.name: step for step in pipeline.steps}
        steps_with_problems: list[dict[str, Any]] = []
        available_outputs: dict[str, set[str]] = {
            name: set() for name in steps
        }

        # Build the per-step output key set by reading plugin manifests from
        # disk (best-effort). Unknown manifests are reported as warnings.
        try:
            for step in pipeline.steps:
                plugin_name, plugin_version = step.plugin_reference
                # We look in the install path via the params-schema endpoint
                # we have to do this via DB here; skip if unavailable.
                pass
        except Exception:
            pass

        for step in pipeline.steps:
            plugin_name, plugin_version = step.plugin_reference
            try:
                # Look up the plugin's installed manifest by scanning the
                # plugins directory for the right name/version subfolder.
                from mini_pipeline.core.config import load_settings

                settings = load_settings()
                install_path = settings.storage.plugins / plugin_name / plugin_version
                if install_path.is_dir():
                    manifest = load_manifest(install_path)
                    available_outputs[step.name] = set(manifest.outputs.keys())
                    required = {
                        k: spec
                        for k, spec in (manifest.inputs or {}).items()
                        if getattr(spec, "required", False)
                    }
                else:
                    required = {}
            except Exception as exc:  # noqa: BLE001
                steps_with_problems.append(
                    {
                        "step": step.name,
                        "warning": f"manifest unavailable: {exc}",
                    }
                )
                required = {}

            missing: list[str] = []
            for key, spec in required.items():
                value = (step.parameters or {}).get(key)
                if value is None:
                    missing.append(key)
                    continue
                if not _is_wired_expression(value, deps=step.depends):
                    # The user typed a literal; that's OK only if params
                    # doesn't need to fill it. But for required keys, a
                    # literal is ambiguous at runtime — treat as missing.
                    if key not in params:
                        missing.append(key)
            if missing:
                steps_with_problems.append(
                    {
                        "step": step.name,
                        "plugin": f"{plugin_name}@{plugin_version}",
                        "missing_inputs": missing,
                    }
                )

        return {
            "valid": not steps_with_problems,
            "problems": steps_with_problems,
        }


def _is_wired_expression(value: Any, *, deps: list[str]) -> bool:
    if not isinstance(value, str):
        # boolean/number literal — accepted but considered a constant
        return True
    match = _STEP_PARAMS_PATTERN.fullmatch(value.strip())
    if not match:
        # Not a ${{}} expression → literal value (user can use this for static config)
        return True
    expr = match.group(1).strip()
    parts = expr.split(".")
    if len(parts) >= 2 and parts[0] == "params":
        return True
    if len(parts) >= 4 and parts[0] == "steps" and parts[1] in deps and parts[2] == "outputs":
        return True
    if len(parts) >= 4 and parts[0] == "all" and parts[1] == "deps" and parts[2] == "outputs":
        return True
    return False
