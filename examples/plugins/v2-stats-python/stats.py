"""v2 Python plugin — uses the standard workspace layout.

The platform provides:
  workspace/input/   — resolved input files
  workspace/context.json — task metadata
  PIPELINE_WORKSPACE  env var

Plugin writes output to workspace/output/ and the platform collects it.
"""

import json
import math
import os
import sys
from pathlib import Path

WORKSPACE = Path(os.environ.get("PIPELINE_WORKSPACE", "."))
INPUT_DIR = WORKSPACE / "input"
OUTPUT_DIR = WORKSPACE / "output"


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Read input — numbers are written as JSON by the resource resolver
    numbers_path = INPUT_DIR / "numbers"
    if not numbers_path.exists():
        print("ERROR: input/numbers not found", file=sys.stderr)
        error = {"code": "INPUT_MISSING", "message": "numbers input is required"}
        (WORKSPACE / "error.json").write_text(json.dumps(error))
        return 1

    numbers = json.loads(numbers_path.read_text())
    if not isinstance(numbers, list):
        numbers = [numbers]

    precision_path = INPUT_DIR / "precision"
    precision = 2
    if precision_path.exists():
        try:
            precision = int(Path(precision_path.read_text().strip()).name or "2")
        except Exception:
            precision = 2

    values = [
        float(v) for v in numbers
        if isinstance(v, (int, float, str)) and str(v).replace(".", "", 1).lstrip("-").isdigit()
    ]
    if not values:
        print("ERROR: no valid numeric values", file=sys.stderr)
        (WORKSPACE / "error.json").write_text(json.dumps(
            {"code": "INPUT_EMPTY", "message": "numbers list is empty or invalid"}))
        return 1

    n = len(values)
    total = sum(values)
    mean = total / n
    variance = sum((x - mean) ** 2 for x in values) / (n - 1) if n > 1 else 0.0
    stdev = math.sqrt(variance)

    stats = {
        "count": n,
        "sum": round(total, precision),
        "avg": round(mean, precision),
        "min": round(min(values), precision),
        "max": round(max(values), precision),
        "stdev": round(stdev, precision),
    }

    (OUTPUT_DIR / "stats.json").write_text(json.dumps(stats, indent=2))
    (OUTPUT_DIR / "report.txt").write_text(
        f"Statistics Report\n"
        f"==================\n"
        f"Samples: {n}\n"
        f"Sum:     {stats['sum']}\n"
        f"Average: {stats['avg']}\n"
        f"Min:     {stats['min']}\n"
        f"Max:     {stats['max']}\n"
        f"StdDev:  {stats['stdev']}\n"
    )

    (WORKSPACE / "output" / "metadata.json").write_text(
        json.dumps({"version": "1.0", "tool": "v2-stats-python"})
    )

    print(f"stats: n={n} mean={mean:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
