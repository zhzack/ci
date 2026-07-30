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
Path('result.txt').write_text(f'product={product}\\nquotient={quotient}\\n', encoding='utf-8')
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
values = [float(params[k]) for k in ('x','y','z')]
v = params.get('quotient') or params.get('extra')
if v is not None: values.append(float(v))
ranked = sorted(values, reverse=True)
Path('ranked.json').write_text(json.dumps({'ranked': ranked}), encoding='utf-8')
Path('output.json').write_text(json.dumps({
    'status': 'success',
    'outputs': {'ranked': ranked, 'max': ranked[0], 'min': ranked[-1]},
    'artifacts': [{'name': 'ranked.json', 'path': 'ranked.json'}],
}), encoding='utf-8')
PY
"""


def test_chain_math_pipeline(client) -> None:
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
params: {a: 2, b: 3, c: 4}
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
    assert create.status_code == 201, create.text

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "chain-math", "params": {}},
    )
    assert submitted.status_code == 202
    run = wait_for_run(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS"

    by_step = {task["name"]: task for task in run["tasks"]}
    assert by_step["math"]["outputs"]["product"] == 6
    assert by_step["math"]["outputs"]["quotient"] == 1.5
    ranked = by_step["rank"]["outputs"]["ranked"]
    assert ranked == sorted(ranked, reverse=True)
    # extra == 1.5
    assert 1.5 in ranked
    assert by_step["rank"]["outputs"]["max"] == 4.0
    assert by_step["rank"]["outputs"]["min"] == 1.5
