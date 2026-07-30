#!/bin/sh
set -eu

python3 - <<'PY'
import json, sys
from pathlib import Path

raw = json.loads(Path("input.json").read_text())
params = raw.get("params", {})

required = ["x", "y", "z"]
try:
    values = [float(params[k]) for k in required]
except (KeyError, ValueError, TypeError) as exc:
    msg = f"Missing or invalid required input in {required}: {exc}"
    print(f"ERROR: {msg}", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":msg}))
    sys.exit(1)

for key in ("quotient", "extra"):
    v = params.get(key)
    if v is not None:
        try:
            values.append(float(v))
        except (ValueError, TypeError):
            pass

ranked = sorted(values, reverse=True)
Path("ranked.json").write_text(
    json.dumps({"ranked": ranked, "max": ranked[0], "min": ranked[-1]}, indent=2),
    encoding="utf-8",
)

Path("output.json").write_text(
    json.dumps(
        {
            "status": "success",
            "message": f"Ranked {len(values)} values descending",
            "outputs": {"ranked": ranked, "max": ranked[0], "min": ranked[-1]},
            "artifacts": [{"name": "ranked.json", "path": "ranked.json"}],
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print(f"values={values} ranked={ranked}")
PY
