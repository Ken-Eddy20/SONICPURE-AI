import { ID3Writer } from 'browser-id3-writer';
import { renderRange, totalLength, type EditState } from './audioEdit';

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  composer: string;
  genre: string;
  year: string;
  track: string;
  comment: string;
  /** JPEG or PNG bytes for the cover. */
  cover?: { data: ArrayBuffer; mime: string } | null;
}

export const EMPTY_METADATA: AudioMetadata = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  composer: '',
  genre: 'Gospel',
  year: String(new Date().getFullYear()),
  track: '',
  comment: '',
  cover: null,
};

const WINDOW_SECONDS = 300;

function bitrateFor(sampleRate: number, channels: number) {
  if (sampleRate >= 44100) return channels > 1 ? 160 : 128;
  if (sampleRate >= 22050) return 64;
  return 48;
}

/** Render the edited timeline and encode it as MP3 in a worker. */
export async function encodeMp3(source: AudioBuffer, state: EditState, onProgress: (fraction: number) => void): Promise<ArrayBuffer> {
  const duration = totalLength(state);
  const channels = Math.min(2, source.numberOfChannels);
  const sampleRate = source.sampleRate;
  const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });

  try {
    worker.postMessage({ type: 'init', channels, sampleRate, kbps: bitrateFor(sampleRate, channels) });
    const windows = Math.max(1, Math.ceil(duration / WINDOW_SECONDS));
    for (let w = 0; w < windows; w++) {
      const from = w * WINDOW_SECONDS;
      const to = Math.min(duration, from + WINDOW_SECONDS);
      const data = await renderRange(source, state, from, to, sampleRate);
      const left = data[0].slice();
      const right = channels > 1 ? data[1].slice() : undefined;
      // Wait for the worker to finish each window so memory stays at one window at a time.
      await new Promise<void>((resolve) => {
        const onMsg = (e: MessageEvent) => {
          if (e.data.type === 'progress') {
            worker.removeEventListener('message', onMsg);
            resolve();
          }
        };
        worker.addEventListener('message', onMsg);
        worker.postMessage({ type: 'chunk', left, right }, right ? [left.buffer, right.buffer] : [left.buffer]);
      });
      onProgress((w + 1) / windows);
    }
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (e) => e.data.type === 'done' && resolve(e.data.mp3 as ArrayBuffer);
      worker.onerror = (e) => reject(new Error(e.message || 'MP3 encoding failed'));
      worker.postMessage({ type: 'end' });
    });
  } finally {
    worker.terminate();
  }
}

/** Write ID3v2 tags (title, album, composer, cover art…) into an MP3. */
export function tagMp3(mp3: ArrayBuffer, meta: AudioMetadata): Blob {
  const writer = new ID3Writer(mp3);
  if (meta.title) writer.setFrame('TIT2', meta.title);
  if (meta.artist) writer.setFrame('TPE1', [meta.artist]);
  if (meta.albumArtist) writer.setFrame('TPE2', meta.albumArtist);
  if (meta.album) writer.setFrame('TALB', meta.album);
  if (meta.composer) writer.setFrame('TCOM', [meta.composer]);
  if (meta.genre) writer.setFrame('TCON', [meta.genre]);
  if (/^\d{4}$/.test(meta.year)) writer.setFrame('TYER', Number(meta.year));
  if (meta.track) writer.setFrame('TRCK', meta.track);
  if (meta.comment) writer.setFrame('COMM', { description: '', text: meta.comment, language: 'eng' });
  if (meta.cover) writer.setFrame('APIC', { type: 3, data: meta.cover.data, description: 'Cover' });
  writer.addTag();
  return writer.getBlob();
}

/** Shrink a chosen picture to a square JPEG (players expect square covers; big images bloat the MP3). */
export async function prepareCover(file: File, size = 1000): Promise<{ data: ArrayBuffer; mime: string; url: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(size, side);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image'))), 'image/jpeg', 0.88),
  );
  return { data: await blob.arrayBuffer(), mime: 'image/jpeg', url: URL.createObjectURL(blob) };
}

export function safeFileName(name: string) {
  return (name || 'recording').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'recording';
}
