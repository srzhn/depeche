import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignaling } from './signaling.js';
import { getIceServers } from './turn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.disable('x-powered-by');

// Проверка здоровья (для Docker/мониторинга).
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Конфиг ICE-серверов (STUN + коротко-живущий TURN-кред) для браузера.
app.get('/api/ice', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers: getIceServers() });
});

// Статика фронтенда. no-cache = браузер каждый раз сверяется с сервером (ETag),
// поэтому обновления кода подхватываются сразу, без застрявшего старого JS.
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Всё остальное отдаём index.html — чтобы ссылки вида /?room=xxx работали.
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
attachSignaling(server);

server.listen(PORT, () => {
  console.log(`[depeche] слушаю http://localhost:${PORT}`);
});
