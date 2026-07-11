import crypto from 'node:crypto';

// Формируем список ICE-серверов для браузера:
//  - STUN (публичные + при желании наш coturn),
//  - TURN с коротко-живущими кредами по схеме coturn `use-auth-secret`.
//
// Схема REST/`use-auth-secret`: username = <unix-время-истечения>,
// credential = base64(HMAC-SHA1(TURN_SECRET, username)). Секрет целиком
// в браузер не попадает, кред живёт ограниченное время.

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getIceServers() {
  const iceServers = [];

  const stun = splitUrls(process.env.STUN_URLS) ;
  iceServers.push({ urls: stun.length ? stun : [DEFAULT_STUN] });

  const turnUrls = splitUrls(process.env.TURN_URLS);
  const secret = process.env.TURN_SECRET;
  if (turnUrls.length && secret) {
    const ttl = parseInt(process.env.TURN_TTL || '86400', 10) || 86400;
    const username = String(Math.floor(Date.now() / 1000) + ttl);
    const credential = crypto
      .createHmac('sha1', secret)
      .update(username)
      .digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }

  return iceServers;
}
