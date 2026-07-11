import type { IceServer } from './types';

const FALLBACK: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

// Тянем конфиг ICE (STUN + коротко-живущий TURN) с сервера, с публичным фолбэком.
export async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const res = await fetch('/api/ice');
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      return data.iceServers as IceServer[];
    }
  } catch (err) {
    console.warn('[ice] не удалось получить конфиг, использую публичный STUN', err);
  }
  return FALLBACK;
}
