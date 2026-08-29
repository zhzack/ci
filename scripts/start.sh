#!/bin/sh
set -eu
# Apply pending schema migrations, then serve. SQLite dev databases are
# bootstrapped by create_all; Alembic is the source of truth for evolution.
if command -v alembic >/dev/null 2>&1; then
  alembic upgrade head || echo "alembic upgrade failed; continuing with create_all" >&2
fi
exec uvicorn mini_pipeline.server.app:app --host 0.0.0.0 --port 8000 "$@"
