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

// Статика фронтенда.
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Всё остальное отдаём index.html — чтобы ссылки вида /?room=xxx работали.
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
attachSignaling(server);

server.listen(PORT, () => {
  console.log(`[depeche] слушаю http://localhost:${PORT}`);
});
