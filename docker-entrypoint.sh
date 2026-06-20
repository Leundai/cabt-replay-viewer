#!/bin/sh
set -e

data_dir="${CABT_DATA_DIR:-/data}"
mkdir -p "$data_dir"
chown -R app:app "$data_dir" 2>/dev/null || true

exec su app -s /bin/sh -c "python -m uvicorn api.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"
