#!/bin/sh
set -eu

python3 - <<'PY'
import json
import random
from pathlib import Path

payload = json.loads(Path("input.json").read_text())
params = payload.get("params", {})

greeting = params.get("greeting", "Hello")
seed = int(params.get("seed", 42))

random.seed(seed)
phrases = [
    "Pipeline is humming along.",
    "Your task landed safely on disk.",
    "Artifacts uploaded to the managed store.",
    "Logs are streaming in real time.",
    "Mini Pipeline says hi from the shell runtime.",
]
tail = random.choice(phrases)

message = f"{greeting}! {tail}"
Path("greeting.txt").write_text(message + "\n", encoding="utf-8")
word_count = len(message.split())

Path("output.json").write_text(
    json.dumps(
        {
            "status": "success",
            "message": "Greeting generated",
            "outputs": {"message": message, "word_count": word_count},
            "artifacts": [{"name": "greeting.txt", "path": "greeting.txt"}],
        },
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print(message)
print(f"words={word_count}")
PY
