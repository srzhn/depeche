// RNNoise (нейросетевой шумодав) как AudioWorklet. Загружается по требованию (opt-in).
// Всё считается в браузере; при ошибке загрузки вызывающий код мягко откатывается.
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';

let wasmBinary: ArrayBuffer | null = null;
const registered = new WeakSet<AudioContext>();

export async function createRnnoiseNode(ctx: AudioContext): Promise<AudioNode> {
  if (!wasmBinary) wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath });
  if (!registered.has(ctx)) {
    await ctx.audioWorklet.addModule(rnnoiseWorkletPath);
    registered.add(ctx);
  }
  return new RnnoiseWorkletNode(ctx, { wasmBinary }) as unknown as AudioNode;
}
