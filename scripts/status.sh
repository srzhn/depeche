#!/usr/bin/env bash
# Статус контейнеров.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose ps
