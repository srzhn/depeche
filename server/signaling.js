import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

// Сигналинг для WebRTC-mesh. Сервер НЕ пропускает через себя звук —
// только знакомит пиров и пересылает SDP/ICE. Комнаты живут в памяти.
//
// rooms: Map<roomName, Map<peerId, { ws, name, muted }>>
const rooms = new Map();

const MAX_NAME = 32;
const MAX_ROOM = 64;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sanitizeName(name) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return clean || 'Аноним';
}

function sanitizeRoom(room) {
  return String(room ?? '').trim().slice(0, MAX_ROOM) || 'lobby';
}

export function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID();
    ws.room = null;
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      handle(ws, msg);
    });
    ws.on('close', () => leave(ws));
    ws.on('error', () => leave(ws));
  });

  // Пинги, чтобы выкидывать «мёртвые» соединения.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  return wss;
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'join': return join(ws, msg);
    case 'signal': return relay(ws, msg);
    case 'rename': return rename(ws, msg);
    case 'state': return updateState(ws, msg);
    case 'leave': return leave(ws);
    default: /* ignore */
  }
}

function join(ws, { room, name }) {
  if (ws.room) leave(ws); // на случай повторного join после реконнекта
  room = sanitizeRoom(room);
  ws.room = room;
  ws.name = sanitizeName(name);
  ws.muted = false;

  if (!rooms.has(room)) rooms.set(room, new Map());
  const peers = rooms.get(room);

  // Кто уже в комнате — отдаём новичку.
  const existing = [...peers.entries()].map(([id, p]) => ({ id, name: p.name, muted: p.muted }));
  peers.set(ws.id, { ws, name: ws.name, muted: false });
  send(ws, { type: 'joined', selfId: ws.id, peers: existing });

  // Остальным — что кто-то зашёл.
  for (const [id, p] of peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-joined', id: ws.id, name: ws.name, muted: false });
  }
}

function relay(ws, { to, data }) {
  if (!ws.room || !to || data == null) return;
  const peers = rooms.get(ws.room);
  const target = peers && peers.get(to);
  if (!target) return;
  send(target.ws, { type: 'signal', from: ws.id, data });
}

function rename(ws, { name }) {
  if (!ws.room) return;
  ws.name = sanitizeName(name);
  const peers = rooms.get(ws.room);
  if (!peers) return;
  const me = peers.get(ws.id);
  if (me) me.name = ws.name;
  for (const [id, p] of peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-renamed', id: ws.id, name: ws.name });
  }
}

function updateState(ws, { muted }) {
  if (!ws.room) return;
  const peers = rooms.get(ws.room);
  if (!peers) return;
  const me = peers.get(ws.id);
  if (me) me.muted = !!muted;
  for (const [id, p] of peers) {
    if (id !== ws.id) send(p.ws, { type: 'peer-state', id: ws.id, muted: !!muted });
  }
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const peers = rooms.get(room);
  if (!peers) return;
  peers.delete(ws.id);
  if (peers.size === 0) { rooms.delete(room); return; }
  for (const [, p] of peers) send(p.ws, { type: 'peer-left', id: ws.id });
}
