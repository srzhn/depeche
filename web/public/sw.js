// Минимальный service worker: включает установку приложения (PWA) на телефон,
// но НЕ кэширует агрессивно — чтобы обновления всегда подхватывались.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Сквозной обработчик: наличие fetch-хендлера нужно для установки PWA,
// сами запросы отдаём браузеру как есть (без кэша).
self.addEventListener('fetch', () => { /* passthrough */ });
