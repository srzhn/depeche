#!/usr/bin/env bash
# Быстрый перезапуск без пересборки образа.
# (После изменения кода используй ./scripts/start.sh — он пересоберёт.)
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose restart "$@"
docker compose ps
