"""Runtime implementation registry."""

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.domain.runtime import Runtime


class RuntimeRegistry:
    def __init__(self) -> None:
        self._runtimes: dict[str, Runtime] = {}

    def register(self, runtime: Runtime) -> None:
        self._runtimes[runtime.runtime_type] = runtime

    def get(self, runtime_type: str) -> Runtime:
        try:
            return self._runtimes[runtime_type]
        except KeyError as exc:
            raise ValidationError(f"Unsupported runtime type: {runtime_type}") from exc
