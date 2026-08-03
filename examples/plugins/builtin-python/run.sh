#!/bin/sh
set -eu

python3 - << 'PY'
import json, sys, traceback
from pathlib import Path

raw = json.loads(Path("input.json").read_text())
params = dict(raw.get("params", {}))
code = str(params.pop("code", "")).strip()

if not code:
    print("ERROR: code field is empty", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":"code field is empty"}))
    sys.exit(1)

namespace: dict = {}
exec(code, {
    "json": json, "Path": Path, "sys": sys,
    "__builtins__": __builtins__,
}, namespace)

if "main" not in namespace:
    print("ERROR: code must define a main(params, deps, workspace) function", file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":"no main() defined — code must contain def main(params, deps, workspace)"}))
    sys.exit(1)

try:
    result = namespace["main"](
        params,
        raw.get("dependencies", {}),
        str(Path("input.json").resolve().parent),
    )
    if not isinstance(result, dict):
        result = {"status": "success", "outputs": {"_raw": str(result)}}
    if "status" not in result:
        result["status"] = "success"
    Path("output.json").write_text(json.dumps(result, default=str, ensure_ascii=False))
except Exception:
    tb = traceback.format_exc()
    print(tb, file=sys.stderr)
    Path("output.json").write_text(json.dumps({"status":"failed","message":tb.splitlines()[-1]}))
    sys.exit(1)
PY
