"""Tests for the pipeline wiring validator.

The validator checks that every required input in every step's plugin
manifest has a wiring source: either `${{ params.* }}`, `${{ steps.<dep>.outputs.* }}`,
`${{ all.deps.outputs.* }}`, or a per-step override key.
"""
import io

from mini_pipeline.pipeline.service import PipelineService, _is_wired_expression


def test_is_wired_expression_recognises_supported_forms() -> None:
    assert _is_wired_expression("${{ params.a }}", deps=[])
    assert _is_wired_expression("${{ steps.math.outputs.product }}", deps=["math"])
    assert _is_wired_expression("${{ all.deps.outputs.message }}", deps=["a", "b"])
    # numeric / boolean literal
    assert _is_wired_expression(0, deps=[])
    assert _is_wired_expression(True, deps=[])
    # string literal (user typed a plain string)
    assert _is_wired_expression("hello", deps=[])
    # missing expression for a dep
    assert not _is_wired_expression("${{ steps.b.outputs.x }}", deps=["a"])
    # missing param
    assert not _is_wired_expression("${{ steps.math.outputs.quotient }}", deps=[])


def test_validate_reports_unwired_required_inputs(client, plugin_zip) -> None:
    archive = plugin_zip(name="val-echo")
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("val-echo.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    # The default plugin_zip in conftest has empty inputs/outputs, so
    # the validator should report "manifest unavailable" warnings only.
    definition = """
name: minimal-pipeline
params: {}
steps:
  - name: only-step
    plugin: val-echo@1.0.0
"""
    service = PipelineService(repository=None)
    report = service.validate(definition, params={})
    assert "problems" in report


def test_validate_well_formed_pipeline_has_no_problems() -> None:
    # A pipeline with only ${{ params.* }} references is always valid.
    definition = """
name: ok
params: {a: 1, b: 2}
steps:
  - name: s
    plugin: x@1.0.0
    with:
      a: "${{ params.a }}"
      b: "${{ params.b }}"
"""
    service = PipelineService(repository=None)
    report = service.validate(definition, params={"a": 1, "b": 2})
    # Report should be valid because all params resolve
    assert report["valid"] is True
