/// <reference lib="webworker" />
// MP3 encoding off the main thread, fed in windows so long recordings never need one giant buffer.
import { Mp3Encoder } from '@breezystack/lamejs';

let encoder: Mp3Encoder | null = null;
let channels = 1;
const parts: Uint8Array[] = [];
const BLOCK = 1152 * 20;

function toInt16(f: Float32Array) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = f[i] > 1 ? 1 : f[i] < -1 ? -1 : f[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'init') {
    channels = msg.channels;
    encoder = new Mp3Encoder(channels, msg.sampleRate, msg.kbps);
    parts.length = 0;
    return;
  }
  if (msg.type === 'chunk' && encoder) {
    const left = toInt16(msg.left as Float32Array);
    const right = channels > 1 ? toInt16(msg.right as Float32Array) : undefined;
    for (let i = 0; i < left.length; i += BLOCK) {
      const buf = encoder.encodeBuffer(left.subarray(i, i + BLOCK), right?.subarray(i, i + BLOCK));
      if (buf.length) parts.push(new Uint8Array(buf));
    }
    (self as unknown as Worker).postMessage({ type: 'progress' });
    return;
  }
  if (msg.type === 'end' && encoder) {
    const tail = encoder.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    parts.length = 0;
    encoder = null;
    (self as unknown as Worker).postMessage({ type: 'done', mp3: out.buffer }, [out.buffer]);
  }
};
