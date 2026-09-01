import io
import time


def wait_for_run(client, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/api/runs/{run_id}")
        assert res.status_code == 200, res.text
        payload = res.json()
        if payload["status"] in {"SUCCESS", "FAILED"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not finish within {timeout}s")


def upload_plugin(client, plugin_zip, *, name: str, script: str) -> None:
    archive = plugin_zip(name=name, script=script)
    response = client.post(
        "/api/plugins/upload",
        files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201, response.text


def test_step_cache_hit_and_invalidation(client, plugin_zip) -> None:
    upload_plugin(
        client,
        plugin_zip,
        name="calc-plugin",
        script="""#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
with open('input.json') as f:
    data = json.load(f)
val = int(data['params'].get('number', 0))
with open('output.txt', 'w') as out_f:
    out_f.write(f"calculated: {val * 10}")
with open('output.json', 'w') as out_j:
    json.dump({
        'status': 'success',
        'outputs': {'result': val * 10},
        'artifacts': [{'name': 'calc_out', 'path': 'output.txt'}],
    }, out_j)
PY
echo "calc-plugin executed from process"
""",
    )

    pipeline_yaml = """
name: cache-test-pipeline
params:
  num: 5
steps:
  - name: calculate
    plugin: calc-plugin@1.0.0
    cache: true
    with:
      number: ${{ params.num }}
"""

    create_res = client.post("/api/pipelines", json={"definition": pipeline_yaml})
    assert create_res.status_code == 201, create_res.text
    pipeline_id = create_res.json()["id"]

    # Run 1: First run with num=5 -> Cache miss, executes normally
    run1 = client.post("/api/runs", json={"pipeline": pipeline_id, "params": {"num": 5}}).json()
    res1 = wait_for_run(client, run1["id"])
    assert res1["status"] == "SUCCESS"
    assert res1["tasks"][0]["outputs"]["result"] == 50
    # Check log for normal run
    log1 = client.get(f"/api/runs/{run1['id']}/tasks/calculate/log").text
    assert "calc-plugin executed from process" in log1

    # Run 2: Second run with identical params (num=5) -> Cache hit!
    run2 = client.post("/api/runs", json={"pipeline": pipeline_id, "params": {"num": 5}}).json()
    res2 = wait_for_run(client, run2["id"])
    assert res2["status"] == "SUCCESS"
    assert res2["tasks"][0]["outputs"]["result"] == 50
    assert "[CACHE HIT]" in res2["tasks"][0]["message"]
    log2 = client.get(f"/api/runs/{run2['id']}/tasks/calculate/log").text
    assert "[CACHE HIT]" in log2

    # Run 3: Third run with different param (num=8) -> Cache miss, computes new value 80
    run3 = client.post("/api/runs", json={"pipeline": pipeline_id, "params": {"num": 8}}).json()
    res3 = wait_for_run(client, run3["id"])
    assert res3["status"] == "SUCCESS"
    assert res3["tasks"][0]["outputs"]["result"] == 80
    log3 = client.get(f"/api/runs/{run3['id']}/tasks/calculate/log").text
    assert "calc-plugin executed from process" in log3


def test_step_cache_with_downstream_dependency(client, plugin_zip) -> None:
    upload_plugin(
        client,
        plugin_zip,
        name="step-a",
        script="""#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
json.dump({'status': 'success', 'outputs': {'greeting': 'Hello from A'}}, open('output.json', 'w'))
PY
echo "step A executed"
""",
    )

    upload_plugin(
        client,
        plugin_zip,
        name="step-b",
        script="""#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
with open('input.json') as f:
    inp = json.load(f)
seen = inp['params']['from_a']
out_data = {'status': 'success', 'outputs': {'final': f"B received: {seen}"}}
with open('output.json', 'w') as out_f:
    json.dump(out_data, out_f)
PY
""",
    )

    pipeline_yaml = """
name: cache-dep-pipeline
steps:
  - name: first
    plugin: step-a@1.0.0
    cache: true
  - name: second
    plugin: step-b@1.0.0
    depends: [first]
    with:
      from_a: ${{ steps.first.outputs.greeting }}
"""

    create_res = client.post("/api/pipelines", json={"definition": pipeline_yaml})
    assert create_res.status_code == 201, create_res.text
    pipeline_id = create_res.json()["id"]

    # Run 1: First run
    run1 = client.post("/api/runs", json={"pipeline": pipeline_id}).json()
    res1 = wait_for_run(client, run1["id"])
    assert res1["status"] == "SUCCESS"
    assert res1["tasks"][1]["outputs"]["final"] == "B received: Hello from A"

    # Run 2: Step 'first' should be cached, and step 'second' must still succeed
    run2 = client.post("/api/runs", json={"pipeline": pipeline_id}).json()
    res2 = wait_for_run(client, run2["id"])
    assert res2["status"] == "SUCCESS"
    assert "[CACHE HIT]" in res2["tasks"][0]["message"]
    assert res2["tasks"][1]["outputs"]["final"] == "B received: Hello from A"
