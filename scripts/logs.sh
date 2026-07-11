#!/usr/bin/env bash
# Логи всех сервисов (или одного: ./scripts/logs.sh coturn).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose logs -f --tail=100 "$@"
