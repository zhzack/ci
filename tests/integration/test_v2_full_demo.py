"""End-to-end test for the v2 full demo pipeline.

data-generator (Python v2) + stats-analyzer (Python v2) with artifact mapping.
"""
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
            ext = path.rsplit(".", 1)[-1] if "." in path else ""
            if ext in ("py", "sh"):
                info.external_attr = 0o755 << 16
            archive.writestr(info, content)
    return buf.getvalue()


GEN_YAML = """name: data-generator
version: 1.0.0
runtime:
  type: python
  entry: generate.py
contract:
  inputs:
    - {name: count, type: number, source: parameter, required: false, default: 10}
    - {name: min_val, type: number, source: parameter, required: false, default: 0}
    - {name: max_val, type: number, source: parameter, required: false, default: 100}
  outputs:
    - {name: dataset, type: json, path: output/dataset.json}
    - {name: metadata, type: json, path: output/metadata.json}
"""

GEN_PY = """import json, os, random, sys, time
from pathlib import Path
work=Path(os.environ.get('PIPELINE_WORKSPACE','.'))
out=work/'output';out.mkdir(exist_ok=True)
inp=work/'input'
def r(k,d):p=inp/k;return float(p.read_text().strip()) if p.exists() else float(d)
c=int(r('count',10));mn=r('min_val',0);mx=r('max_val',100)
random.seed(int(time.time()*1_000_000)%(2**31))
vals=[round(random.uniform(mn,mx),2) for _ in range(c)]
(out/'dataset.json').write_text(json.dumps({'values':vals,'count':c}))
(out/'metadata.json').write_text(json.dumps({'count':c,'range':[mn,mx]}))
print(f'generated {c} values')
"""

ANALYZE_YAML = """name: stats-analyzer
version: 1.0.0
runtime:
  type: python
  entry: analyze.py
contract:
  inputs:
    - {name: dataset, type: file, source: artifact, from: generate.dataset, target: upstream/dataset.json, required: true}
    - {name: title, type: string, source: parameter, required: false, default: Report}
  outputs:
    - {name: report, type: file, path: output/report.md}
    - {name: summary, type: json, path: output/summary.json}
"""

ANALYZE_PY = """import json, math, os, sys
from pathlib import Path
work=Path(os.environ.get('PIPELINE_WORKSPACE','.'));out=work/'output';out.mkdir(exist_ok=True)
inp=work/'input'
dp=inp/'dataset'
if not dp.exists():print('ERROR:no dataset');sys.exit(1)
data=json.loads(dp.read_text());vals=data['values']
n=len(vals);total=sum(vals);mean=total/n;sv=sorted(vals)
med=sv[n//2] if n%2 else (sv[n//2-1]+sv[n//2])/2
var=sum((x-mean)**2 for x in vals)/(n-1) if n>1 else 0
s={'count':n,'sum':round(total,2),'mean':round(mean,2),'median':round(med,2),'min':round(min(vals),2),'max':round(max(vals),2),'stdev':round(math.sqrt(var),2)}
t=inp/'title';title=t.read_text().strip() if t.exists() else'Report'
lines=[f'# {title}','',f'*{n} samples*','','|Metric|Value|','|---|---|']
for k,v in [('Count',n),('Sum',s['sum']),('Mean',s['mean']),('Median',s['median']),('Min',s['min']),('Max',s['max']),('StdDev',s['stdev'])]:lines.append(f'|{k}|{v}|')
(out/'report.md').write_text('\\n'.join(lines)+'\\n')
(out/'summary.json').write_text(json.dumps(s))
print(f'analyzed {n} values mean={mean:.2f}')
"""


def test_v2_full_demo_pipeline(client) -> None:
    # Register both plugins
    for name, yml, script in (
        ("data-generator", GEN_YAML, GEN_PY),
        ("stats-analyzer", ANALYZE_YAML, ANALYZE_PY),
    ):
        files = {"plugin.yaml": yml, f"{name.split('-')[0]}.py": script}
        archive = build_zip(name, "1.0.0", files)
        resp = client.post(
            "/api/plugins/upload",
            files={"file": (f"{name}.zip", io.BytesIO(archive), "application/zip")},
        )
        assert resp.status_code == 201, f"{name}: {resp.text}"

    definition = """name: v2-full-demo
params:
  sample_count: 10
  range_min: 1
  range_max: 50
  report_title: Full-stack Demo
steps:
  - name: generate
    plugin: data-generator@1.0.0
    with:
      count: "${{ params.sample_count }}"
      min_val: "${{ params.range_min }}"
      max_val: "${{ params.range_max }}"
  - name: analyze
    plugin: stats-analyzer@1.0.0
    depends:
      - generate
    with:
      title: "${{ params.report_title }}"
"""
    create = client.post("/api/pipelines", json={"definition": definition})
    assert create.status_code == 201, create.text

    submitted = client.post(
        "/api/runs",
        json={"pipeline": "v2-full-demo", "params": {}},
    )
    assert submitted.status_code == 202
    run = wait_for_run(client, submitted.json()["id"])
    assert run["status"] == "SUCCESS", f"Pipeline failed: {run.get('message')}"

    tasks = {t["name"]: t for t in run["tasks"]}
    gen = tasks["generate"]
    ana = tasks["analyze"]

    assert gen["status"] == "SUCCESS"
    assert ana["status"] == "SUCCESS"
    assert ana["outputs"]["count"] == 10
    assert ana["outputs"]["mean"] > 0

    # Verify artifacts
    gen_artifacts = {a["name"] for a in gen["artifacts"]}
    assert "dataset" in gen_artifacts
    assert "metadata" in gen_artifacts
    ana_artifacts = {a["name"] for a in ana["artifacts"]}
    assert "report" in ana_artifacts
    assert "summary" in ana_artifacts
