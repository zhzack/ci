import io
import time
import zipfile


def wait_for_run(client, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/runs/{run_id}").json()
        if body["status"] in {"SUCCESS", "FAILED"}:
            return body
        time.sleep(0.05)
    raise AssertionError("Pipeline did not complete")


def build_plugin_zip(name: str, version: str, script: str) -> bytes:
    manifest = (
        f"name: {name}\n"
        f"version: {version}\n"
        f"description: t\n"
        f"runtime: {{type: shell}}\n"
        f"entry: run.sh\n"
        f"inputs: {{}}\n"
        f"outputs: {{}}\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.yaml", manifest)
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        archive.writestr(info, script)
    return buffer.getvalue()


MATH_SCRIPT = """#!/bin/sh
set -eu
python3 - <<'PY'
import json
from pathlib import Path
params = json.loads(Path('input.json').read_text())['params']
a = float(params['a']); b = float(params['b']); c = float(params['c'])
product = a * b
quotient = product / c
Path('result.txt').write_text(f'product={product}\\n', encoding='utf-8')
Path('output.json').write_text(json.dumps({
    'status': 'success',
    'outputs': {'product': product, 'quotient': quotient},
    'artifacts': [{'name': 'result.txt', 'path': 'result.txt'}],
}), encoding='utf-8')
PY
"""

RANK_SCRIPT = """#!/bin/sh
set -eu
python3 - <<'PY'
import json
from pathlib import Path
params = json.loads(Path('input.json').read_text())['params']
values = [float(params[k]) for k in ('x','y','z','extra')]
ranked = sorted(values, reverse=True)
Path('ranked.json').write_text(json.dumps({'ranked': ranked}), encoding='utf-8')
Path('output.json').write_text(json.dumps({
    'status': 'success',
    'outputs': {'ranked': ranked, 'max': ranked[0], 'min': ranked[-1]},
    'artifacts': [{'name': 'ranked.json', 'path': 'ranked.json'}],
}), encoding='utf-8')
PY
"""


def test_branch_reuses_parent_step_results(client) -> None:
    for name, script in (
        ("math-divprod", MATH_SCRIPT),
        ("rank-list", RANK_SCRIPT),
    ):
        archive = build_plugin_zip(name, "1.0.0", script)
        response = client.post(
            "/api/plugins/upload",
            files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
        )
        assert response.status_code == 201, response.text

    definition = """
name: chain-math
params: {a: 2, b: 3, c: 4, extra: -1}
steps:
  - name: math
    plugin: math-divprod@1.0.0
    with:
      a: "${{ params.a }}"
      b: "${{ params.b }}"
      c: "${{ params.c }}"
  - name: rank
    plugin: rank-list@1.0.0
    depends: [math]
    with:
      x: "${{ params.a }}"
      y: "${{ params.b }}"
      z: "${{ params.c }}"
      quotient: "${{ steps.math.outputs.quotient }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    # Original run
    submitted = client.post(
        "/api/runs",
        json={"pipeline": "chain-math", "params": {}},
    )
    assert submitted.status_code == 202
    parent = wait_for_run(client, submitted.json()["id"])
    assert parent["status"] == "SUCCESS"
    parent_math = next(t for t in parent["tasks"] if t["name"] == "math")
    assert parent_math["outputs"]["product"] == 6
    parent_rank = next(t for t in parent["tasks"] if t["name"] == "rank")
    assert parent_rank["outputs"]["ranked"] == [4.0, 3.0, 2.0, -1.0]

    # Branch from "rank" -> re-executes only rank with new params
    branch = client.post(
        f"/api/runs/{parent['id']}/branches",
        json={"from_step": "rank", "params": {"extra": 100}},
    )
    assert branch.status_code == 202, branch.text
    branch_run = wait_for_run(client, branch.json()["id"])
    assert branch_run["status"] == "SUCCESS"
    branch_tasks = {t["name"]: t for t in branch_run["tasks"]}
    assert branch_tasks["math"]["message"] == "Reused from parent run"
    assert branch_tasks["math"]["outputs"] == parent_math["outputs"]
    assert branch_tasks["rank"]["outputs"]["ranked"] == [100.0, 4.0, 3.0, 2.0]

    # Branch from non-existent step -> 404
    bad = client.post(
        f"/api/runs/{parent['id']}/branches",
        json={"from_step": "nope", "params": {}},
    )
    assert bad.status_code == 404


def test_aggregated_log_concatenates_all_steps(client, settings) -> None:
    archive = build_plugin_zip("math-only-agg", "1.0.0", MATH_SCRIPT)
    response = client.post(
        "/api/plugins/upload",
        files={"file": ("math-only-agg.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201

    definition = """
name: single-math-agg
params: {a: 2, b: 3, c: 4}
steps:
  - name: math
    plugin: math-only-agg@1.0.0
    with:
      a: "${{ params.a }}"
      b: "${{ params.b }}"
      c: "${{ params.c }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201
    submitted = client.post("/api/runs", json={"pipeline": "single-math-agg", "params": {}})
    run = wait_for_run(client, submitted.json()["id"])
    log_dir = settings.storage.logs
    print('log_dir contents:', list(log_dir.glob('**/*.log')))
    log = client.get(f"/api/runs/{run['id']}/aggregated-log").text
    print('aggregated log:', repr(log[:300]))
    assert "step:math" in log
    assert "product=6" in log
