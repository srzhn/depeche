#!/usr/bin/env bash
# Первичная настройка: создаёт .env из шаблона и проверяет наличие Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ Создан .env из .env.example."
  echo "  Открой его и заполни DOMAIN, TURN_URLS, TURN_REALM."
  echo "  Сгенерируй TURN_SECRET:  openssl rand -hex 32"
else
  echo "→ .env уже существует — не трогаю."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "⚠  Docker не найден. Установи Docker и плагин compose."
elif ! docker compose version >/dev/null 2>&1; then
  echo "⚠  Не найден 'docker compose' (v2). Установи Docker Compose plugin."
else
  echo "→ Docker и compose на месте."
fi

echo "Готово. Дальше:  ./scripts/start.sh"
