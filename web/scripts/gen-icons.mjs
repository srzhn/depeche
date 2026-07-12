// Генерация PNG-иконок PWA из icon.svg (запускается перед vite build).
// Никогда не роняет сборку: при ошибке просто пропускает (остаётся SVG-фолбэк в манифесте).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
try {
  const sharp = (await import('sharp')).default;
  const svg = readFileSync(join(pub, 'icon.svg'));
  const targets = [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ];
  for (const [name, size] of targets) {
    await sharp(svg).resize(size, size).png().toFile(join(pub, name));
    console.log('[icons] сгенерировал', name);
  }
} catch (e) {
  console.warn('[icons] генерация PNG пропущена:', (e && e.message) || e);
}
process.exit(0);
