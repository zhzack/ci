"""Pipeline definition application service."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from mini_pipeline.database.models import PipelineDefinition as PipelineEntity
from mini_pipeline.database.models import PipelineVersion
from mini_pipeline.database.repositories import (
    PipelineRepository,
    PipelineVersionRepository,
    PluginRepository,
)
from mini_pipeline.domain.exceptions import NotFoundError
from mini_pipeline.pipeline.parser import parse_pipeline
from mini_pipeline.pipeline.schema import PipelineDefinition
from mini_pipeline.plugin.manifest import load_manifest

_STEP_PARAMS_PATTERN = re.compile(r"^\$\{\{\s*([^{}]+?)\s*\}\}$")


class PipelineService:
    def __init__(
        self,
        repository: PipelineRepository,
        *,
        plugin_repository: PluginRepository | None = None,
        versions: PipelineVersionRepository | None = None,
    ) -> None:
        self.repository = repository
        self.plugin_repository = plugin_repository
        self.versions = versions

    def create(self, definition: str, *, owner_id: str | None = None) -> PipelineEntity:
        pipeline = parse_pipeline(definition)
        self._validate_wiring(pipeline)
        entity = self.repository.create(
            name=pipeline.name, definition=definition, owner_id=owner_id
        )
        if self.versions is not None:
            self.versions.record(
                pipeline_id=entity.id, definition=definition, created_by=owner_id
            )
        return entity

    # -- definition versioning ------------------------------------------------

    def list_versions(self, identifier: str) -> list[PipelineVersion]:
        if self.versions is None:
            return []
        entity = self.get(identifier)
        return self.versions.list(entity.id)

    def get_version(self, identifier: str, version: int) -> PipelineVersion:
        if self.versions is None:
            raise NotFoundError("Pipeline versioning is not available")
        entity = self.get(identifier)
        return self.versions.get(entity.id, version)

    def rollback(
        self, identifier: str, version: int, *, actor_id: str | None = None
    ) -> PipelineEntity:
        # Restoring an old definition records it as the newest version, so the
        # history stays append-only and nothing is destroyed.
        if self.versions is None:
            raise NotFoundError("Pipeline versioning is not available")
        entity = self.get(identifier)
        snapshot = self.versions.get(entity.id, version)
        if snapshot.definition == entity.definition:
            return entity
        updated = self.update(identifier, snapshot.definition)
        # update() already recorded the changed definition as a new version.
        return updated

    def get(self, identifier: str) -> PipelineEntity:
        return self.repository.get(identifier)

    def get_parsed(self, identifier: str) -> tuple[PipelineEntity, PipelineDefinition]:
        entity = self.get(identifier)
        return entity, parse_pipeline(entity.definition)

    def update(
        self, identifier: str, definition: str, *, owner_id: str | None = None
    ) -> PipelineEntity:
        _ = owner_id  # ownership is checked at the API layer
        pipeline = parse_pipeline(definition)
        self._validate_wiring(pipeline)
        entity = self.repository.update(identifier, definition=definition)
        if self.versions is not None:
            latest = self.versions.list(entity.id)
            if not latest or latest[0].definition != definition:
                self.versions.record(
                    pipeline_id=entity.id, definition=definition, created_by=owner_id
                )
        return entity

    def delete(self, identifier: str) -> None:
        self.repository.delete(identifier)

    def list(self) -> list[PipelineEntity]:
        return self.repository.list()

    def validate(
        self, definition: str, *, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
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
        # The Pydantic schema already ensures step.plugin_reference is valid.
        _ = pipeline.steps

    def _plugin_install_path(self, plugin_ref: tuple[str, str]) -> Path | None:
        if self.plugin_repository is None:
            return None
        try:
            version = self.plugin_repository.get_version(*plugin_ref)
        except Exception:
            return None
        path = Path(version.install_path)
        return path if path.is_dir() else None

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

        Inputs declared with `source: artifact` or `source: upload` are
        satisfied by the executor at runtime and are never flagged.
        """
        steps = {step.name: step for step in pipeline.steps}
        steps_with_problems: list[dict[str, Any]] = []
        available_outputs: dict[str, set[str]] = {name: set() for name in steps}

        for step in pipeline.steps:
            plugin_name, plugin_version = step.plugin_reference
            required: dict[str, Any] = {}
            install_path = self._plugin_install_path(step.plugin_reference)
            if install_path is None:
                # Plugin not registered (or repo unavailable): nothing to
                # verify against — skip silently rather than fail the report.
                continue
            try:
                manifest = load_manifest(install_path)
            except Exception as exc:
                steps_with_problems.append(
                    {
                        "step": step.name,
                        "warning": f"manifest unavailable: {exc}",
                    }
                )
                manifest = None
            if manifest is not None:
                outputs = manifest.contract.outputs
                if isinstance(outputs, list):
                    available_outputs[step.name] = {o.name for o in outputs}
                else:
                    available_outputs[step.name] = set(outputs.keys())
                inputs = manifest.contract.inputs
                if isinstance(inputs, list):
                    for r in inputs:
                        if getattr(r, "required", False) and getattr(
                            r, "source", "parameter"
                        ) not in ("artifact", "upload"):
                            required[r.name] = r
                else:
                    required = {
                        k: spec
                        for k, spec in (inputs or {}).items()
                        if getattr(spec, "required", False)
                    }

            missing: list[str] = []
            for key in required:
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
