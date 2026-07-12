#!/usr/bin/env bash
# Обновить до последней версии из git и пересобрать/перезапустить контейнеры.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠  В рабочем дереве есть незакоммиченные изменения — прерываю, чтобы их не потерять." >&2
  git status --short >&2
  exit 1
fi

echo "==> Текущая версия: $(git log --oneline -1)"
echo "==> Тяну изменения"
git pull --ff-only
echo "==> Новая версия: $(git log --oneline -1)"

echo "==> Пересобираю и перезапускаю"
./scripts/start.sh
