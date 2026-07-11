FROM node:20-alpine

WORKDIR /app

# Сначала зависимости — чтобы кэшировался слой npm install.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# Затем код приложения.
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Простой healthcheck (в alpine есть busybox wget).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

USER node
CMD ["node", "server/index.js"]
