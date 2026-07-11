#!/usr/bin/env bash
# Собрать образ и запустить всё в фоне.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Нет .env. Сначала запусти ./scripts/setup.sh и заполни его." >&2
  exit 1
fi

docker compose up -d --build
echo
docker compose ps
