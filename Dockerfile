# ── Стадия 1: сборка фронтенда (Vite + React + TS) ──
# Debian-образ (glibc) — чтобы не ловить проблемы rollup/esbuild с musl на alpine.
FROM node:20 AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ── Стадия 2: рантайм (Node-сигналинг + собранная статика) ──
FROM node:20-alpine
WORKDIR /app

# Зависимости сервера (кэшируемый слой).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Код сервера и собранный фронт (dist → public, сервер отдаёт его как есть).
COPY server ./server
COPY --from=webbuild /web/dist ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

USER node
CMD ["node", "server/index.js"]
