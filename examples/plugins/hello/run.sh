#!/bin/sh
set -eu

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys" >/dev/null 2>&1; then
    PY="$c"
    break
  fi
done

if [ -z "$PY" ]; then
  echo "Error: Python interpreter not found" >&2
  exit 1
fi

"$PY" - << 'PY'
import json
import os
from pathlib import Path

work = Path(os.environ.get("PIPELINE_WORKSPACE", "."))
params_path = work / "params.json"
if params_path.exists():
    name = json.loads(params_path.read_text(encoding="utf-8")).get("name", "world")
else:
    name_path = work / "input" / "name"
    name = name_path.read_text(encoding="utf-8").strip() if name_path.exists() else "world"

greeting = f"Hello, {name}!"
out_dir = work / "output"
out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / "greeting.txt").write_text(greeting + "\n", encoding="utf-8")
print(greeting)
PY
