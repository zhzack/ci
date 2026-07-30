#!/bin/sh
set -eu
exec uvicorn mini_pipeline.server.app:app --host 0.0.0.0 --port 8000 "$@"
