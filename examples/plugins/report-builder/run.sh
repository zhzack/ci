#!/bin/sh
set -eu

python3 - <<'PY'
import json, sys
from pathlib import Path

raw = json.loads(Path("input.json").read_text())
params = raw.get("params", {})

title = params.get("title", "Report")
sub = params.get("subtitle", "")
fmt = params.get("format", "markdown")

required = ["title", "count", "sum", "avg", "max", "min"]
missing = [k for k in required if k not in params]
if missing:
    msg = f"Missing required inputs: {', '.join(missing)}"
    print(f"ERROR: {msg}", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":msg}))
    sys.exit(1)

count = int(params["count"])
total = float(params["sum"])
avg = float(params["avg"])
mx = float(params["max"])
mn = float(params["min"])

lines = [f"# {title}"]
if sub:
    lines.append(f"*{sub}*")
lines.append("")
if fmt == "text":
    lines.extend([
        f"Samples: {count}",
        f"Sum:     {total:.2f}",
        f"Average: {avg:.2f}",
        f"Min:     {mn:.2f}",
        f"Max:     {mx:.2f}",
    ])
else:
    lines.append("| Metric  | Value     |")
    lines.append("|---------|-----------|")
    lines.extend([
        f"| Samples | {count}   |",
        f"| Sum     | {total:.2f} |",
        f"| Average | {avg:.2f} |",
        f"| Min     | {mn:.2f} |",
        f"| Max     | {mx:.2f} |",
    ])
lines.append("")
report = "\n".join(lines)

Path("report.md").write_text(report + "\n", encoding="utf-8")
wc = len(report.split())

Path("output.json").write_text(json.dumps({
    "status": "success",
    "message": f"Report generated ({wc} words)",
    "outputs": {"report": report, "word_count": wc},
    "artifacts": [{"name": "report.md", "path": "report.md"}],
}, ensure_ascii=False), encoding="utf-8")

print(report)
PY
