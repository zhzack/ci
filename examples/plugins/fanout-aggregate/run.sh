#!/bin/sh
set -eu

python3 - <<'PY'
import json
from pathlib import Path

params = json.loads(Path("input.json").read_text())["params"]
title = params.get("title", "Fan-in summary")
messages = list(params.get("messages") or [])

lines = [f"# {title}", ""]
for index, message in enumerate(messages, start=1):
    lines.append(f"{index}. {message}")
lines.append("")

total_length = sum(len(str(message)) for message in messages)
summary = "\n".join(lines)

Path("summary.md").write_text(summary + "\n", encoding="utf-8")

Path("output.json").write_text(
    json.dumps(
        {
            "status": "success",
            "message": f"Aggregated {len(messages)} upstream messages",
            "outputs": {
                "summary": summary,
                "total_length": total_length,
                "count": len(messages),
            },
            "artifacts": [{"name": "summary.md", "path": "summary.md"}],
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print(summary)
print(f"count={len(messages)} total_length={total_length}")
PY
