#!/bin/sh
set -eu

python3 - << 'PY'
import json
from pathlib import Path

work = Path("${PIPELINE_WORKSPACE:-.}")
params_path = work / "params.json"
if params_path.exists():
    name = json.loads(params_path.read_text()).get("name", "world")
else:
    name_path = work / "input" / "name"
    name = name_path.read_text().strip() if name_path.exists() else "world"

greeting = f"Hello, {name}!"
out_dir = work / "output"
out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / "greeting.txt").write_text(greeting + "\n")
print(greeting)
PY
