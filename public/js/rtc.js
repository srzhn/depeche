// WebRTC-mesh: на каждого участника — своё RTCPeerConnection.
// Согласование по паттерну «perfect negotiation» (устойчиво к одновременным
// офферам). Кто «вежливый» в паре — определяем детерминированно по id.

export class Mesh {
  constructor({ signaling, getLocalStream, iceServers, onPeerStream, onPeerConnectionState }) {
    this.signaling = signaling;
    this.getLocalStream = getLocalStream; // () => MediaStream | null
    this.iceServers = iceServers || [];
    this.onPeerStream = onPeerStream || (() => {});
    this.onPeerConnectionState = onPeerConnectionState || (() => {});
    this.selfId = null;
    this.peers = new Map(); // peerId -> { pc, makingOffer, ignoreOffer, polite }
  }

  setSelfId(id) { this.selfId = id; }

  connect(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    // В паре ровно один «вежливый» — сравниваем строковые id.
    const polite = String(this.selfId) > String(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const state = { pc, makingOffer: false, ignoreOffer: false, polite };
    this.peers.set(peerId, state);

    const stream = this.getLocalStream();
    if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.send({ type: 'signal', to: peerId, data: { description: pc.localDescription } });
      } catch (err) {
        console.error('[rtc] negotiationneeded', err);
      } finally {
        state.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signaling.send({ type: 'signal', to: peerId, data: { candidate } });
    };

    pc.ontrack = ({ streams }) => {
      if (streams && streams[0]) this.onPeerStream(peerId, streams[0]);
    };

    pc.onconnectionstatechange = () => {
      this.onPeerConnectionState(peerId, pc.connectionState);
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch { /* ignore */ }
      }
    };

    return state;
  }

  async handleSignal(from, { description, candidate } = {}) {
    const state = this.peers.get(from) || this.connect(from);
    const pc = state.pc;
    try {
      if (description) {
        const collision =
          description.type === 'offer' &&
          (state.makingOffer || pc.signalingState !== 'stable');
        state.ignoreOffer = !state.polite && collision;
        if (state.ignoreOffer) return;

        await pc.setRemoteDescription(description); // при коллизии у «вежливого» — неявный rollback
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.signaling.send({ type: 'signal', to: from, data: { description: pc.localDescription } });
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
  replaceAudioTrack(track) {
    for (const { pc } of this.peers.values()) {
      const sender =
        pc.getSenders().find((s) => s.track && s.track.kind === 'audio') ||
        pc.getSenders().find((s) => !s.track);
      if (sender) sender.replaceTrack(track).catch((e) => console.error('[rtc] replaceTrack', e));
    }
  }

  disconnect(peerId) {
    const state = this.peers.get(peerId);
    if (!state) return;
    try { state.pc.close(); } catch { /* ignore */ }
    this.peers.delete(peerId);
  }

  reset() {
    for (const id of [...this.peers.keys()]) this.disconnect(id);
  }
}
