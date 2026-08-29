import io
import time
import zipfile

import pytest


def wait_for_run(client, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/runs/{run_id}").json()
        if body["status"] in {"SUCCESS", "FAILED"}:
            return body
        time.sleep(0.05)
    raise AssertionError("Pipeline did not complete in time")


def build_plugin_zip(name: str, version: str, script: str) -> bytes:
    manifest = (
        f"name: {name}\n"
        f"version: {version}\n"
        f"description: test\n"
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


ECHO_SCRIPT = """#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
from pathlib import Path
params = json.loads(Path("input.json").read_text())["params"]
final = f"[{params.get('tag','log')}] {params.get('message','')}"
Path("echo.txt").write_text(final + "\\n", encoding="utf-8")
Path("output.json").write_text(json.dumps({
    "status": "success",
    "outputs": {"message": final, "length": len(final)},
    "artifacts": [{"name": "echo.txt", "path": "echo.txt"}],
}, ensure_ascii=False), encoding="utf-8")
PY
"""

AGGREGATE_SCRIPT = """#!/bin/sh
set -eu
for c in python3 python; do
  command -v $c >/dev/null 2>&1 && $c -c 'import sys' >/dev/null 2>&1 && PY_BIN=$c && break
done
$PY_BIN - <<'PY'
import json
from pathlib import Path
params = json.loads(Path("input.json").read_text())["params"]
title = params.get("title", "Fan-in summary")
messages = list(params.get("messages") or [])
lines = [f"# {title}", ""]
for i, m in enumerate(messages, start=1):
    lines.append(f"{i}. {m}")
summary = "\\n".join(lines) + "\\n"
Path("summary.md").write_text(summary, encoding="utf-8")
Path("output.json").write_text(json.dumps({
    "status": "success",
    "outputs": {
        "summary": summary,
        "total_length": sum(len(str(m)) for m in messages),
        "count": len(messages),
    },
    "artifacts": [{"name": "summary.md", "path": "summary.md"}],
}, ensure_ascii=False), encoding="utf-8")
PY
"""


@pytest.fixture
def register_fanout_plugins(client):
    """Register fanout-echo and fanout-aggregate using the shared client."""
    for plugin_name, script in (
        ("fanout-echo", ECHO_SCRIPT),
        ("fanout-aggregate", AGGREGATE_SCRIPT),
    ):
        archive = build_plugin_zip(plugin_name, "1.0.0", script)
        response = client.post(
            "/api/plugins/upload",
            files={"file": (f"{plugin_name}.zip", io.BytesIO(archive), "application/zip")},
        )
        assert response.status_code == 201, response.text
    return client


def test_fanout_then_fanin_pipeline(register_fanout_plugins) -> None:
    client = register_fanout_plugins
    definition = """
name: fanout-demo
params:
  greeting: Mini Pipeline
steps:
  - name: branch-a
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.greeting }} A"
      tag: alpha
  - name: branch-b
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.greeting }} B"
      tag: beta
  - name: branch-c
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.greeting }} C"
      tag: gamma
  - name: aggregate
    plugin: fanout-aggregate@1.0.0
    depends: [branch-a, branch-b, branch-c]
    with:
      title: "Fan-in summary"
      messages: "${{ all.deps.outputs.message }}"
"""

    created = client.post("/api/pipelines", json={"definition": definition})
    assert created.status_code == 201, created.text

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "fanout-demo", "params": {"greeting": "Hello"}},
    )
    assert submitted.status_code == 202, submitted.text

    run = wait_for_run(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS", run

    tasks_by_name = {task["name"]: task for task in run["tasks"]}
    for name in ("branch-a", "branch-b", "branch-c"):
        assert tasks_by_name[name]["status"] == "SUCCESS"
        assert tasks_by_name[name]["outputs"]["length"] > 0
        assert tasks_by_name[name]["artifacts"][0]["name"] == "echo.txt"

    aggregate = tasks_by_name["aggregate"]
    assert aggregate["status"] == "SUCCESS"
    assert aggregate["outputs"]["count"] == 3
    assert aggregate["outputs"]["total_length"] > 0
    assert "Fan-in summary" in aggregate["outputs"]["summary"]
    for label in ("alpha", "beta", "gamma"):
        assert label in aggregate["outputs"]["summary"]

    summary_artifact = next(a for a in aggregate["artifacts"] if a["name"] == "summary.md")
    body = client.get(f"/api/runs/{run['id']}/artifacts/{summary_artifact['id']}")
    assert body.status_code == 200
    text = body.content.decode("utf-8")
    assert text.startswith("# Fan-in summary")
    assert "alpha" in text and "beta" in text and "gamma" in text
