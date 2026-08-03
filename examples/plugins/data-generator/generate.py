"""
v2 data-generator — Python runtime plugin.

Reads parameters from workspace/input/* (resolved by the platform),
writes outputs to workspace/output/, and exits with code 0 on success.
"""
import json
import os
import random
import sys
import time
from pathlib import Path

WORK = Path(os.environ.get("PIPELINE_WORKSPACE", "."))
INPUT_DIR = WORK / "input"
OUTPUT_DIR = WORK / "output"


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Read parameters (resolved by platform from pipeline params / run body)
    count = int(_read_param("count", 10))
    min_val = float(_read_param("min_val", 0))
    max_val = float(_read_param("max_val", 100))

    print(f"Generating {count} random numbers in [{min_val}, {max_val}]")

    random.seed(int(time.time() * 1_000_000) % (2**31))
    values = [round(random.uniform(min_val, max_val), 2) for _ in range(count)]

    # Artifact 1: dataset
    dataset = {
        "values": values,
        "count": count,
        "min_val": min_val,
        "max_val": max_val,
    }
    (OUTPUT_DIR / "dataset.json").write_text(
        json.dumps(dataset, indent=2), encoding="utf-8"
    )

    # Artifact 2: metadata
    meta = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": count,
        "range": [min_val, max_val],
        "seed_approx": time.time(),
    }
    (OUTPUT_DIR / "metadata.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )

    print(f"Generated {count} values: {values[:5]}{'...' if count > 5 else ''}")
    return 0


def _read_param(name: str, default: str | float | int) -> str:
    path = INPUT_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return str(default)


if __name__ == "__main__":
    sys.exit(main())
