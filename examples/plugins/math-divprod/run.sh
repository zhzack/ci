#!/bin/sh
set -eu

python3 - <<'PY'
import json
from pathlib import Path

params = json.loads(Path("input.json").read_text())["params"]
a = float(params["a"])
b = float(params["b"])
c = float(params["c"])

product = a * b
quotient = product / c

Path("result.txt").write_text(
    f"a={a} b={b} c={c}\nproduct={product}\nquotient={quotient}\n",
    encoding="utf-8",
)

Path("output.json").write_text(
    json.dumps(
        {
            "status": "success",
            "message": f"Computed {a}*{b} and ({a}*{b})/{c}",
            "outputs": {
                "product": product,
                "quotient": quotient,
            },
            "artifacts": [{"name": "result.txt", "path": "result.txt"}],
        }
    ),
    encoding="utf-8",
)

print(f"product={product}")
print(f"quotient={quotient}")
PY
