export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface PeerInfo {
  id: string;
  name: string;
  muted: boolean;
}

export interface SignalData {
  description?: RTCSessionDescriptionInit | null;
  candidate?: RTCIceCandidateInit;
}

// Сообщения сервер → клиент.
export type ServerMessage =
  | { type: 'joined'; selfId: string; peers: PeerInfo[] }
  | { type: 'peer-joined'; id: string; name: string; muted: boolean }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-renamed'; id: string; name: string }
  | { type: 'peer-state'; id: string; muted: boolean }
  | { type: 'signal'; from: string; data: SignalData };

// Сообщения клиент → сервер.
export type ClientMessage =
  | { type: 'join'; room: string; name: string }
  | { type: 'signal'; to: string; data: SignalData }
  | { type: 'rename'; name: string }
  | { type: 'state'; muted: boolean }
  | { type: 'leave' };
