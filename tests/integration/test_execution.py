import io
import time


def wait_for_run(client, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        payload = client.get(f"/api/runs/{run_id}").json()
        if payload["status"] in {"SUCCESS", "FAILED"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Run {run_id} did not finish")


def upload(client, plugin_zip, *, name: str, script: str) -> None:
    archive = plugin_zip(name=name, script=script)
    response = client.post(
        "/api/plugins/upload",
        files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
    )
    assert response.status_code == 201, response.text


def test_pipeline_run_logs_outputs_and_artifact(client, plugin_zip) -> None:
    upload(
        client,
        plugin_zip,
        name="producer",
        script="""#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
value = json.load(open('input.json'))['params']['value']
open('result.txt', 'w').write(str(value))
json.dump({
  'status': 'success',
  'message': 'produced',
  'outputs': {'value': value},
  'artifacts': [{'name': 'result', 'path': 'result.txt'}],
}, open('output.json', 'w'))
PY
echo producer-log
""",
    )
    upload(
        client,
        plugin_zip,
        name="consumer",
        script="""#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
params = json.load(open('input.json'))['params']
json.dump({'status':'success','outputs':{'seen':params['seen']}}, open('output.json','w'))
PY
""",
    )
    definition = """
name: execution-demo
params:
  initial: 7
steps:
  - name: produce
    plugin: producer@1.0.0
    with:
      value: "${{ params.initial }}"
  - name: consume
    plugin: consumer@1.0.0
    depends: [produce]
    with:
      seen: "${{ steps.produce.outputs.value }}"
"""
    assert client.post("/api/pipelines", json={"definition": definition}).status_code == 201

    submitted = client.post("/api/runs", json={"pipeline": "execution-demo", "params": {}})
    assert submitted.status_code == 202, submitted.text
    run = wait_for_run(client, submitted.json()["id"])

    assert run["status"] == "SUCCESS", run
    assert run["tasks"][1]["outputs"] == {"seen": 7}
    assert "producer-log" in client.get(f"/api/runs/{run['id']}/tasks/produce/log").text
    artifact = run["tasks"][0]["artifacts"][0]
    downloaded = client.get(f"/api/runs/{run['id']}/artifacts/{artifact['id']}")
    assert downloaded.status_code == 200
    assert downloaded.content == b"7"


def test_failed_task_skips_dependent_branch(client, plugin_zip) -> None:
    upload(
        client,
        plugin_zip,
        name="failure",
        script="#!/bin/sh\necho failed\nexit 2\n",
    )
    upload(client, plugin_zip, name="never", script="#!/bin/sh\nexit 0\n")
    definition = """
name: failure-demo
steps:
  - {name: fail, plugin: failure@1.0.0}
  - {name: downstream, plugin: never@1.0.0, depends: [fail]}
"""
    client.post("/api/pipelines", json={"definition": definition})

    submitted = client.post("/api/runs", json={"pipeline": "failure-demo"})
    run = wait_for_run(client, submitted.json()["id"])

    assert run["status"] == "FAILED"
    assert [task["status"] for task in run["tasks"]] == ["FAILED", "SKIPPED"]
