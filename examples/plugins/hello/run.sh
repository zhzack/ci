#!/bin/sh
set -eu

python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("input.json").read_text())
name = payload["params"]["name"]
greeting = f"Hello, {name}!"
Path("greeting.txt").write_text(greeting + "\n")
Path("output.json").write_text(json.dumps({
    "status": "success",
    "message": "Greeting generated",
    "outputs": {"greeting": greeting},
    "artifacts": [{"name": "greeting.txt", "path": "greeting.txt"}],
}))
print(greeting)
PY
