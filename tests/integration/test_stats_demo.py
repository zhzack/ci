"""End-to-end test for the stats-demo pipeline: fan-out → fan-in → report."""
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


def build_zip(name: str, version: str, yaml_text: str, script: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yaml", yaml_text)
        info = zipfile.ZipInfo("run.sh")
        info.external_attr = 0o755 << 16
        zf.writestr(info, script)
    return buf.getvalue()


ECHO_YAML = """name: fanout-echo
version: 1.0.0
runtime: {type: shell}
entry: run.sh
inputs:
  message: {type: string, required: true}
  tag: {type: string, required: false, default: log}
outputs:
  message: {type: string}
  length: {type: integer}
"""

ECHO_SCRIPT = """#!/bin/sh
set -eu
python3 - <<'PY'
import json
from pathlib import Path
p = json.loads(Path('input.json').read_text())['params']
final = f"[{p.get('tag','log')}] {p.get('message','')}"
Path('echo.txt').write_text(final+"\\n", encoding='utf-8')
Path('output.json').write_text(json.dumps({
    'status':'success',
    'outputs':{'message':final,'length':len(final)},
    'artifacts':[{'name':'echo.txt','path':'echo.txt'}],
}), encoding='utf-8')
PY
"""

STATS_YAML = """name: stats-collector
version: 1.0.0
runtime: {type: shell}
entry: run.sh
inputs:
  numbers: {type: list, required: true}
outputs:
  count: {type: integer}
  sum: {type: number}
  avg: {type: number}
  min: {type: number}
  max: {type: number}
"""

STATS_SCRIPT = """#!/bin/sh
set -eu
python3 - <<'PY'
import json, math, sys
from pathlib import Path
raw = json.loads(Path('input.json').read_text())
values = [float(v) for v in (raw['params'].get('numbers') or []) if isinstance(v,(int,float)) or (isinstance(v,str) and v.replace('.','',1).isdigit())]
if not values: print("ERROR:empty",file=sys.stderr); sys.exit(1)
n=len(values); total=sum(values); mean=total/n
stats = {"count":n,"sum":total,"avg":mean,"min":min(values),"max":max(values)}
Path('stats.json').write_text(json.dumps(stats),encoding='utf-8')
Path('output.json').write_text(json.dumps({"status":"success","outputs":stats,"artifacts":[{"name":"stats.json","path":"stats.json"}]}),encoding='utf-8')
print(f"stats n={n}")
PY
"""

REPORT_YAML = """name: report-builder
version: 1.0.0
runtime: {type: shell}
entry: run.sh
inputs:
  title: {type: string, required: true}
  subtitle: {type: string, required: false, default: ''}
  count: {type: integer, required: true}
  sum: {type: number, required: true}
  avg: {type: number, required: true}
  max: {type: number, required: true}
  min: {type: number, required: true}
outputs:
  report: {type: string}
  word_count: {type: integer}
"""

REPORT_SCRIPT = """#!/bin/sh
set -eu
python3 - <<'PY'
import json, sys
from pathlib import Path
p = json.loads(Path('input.json').read_text())['params']
missing = [k for k in ['title','count','sum','avg','max','min'] if k not in p]
if missing:
    Path('output.json').write_text(json.dumps({"status":"failed","message":"missing "+",".join(missing)}))
    sys.exit(1)
title=p['title']; sub=p.get('subtitle','')
lines = [f"# {title}"]
if sub: lines.append(f"*{sub}*")
lines.append("")
lines.append("| Metric  | Value     |")
lines.append("|---------|-----------|")
for label,key in [("Samples","count"),("Sum","sum"),("Average","avg"),("Min","min"),("Max","max")]:
    lines.append(f"| {label} | {float(p[key]):.2f} |")
lines.append("")
report = "\\n".join(lines)
Path('report.md').write_text(report+"\\n",encoding='utf-8')
Path('output.json').write_text(json.dumps({"status":"success","outputs":{"report":report,"word_count":len(report.split())},"artifacts":[{"name":"report.md","path":"report.md"}]}),encoding='utf-8')
PY
"""


def test_stats_pipeline(client) -> None:
    for name, yml, scr in (
        ("fanout-echo", ECHO_YAML, ECHO_SCRIPT),
        ("stats-collector", STATS_YAML, STATS_SCRIPT),
        ("report-builder", REPORT_YAML, REPORT_SCRIPT),
    ):
        archive = build_zip(name, "1.0.0", yml, scr)
        response = client.post(
            "/api/plugins/upload",
            files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
        )
        assert response.status_code == 201, response.text

    definition = """name: stats-demo
params:
  title: Pipeline statistics report
  subtitle: (auto-generated)
  a: 100
  b: 200
  c: 300
steps:
  - name: echo-a
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.a }}"
      tag: A
  - name: echo-b
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.b }}"
      tag: BB
  - name: echo-c
    plugin: fanout-echo@1.0.0
    with:
      message: "${{ params.c }}"
      tag: CCC
  - name: stats
    plugin: stats-collector@1.0.0
    depends:
      - echo-a
      - echo-b
      - echo-c
    with:
      numbers: "${{ all.deps.outputs.length }}"
  - name: report
    plugin: report-builder@1.0.0
    depends:
      - stats
    with:
      title: "${{ params.title }}"
      subtitle: "${{ params.subtitle }}"
      count: "${{ steps.stats.outputs.count }}"
      sum: "${{ steps.stats.outputs.sum }}"
      avg: "${{ steps.stats.outputs.avg }}"
      max: "${{ steps.stats.outputs.max }}"
      min: "${{ steps.stats.outputs.min }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201

    submitted = client.post("/api/runs", json={"pipeline": "stats-demo", "params": {}})
    assert submitted.status_code == 202
    run = wait_for_run(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS"

    by_name = {t["name"]: t for t in run["tasks"]}
    # Verify three echoes ran in parallel
    for name in ("echo-a", "echo-b", "echo-c"):
        assert by_name[name]["status"] == "SUCCESS"
        assert by_name[name]["outputs"]["length"] > 0
    # Stats collected from fan-in
    stats = by_name["stats"]
    assert stats["outputs"]["count"] == 3
    assert stats["outputs"]["sum"] == by_name["echo-a"]["outputs"]["length"] + by_name["echo-b"]["outputs"]["length"] + by_name["echo-c"]["outputs"]["length"]
    assert stats["outputs"]["max"] >= stats["outputs"]["min"]
    # Report built from stats
    report = by_name["report"]
    assert report["status"] == "SUCCESS"
    assert "Pipeline statistics report" in report["outputs"]["report"]
    assert "(auto-generated)" in report["outputs"]["report"]
    # Verify artifacts
    report_artifacts = {a["name"] for a in report["artifacts"]}
    assert "report.md" in report_artifacts
    stats_arts = {a["name"] for a in stats["artifacts"]}
    assert "stats.json" in stats_arts
