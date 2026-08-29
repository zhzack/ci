#!/bin/sh
# Full local verification: backend lint + tests, then frontend checks.
# No CI/CD exists in this repo — run this before every commit.
set -eu
cd "$(dirname "$0")/.."

echo "==> ruff check"
.venv/bin/python -m ruff check . 2>/dev/null || .venv/Scripts/python -m ruff check .

echo "==> pytest"
if [ -x .venv/bin/pytest ]; then PY=.venv/bin/python; else PY=.venv/Scripts/python; fi
MINI_PIPELINE_CONFIG=config/default.yaml "$PY" -m pytest -q

if [ -d frontend/node_modules ]; then
  echo "==> frontend typecheck"
  (cd frontend && npm run typecheck)
  echo "==> frontend lint"
  (cd frontend && npm run lint)
  echo "==> frontend build"
  (cd frontend && npm run build)
else
  echo "==> skipping frontend checks (frontend/node_modules missing)"
fi

echo "==> all checks passed"
