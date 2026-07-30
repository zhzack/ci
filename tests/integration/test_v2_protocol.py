"""Test the v2 runtime protocol end-to-end."""
import io
import time
import zipfile


def wait_for_run(client, run_id: str, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/runs/{run_id}").json()
        if body["status"] in {"SUCCESS", "FAILED"}:
            return body
        time.sleep(0.05)
    raise AssertionError("Pipeline did not complete")


def build_zip(name: str, version: str, files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for path, content in files.items():
            info = zipfile.ZipInfo(path)
            if path.endswith(".py") or path.endswith(".sh"):
                info.external_attr = 0o755 << 16
            archive.writestr(info, content)
    return buf.getvalue()


V2_YAML = """name: v2-stats-python
version: 1.0.0
description: test v2 contract stats
runtime:
  type: python
  entry: stats.py
contract:
  inputs:
    - name: numbers
      type: list
      source: parameter
      required: true
    - name: precision
      type: number
      source: parameter
      required: false
      default: 2
  outputs:
    - name: stats
      type: json
      path: output/stats.json
    - name: report
      type: file
      path: output/report.txt
"""

STATS_PY = """import json, os, sys
from pathlib import Path
work = Path(os.environ.get('PIPELINE_WORKSPACE', '.'))
out = work / 'output'; out.mkdir(exist_ok=True)
nums = json.loads((work / 'input' / 'numbers').read_text())
if not isinstance(nums, list): nums = [nums]
values = [float(v) for v in nums if isinstance(v,(int,float,str))]
n = len(values)
if not n: sys.exit(1)
total = sum(values); mean = total/n
stats = {'count': n, 'sum': total, 'avg': mean, 'min': min(values), 'max': max(values)}
(out / 'stats.json').write_text(json.dumps(stats))
(out / 'report.txt').write_text(f'n={n} total={total}')
print(f'stats n={n}')
"""


def test_v2_python_plugin_end_to_end(client) -> None:
    files = {"plugin.yaml": V2_YAML, "stats.py": STATS_PY}
    archive = build_zip("v2-stats-python", "1.0.0", files)
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("v2-stats-python.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201, response.text

    definition = """name: v2-stats-demo
params:
  values: [10, 25, 30, 45, 50]
  precision: 3
steps:
  - name: stats
    plugin: v2-stats-python@1.0.0
    with:
      numbers: "${{ params.values }}"
      precision: "${{ params.precision }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "v2-stats-demo", "params": {}},
    )
    assert submitted.status_code == 202
    run = wait_for_run(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS"
    assert run["tasks"][0]["outputs"]["count"] == 5
    assert run["tasks"][0]["outputs"]["sum"] == 160


def test_v2_manifest_validator_accepts_python_runtime() -> None:
    from mini_pipeline.plugin.manifest import RuntimeSpec

    spec = RuntimeSpec(type="python")
    assert spec.type == "python"
    spec2 = RuntimeSpec(type="node")
    assert spec2.type == "node"


def test_v2_missing_required_input_rejected(client, plugin_zip) -> None:
    files = {"plugin.yaml": V2_YAML, "stats.py": STATS_PY}
    archive = build_zip("v2-stats-python", "1.0.0", files)
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("v2-stats-python.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    definition = """name: v2-stats-missing
params: {}
steps:
  - name: stats
    plugin: v2-stats-python@1.0.0
    with:
      numbers: "${{ params.numbers }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "v2-stats-missing", "params": {}},
    )
    assert submitted.status_code == 422
