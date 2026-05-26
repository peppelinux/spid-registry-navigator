#!/usr/bin/env sh
# Serve la SPA già compilata (solo file statici, senza Node/npm in runtime).
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$ROOT/dist/index.html" ]; then
  echo "Manca dist/index.html — esegui prima: npm run build" >&2
  exit 1
fi
PORT="${1:-8080}"
exec python3 "$ROOT/serve-root.py" "$PORT"
