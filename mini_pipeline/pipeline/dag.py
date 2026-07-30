"""Pipeline DAG validation and stable ordering."""

import heapq

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.pipeline.schema import PipelineDefinition


def topological_order(pipeline: PipelineDefinition) -> list[str]:
    positions = {step.name: position for position, step in enumerate(pipeline.steps)}
    indegree = {step.name: len(step.depends) for step in pipeline.steps}
    dependents: dict[str, list[str]] = {step.name: [] for step in pipeline.steps}
    for step in pipeline.steps:
        for dependency in step.depends:
            dependents[dependency].append(step.name)

    ready = [(positions[name], name) for name, degree in indegree.items() if degree == 0]
    heapq.heapify(ready)
    result: list[str] = []
    while ready:
        _, name = heapq.heappop(ready)
        result.append(name)
        for dependent in dependents[name]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                heapq.heappush(ready, (positions[dependent], dependent))

    if len(result) != len(pipeline.steps):
        cycle_nodes = sorted(name for name, degree in indegree.items() if degree > 0)
        raise ValidationError(f"Pipeline contains a dependency cycle: {cycle_nodes}")
    return result


def validate_dag(pipeline: PipelineDefinition) -> None:
    topological_order(pipeline)
