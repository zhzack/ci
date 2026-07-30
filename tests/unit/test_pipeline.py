import pytest

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.pipeline.dag import topological_order
from mini_pipeline.pipeline.parser import parse_pipeline
from mini_pipeline.pipeline.resolver import resolve_parameters


def test_pipeline_parser_and_stable_topological_order() -> None:
    pipeline = parse_pipeline(
        """
name: build
params: {mode: release}
steps:
  - name: checkout
    plugin: checkout@1.0.0
  - name: lint
    plugin: lint@1.0.0
    depends: [checkout]
  - name: build
    plugin: build@2.0.0
    depends: [checkout]
"""
    )

    assert topological_order(pipeline) == ["checkout", "lint", "build"]
    assert pipeline.steps[2].plugin_reference == ("build", "2.0.0")


def test_pipeline_cycle_is_rejected() -> None:
    with pytest.raises(ValidationError, match="cycle"):
        parse_pipeline(
            """
name: bad
steps:
  - {name: one, plugin: one@1.0.0, depends: [two]}
  - {name: two, plugin: two@1.0.0, depends: [one]}
"""
        )


def test_parameter_resolver_preserves_full_expression_type() -> None:
    resolved = resolve_parameters(
        {
            "count": "${{ params.count }}",
            "message": "result=${{ steps.build.outputs.value }}",
            "artifact": "${{ steps.build.artifacts.binary.path }}",
        },
        params={"count": 3},
        steps={
            "build": {
                "outputs": {"value": 42},
                "artifacts": [{"name": "binary", "path": "/managed/app.bin"}],
            }
        },
    )

    assert resolved == {
        "count": 3,
        "message": "result=42",
        "artifact": "/managed/app.bin",
    }


def test_pipeline_api(client) -> None:
    definition = """
name: sample
steps:
  - name: hello
    plugin: hello@1.0.0
"""
    created = client.post("/api/pipelines", json={"definition": definition})

    assert created.status_code == 201
    assert created.json()["name"] == "sample"
    fetched = client.get("/api/pipelines/sample")
    assert fetched.status_code == 200
    assert "name: sample" in fetched.text


def test_all_deps_fanin_expression_collects_outputs() -> None:
    resolved = resolve_parameters(
        {"messages": "${{ all.deps.outputs.message }}"},
        params={},
        steps={
            "branch-a": {"outputs": {"message": "alpha"}},
            "branch-b": {"outputs": {"message": "beta"}},
        },
    )
    assert resolved == {"messages": ["alpha", "beta"]}


def test_all_deps_fanin_preserves_step_order() -> None:
    resolved = resolve_parameters(
        {"values": "${{ all.deps.outputs.value }}"},
        params={},
        steps={
            "z": {"outputs": {"value": 1}},
            "a": {"outputs": {"value": 2}},
            "m": {"outputs": {"value": 3}},
        },
    )
    assert resolved == {"values": [1, 2, 3]}


def test_all_deps_fanin_embedded_in_string() -> None:
    resolved = resolve_parameters(
        {"summary": "lines: ${{ all.deps.outputs.line }}"},
        params={},
        steps={
            "a": {"outputs": {"line": "one"}},
            "b": {"outputs": {"line": "two"}},
        },
    )
    assert resolved == {"summary": 'lines: ["one","two"]'}
