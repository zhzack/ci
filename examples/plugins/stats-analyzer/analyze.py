"""
v2 stats-analyzer — Python runtime plugin.

Reads a JSON artifact from an upstream step (via workspace/input/),
computes descriptive statistics, and generates a formatted report.
"""
import json
import math
import os
import sys
from pathlib import Path

WORK = Path(os.environ.get("PIPELINE_WORKSPACE", "."))
INPUT_DIR = WORK / "input"
OUTPUT_DIR = WORK / "output"


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Read upstream artifact — placed at workspace/input/<contract.target>
    # The contract declares target: upstream/dataset.json so we look there
    # first, then fall back to legacy input/dataset.
    dataset_path = INPUT_DIR / "upstream" / "dataset.json"
    if not dataset_path.exists():
        dataset_path = INPUT_DIR / "dataset"
    if not dataset_path.exists():
        print("ERROR: dataset artifact not found — check artifact wiring", file=sys.stderr)
        return 1

    try:
        data = json.loads(dataset_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"ERROR: Cannot parse dataset: {exc}", file=sys.stderr)
        (WORK / "error.json").write_text(
            json.dumps({"code": "PARSE_ERROR", "message": str(exc)})
        )
        return 1

    values = data.get("values", [])
    if not values:
        print("ERROR: Dataset is empty", file=sys.stderr)
        return 1

    # Compute statistics
    n = len(values)
    total = sum(values)
    mean = total / n
    sorted_vals = sorted(values)

    if n % 2 == 1:
        median = sorted_vals[n // 2]
    else:
        median = (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2

    variance = sum((x - mean) ** 2 for x in values) / (n - 1) if n > 1 else 0.0
    stdev = math.sqrt(variance)

    stats = {
        "count": n,
        "sum": round(total, 2),
        "mean": round(mean, 2),
        "median": round(median, 2),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "stdev": round(stdev, 2),
    }

    # Read title from input/ directory (parameter source)
    title = "Statistical Analysis Report"
    title_path = INPUT_DIR / "title"
    if title_path.exists():
        title = title_path.read_text(encoding="utf-8").strip()

    # Generate Markdown report
    report_lines = [
        f"# {title}",
        "",
        f"*Generated from {n} samples*",
        "",
        "| Metric  | Value  |",
        "|---------|--------|",
        f"| Count   | {stats['count']} |",
        f"| Sum     | {stats['sum']} |",
        f"| Mean    | {stats['mean']} |",
        f"| Median  | {stats['median']} |",
        f"| Min     | {stats['min']} |",
        f"| Max     | {stats['max']} |",
        f"| Std Dev | {stats['stdev']} |",
        "",
    ]
    report = "\n".join(report_lines)
    (OUTPUT_DIR / "report.md").write_text(report + "\n", encoding="utf-8")
    (OUTPUT_DIR / "summary.json").write_text(
        json.dumps(stats, indent=2), encoding="utf-8"
    )

    print(f"Analyzed {n} values: mean={mean:.2f} median={median:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
