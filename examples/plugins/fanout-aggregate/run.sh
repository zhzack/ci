#!/bin/sh
set -eu

python3 - <<'PY'
import json, os
from pathlib import Path

work = Path(os.environ.get("PIPELINE_WORKSPACE", "."))
in_dir = work / "input"
out_dir = work / "output"
out_dir.mkdir(parents=True, exist_ok=True)

# Read per-input files written by the v2 executor (one file per input name).
def _read(name, default=""):
    p = in_dir / name
    return p.read_text(encoding="utf-8").strip() if p.exists() else default

title = _read("title", "Fan-in summary")
# `messages` comes from ${{ all.deps.outputs.<key> }} and is serialised as
# JSON in input/messages.
try:
    raw = _read("messages", "[]")
    messages = json.loads(raw)
    if isinstance(messages, str):
        messages = [m for m in raw.splitlines() if m.strip()]
except Exception:
    messages = []

lines = [f"# {title}", ""]
for index, message in enumerate(messages, start=1):
    lines.append(f"{index}. {message}")
lines.append("")

total_length = sum(len(str(message)) for message in messages)
summary = "\n".join(lines)

(out_dir / "summary.md").write_text(summary + "\n", encoding="utf-8")
print(summary)
print(f"count={len(messages)} total_length={total_length}")
PY

