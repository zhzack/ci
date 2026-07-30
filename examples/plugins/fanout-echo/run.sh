#!/bin/sh
set -eu

python3 - <<'PY'
import json
from pathlib import Path

params = json.loads(Path("input.json").read_text())["params"]
message = params.get("message", "")
tag = params.get("tag", "log")

final = f"[{tag}] {message}"
Path("echo.txt").write_text(final + "\n", encoding="utf-8")

Path("output.json").write_text(
    json.dumps(
        {
            "status": "success",
            "message": "Echo produced",
            "outputs": {
                "message": final,
                "length": len(final),
            },
            "artifacts": [{"name": "echo.txt", "path": "echo.txt"}],
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print(final)
print(f"length={len(final)}")
PY
