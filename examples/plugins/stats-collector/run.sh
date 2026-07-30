#!/bin/sh
set -eu

python3 - <<'PY'
import json, math, sys
from pathlib import Path

raw = json.loads(Path("input.json").read_text())
params = raw.get("params", {})

numbers_raw = params.get("numbers", [])
if not isinstance(numbers_raw, list):
    print("ERROR: 'numbers' must be a list", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":"numbers must be a list"}))
    sys.exit(1)

values = []
for v in numbers_raw:
    try:
        values.append(float(v) if not isinstance(v, (int, float)) else float(v))
    except (ValueError, TypeError):
        print(f"WARNING: skipping non-numeric value {v!r}", file=sys.stderr)

n = len(values)
if n == 0:
    print("ERROR: 'numbers' list is empty", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":"numbers list is empty"}))
    sys.exit(1)

total = sum(values)
mean = total / n

if n > 1:
    variance = sum((x - mean) ** 2 for x in values) / (n - 1)
    stdev = math.sqrt(variance)
else:
    stdev = float("nan")

stats = {
    "count": n, "sum": total, "avg": mean,
    "min": min(values), "max": max(values), "stdev": stdev,
}
Path("stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

Path("output.json").write_text(json.dumps({
    "status": "success",
    "message": f"Computed statistics for {n} values",
    "outputs": {k: v for k, v in stats.items() if not (isinstance(v, float) and math.isnan(v))},
    "artifacts": [{"name": "stats.json", "path": "stats.json"}],
}, ensure_ascii=False), encoding="utf-8")

print(f"stats: n={n} sum={total} avg={mean:.2f} min={min(values)} max={max(values)}")
PY
