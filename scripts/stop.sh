#!/usr/bin/env bash
# Остановить и удалить контейнеры (данные Caddy в volume сохраняются).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down
echo "→ Остановлено."
