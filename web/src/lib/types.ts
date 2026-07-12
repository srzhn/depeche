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

export interface Occupant {
  id: string;
  name: string;
}

export interface RoomSummary {
  name: string;
  isDefault: boolean;
  locked: boolean;
  full: boolean;
  count?: number;          // нет у комнаты с паролем
  occupants?: Occupant[];  // нет у комнаты с паролем
}

export interface ChatMsg {
  id: string;
  name: string;
  text: string;
  ts: number;
}

// Сообщения сервер → клиент.
export type ServerMessage =
  | { type: 'rooms'; rooms: RoomSummary[]; canCreate: boolean; maxPeers: number }
  | { type: 'joined'; selfId: string; room: string; locked: boolean; peers: PeerInfo[] }
  | { type: 'peer-joined'; id: string; name: string; muted: boolean }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-renamed'; id: string; name: string }
  | { type: 'peer-state'; id: string; muted: boolean }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'chat'; id: string; name: string; text: string; ts: number }
  | { type: 'chat-history'; messages: ChatMsg[] }
  | { type: 'join-denied'; reason: 'gone' | 'password' | 'full'; room: string }
  | { type: 'create-denied'; reason: 'exists' | 'limit' };

// Сообщения клиент → сервер.
export type ClientMessage =
  | { type: 'list' }
  | { type: 'create'; room: string; name: string; password?: string }
  | { type: 'join'; room: string; name: string; password?: string }
  | { type: 'leave' }
  | { type: 'signal'; to: string; data: SignalData }
  | { type: 'rename'; name: string }
  | { type: 'state'; muted: boolean }
  | { type: 'chat'; text: string };
