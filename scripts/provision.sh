#!/usr/bin/env bash
# Полная идемпотентная подготовка сервера и запуск говорилки.
# Запускать НА СЕРВЕРЕ (Ubuntu/Debian) под root из корня репозитория:
#
#     ./scripts/provision.sh
#
# Делает всё сразу: swap, Docker, docker compose, .env (с генерацией TURN-секрета)
# и запуск контейнеров. Повторный запуск безопасен — уже сделанное пропускается.
#
# Необязательные переменные окружения:
#   DOMAIN=voice.example.com   свой домен (по умолчанию <публичный-IP>.sslip.io)
#   SWAP_SIZE=2G               размер swap; 0 — не создавать
set -euo pipefail

cd "$(dirname "$0")/.."

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти под root (или sudo)." >&2
  exit 1
fi

# ── 1. Базовые пакеты ────────────────────────────────────────────────
if command -v apt-get >/dev/null 2>&1; then
  log "Базовые пакеты (curl, git, openssl)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git openssl ca-certificates >/dev/null
fi

# ── 2. Docker ────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "Docker уже есть: $(docker --version)"
else
  log "Ставлю Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ── 3. docker compose plugin ─────────────────────────────────────────
if docker compose version >/dev/null 2>&1; then
  log "compose уже есть: $(docker compose version | head -1)"
else
  log "Ставлю docker compose plugin"
  arch="$(uname -m)"
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-${arch}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

# ── 4. Swap (важно на серверах с малым ОЗУ) ──────────────────────────
SWAP_SIZE="${SWAP_SIZE:-2G}"
if [ "$SWAP_SIZE" = "0" ]; then
  log "Swap отключён (SWAP_SIZE=0)"
elif swapon --show | grep -q '/swapfile'; then
  log "Swap уже есть"
else
  log "Создаю swap $SWAP_SIZE"
  fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || \
    dd if=/dev/zero of=/swapfile bs=1M count=$(( ${SWAP_SIZE%G} * 1024 )) status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# ── 5. .env ──────────────────────────────────────────────────────────
if [ -f .env ]; then
  log ".env уже существует — не трогаю"
else
  log "Создаю .env"
  pubip="$(curl -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
  domain="${DOMAIN:-${pubip}.sslip.io}"
  secret="$(openssl rand -hex 32)"
  cat > .env <<EOF
DOMAIN=${domain}
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=turn:${pubip}:3478
TURN_REALM=${domain}
TURN_SECRET=${secret}
TURN_TTL=86400
EXTERNAL_IP=${pubip}
PORT=3000
EOF
  chmod 600 .env
  echo "    DOMAIN=${domain}  (публичный IP: ${pubip})"
fi

# ── 6. Сборка и запуск ───────────────────────────────────────────────
log "Собираю образ и запускаю контейнеры"
chmod +x scripts/*.sh
docker compose up -d --build

log "Статус контейнеров:"
docker compose ps

domain_line="$(grep '^DOMAIN=' .env | cut -d= -f2)"
printf '\n\033[1;32mГотово. Открывай: https://%s/\033[0m\n' "$domain_line"
