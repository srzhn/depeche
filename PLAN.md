# Говорилка — план реализации

## Контекст

Самохостящаяся веб-«говорилка»: на VPS запускается приложение, друг заходит по адресу
(домену), попадает в комнату и общается голосом. Нужны: выбор имени, кнопка мута, шумодав
для комфортного звука, управление сервером скриптами (запуск/остановка/логи).

Согласованные вводные:
- **Размер группы:** 2–6 человек → P2P (WebRTC mesh), медиасервер не нужен.
- **Доступ:** через интернет по домену → нужен HTTPS (микрофон в браузере только в защищённом
  контексте) + TURN для обхода NAT.
- **Хостинг:** Linux-VPS → развёртывание через Docker Compose, управляющие скрипты на bash.

## Архитектура

Звук идёт напрямую между браузерами (P2P). Сервер участвует только в «знакомстве» пиров
(сигналинг) и раздаче TURN-кредов. Сам звук через наш сервер НЕ проходит.

```
   Браузер друга A                         Браузер друга B
        │  1) HTTPS: грузит страницу            │
        │  2) WSS: сигналинг (SDP/ICE)          │
        ▼                                       ▼
  ┌───────────────────────── VPS ─────────────────────────┐
  │  [Caddy]  ── авто-TLS (Let's Encrypt), :80/:443        │
  │     │ reverse_proxy → app                              │
  │  [app: Node + Express + ws]  — статика + сигналинг     │
  │  [coturn]  — STUN/TURN (:3478 + диапазон UDP)          │
  └───────────────────────────────────────────────────────┘
        ▲                                       ▲
        └───── 3) SRTP аудио P2P (напрямую ──────┘
               или через TURN-relay при строгом NAT)
```

## Стек

- **Backend:** Node.js 20 + Express (статика + `/healthz` + `/api/ice`) + `ws` (сигналинг на `/ws`).
- **Realtime:** нативный WebRTC (`RTCPeerConnection`), топология mesh, perfect negotiation.
- **Frontend:** ванильные HTML/CSS/JS без сборки.
- **Шумодав:** нативные constraints `getUserMedia` (уровень 1) + опц. RNNoise WASM (уровень 2, позже).
- **NAT/HTTPS:** coturn (STUN+TURN) + Caddy (авто-HTTPS по домену).
- **Деплой:** Docker + Docker Compose; bash-скрипты управления.

## Фазы

- **Фаза 0** — каркас: package.json, .gitignore, скелет папок.
- **Фаза 1** — сигналинг-сервер: `server/index.js`, `server/signaling.js`, `server/turn.js`.
- **Фаза 2** — фронт MVP: вход + WebRTC mesh (две вкладки слышат друг друга).
- **Фаза 3** — UI и фичи: мут, тумблер шумодава, список участников, индикатор речи, push-to-talk.
- **Фаза 4** — деплой: Dockerfile, docker-compose, Caddyfile, coturn, bash-скрипты, README.
- **Фаза 5** (позже) — RNNoise WASM, громкость по участнику, авто-реконнект пиров.

## Протокол сигналинга (WebSocket, JSON)

Клиент → сервер: `join{room,name}`, `signal{to,data}`, `rename{name}`, `state{muted}`, `leave`.
Сервер → клиент: `joined{selfId,peers[]}`, `peer-joined{id,name,muted}`, `peer-left{id}`,
`peer-renamed{id,name}`, `peer-state{id,muted}`, `signal{from,data}`.

Против glare: входящий участник инициирует offer к существующим; устойчивость — perfect negotiation
(polite = сравнение id).

## Что нужно для боевого запуска

- Домен + A-запись на IP VPS.
- Порты: `80`, `443`, `3478` TCP/UDP, диапазон UDP `49160–49200`.
- `.env` из `.env.example`: `DOMAIN`, `TURN_SECRET` (`openssl rand -hex 32`), `TURN_REALM`, `TURN_URLS`.

## Проверка

1. Локально: `npm install && npm run dev`, две вкладки `http://localhost:3000/?room=test`
   с разными именами → слышно друг друга (в наушниках), работают мут и шумодав.
2. Боевой: `./scripts/start.sh`, открыть `https://<домен>/?room=test` с телефона и ноутбука
   из разных сетей → есть звук (проверяет TURN).
3. Диагностика: `chrome://webrtc-internals`, `./scripts/logs.sh`.
