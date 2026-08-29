"""Test the unified v2 manifest accepts both native v2 and legacy v1 formats."""

import pytest

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.plugin.manifest import load_manifest


def test_load_v2_native_manifest(tmp_path):
    plugin_dir = tmp_path / "v2-native"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.yaml").write_text(
        """
name: v2-native
version: 1.0.0
runtime:
  type: python
  entry: main.py
contract:
  inputs:
    - {name: input_a, type: string, source: parameter, required: true, target: input_a}
  outputs:
    - {name: result, type: string, path: output/result.txt}
"""
    )
    (plugin_dir / "main.py").write_text("print('hi')")
    manifest = load_manifest(plugin_dir)
    assert manifest.name == "v2-native"
    assert manifest.runtime.type == "python"
    assert manifest.entry == "main.py"
    assert isinstance(manifest.contract.inputs, list)
    assert len(manifest.contract.inputs) == 1
    assert manifest.contract.inputs[0].name == "input_a"
    assert manifest.contract.inputs[0].required is True


def test_auto_upgrade_v1_to_v2(tmp_path):
    plugin_dir = tmp_path / "v1-legacy"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.yaml").write_text(
        """
name: v1-legacy
version: 1.0.0
runtime: {type: shell}
entry: run.sh
inputs:
  greeting:
    type: string
    required: true
outputs:
  result:
    type: string
"""
    )
    (plugin_dir / "run.sh").write_text("#!/bin/sh\necho hi\n")
    manifest = load_manifest(plugin_dir)
    assert manifest.name == "v1-legacy"
    assert manifest.entry == "run.sh"
    assert isinstance(manifest.contract.inputs, list)
    assert manifest.contract.inputs[0].name == "greeting"
    assert manifest.contract.inputs[0].required is True
    assert manifest.contract.inputs[0].source == "parameter"
    assert isinstance(manifest.contract.outputs, list)
    assert manifest.contract.outputs[0].name == "result"
    assert manifest.contract.outputs[0].path == "output/result"


def test_rejects_unsupported_runtime(tmp_path):
    plugin_dir = tmp_path / "bad-runtime"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.yaml").write_text(
        """
name: bad
version: 1.0.0
runtime: {type: cobol}
entry: run.sh
"""
    )
    (plugin_dir / "run.sh").write_text("#!/bin/sh\n")
    with pytest.raises(ValidationError):
        load_manifest(plugin_dir)


def test_plugin_manifest_v2_with_artifact_input(tmp_path):
    plugin_dir = tmp_path / "artifact-input"
    plugin_dir.mkdir()
    (plugin_dir / "plugin.yaml").write_text(
        """
name: artifact-input
version: 1.0.0
runtime:
  type: shell
  entry: run.sh
contract:
  inputs:
    - {name: data, type: file, source: artifact,
      from: upstream.dataset, target: upstream/dataset.json, required: true}
  outputs:
    - {name: report, type: file, path: output/report.txt}
"""
    )
    (plugin_dir / "run.sh").write_text("#!/bin/sh\n")
    manifest = load_manifest(plugin_dir)
    assert manifest.contract.inputs[0].source == "artifact"
    assert manifest.contract.inputs[0].from_ == "upstream.dataset"
    assert manifest.contract.inputs[0].target == "upstream/dataset.json"
