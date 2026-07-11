import type { ClientMessage, IceServer, SignalData } from './types';

// WebRTC-mesh: на каждого участника — своё RTCPeerConnection.
// Согласование по паттерну «perfect negotiation» (устойчиво к одновременным офферам).

interface PeerState {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
}

interface MeshOptions {
  signaling: { send: (m: ClientMessage) => void };
  getLocalStream: () => MediaStream | null;
  iceServers: IceServer[];
  onPeerStream: (peerId: string, stream: MediaStream) => void;
  onPeerConnState?: (peerId: string, state: RTCPeerConnectionState) => void;
}

export class Mesh {
  private peers = new Map<string, PeerState>();
  selfId: string | null = null;

  constructor(private opts: MeshOptions) {}

  setSelfId(id: string): void { this.selfId = id; }

  connect(peerId: string): PeerState {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    // В паре ровно один «вежливый» — сравниваем строковые id.
    const polite = String(this.selfId) > String(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers as RTCIceServer[] });
    const state: PeerState = { pc, makingOffer: false, ignoreOffer: false, polite };
    this.peers.set(peerId, state);

    const stream = this.opts.getLocalStream();
    if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        this.opts.signaling.send({ type: 'signal', to: peerId, data: { description: pc.localDescription } });
      } catch (err) {
        console.error('[rtc] negotiationneeded', err);
      } finally {
        state.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.opts.signaling.send({ type: 'signal', to: peerId, data: { candidate: candidate.toJSON() } });
    };

    pc.ontrack = ({ streams }) => {
      if (streams[0]) this.opts.onPeerStream(peerId, streams[0]);
    };

    pc.onconnectionstatechange = () => {
      this.opts.onPeerConnState?.(peerId, pc.connectionState);
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
    };

    return state;
  }

  async handleSignal(from: string, data: SignalData = {}): Promise<void> {
    const state = this.peers.get(from) ?? this.connect(from);
    const pc = state.pc;
    const { description, candidate } = data;
    try {
      if (description) {
        const collision = description.type === 'offer' && (state.makingOffer || pc.signalingState !== 'stable');
        state.ignoreOffer = !state.polite && collision;
        if (state.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.opts.signaling.send({ type: 'signal', to: from, data: { description: pc.localDescription } });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); }
        catch (err) { if (!state.ignoreOffer) console.error('[rtc] addIceCandidate', err); }
      }
    } catch (err) {
      console.error('[rtc] handleSignal', err);
    }
  }

  // Заменить исходящий аудио-трек во всех соединениях (переключение шумодава).
  replaceAudioTrack(track: MediaStreamTrack): void {
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio')
        ?? pc.getSenders().find((s) => !s.track);
      if (sender) sender.replaceTrack(track).catch((e) => console.error('[rtc] replaceTrack', e));
    }
  }

  disconnect(peerId: string): void {
    const state = this.peers.get(peerId);
    if (!state) return;
    try { state.pc.close(); } catch { /* ignore */ }
    this.peers.delete(peerId);
  }

  reset(): void {
    for (const id of [...this.peers.keys()]) this.disconnect(id);
  }
}
