import type { TranscriptParagraph } from './api';

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Read duration from file metadata. Resolves null when the browser can't tell. */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    el.preload = 'metadata';
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    el.src = url;
  });
}

const PEAK_DECODE_LIMIT_BYTES = 60 * 1024 * 1024;

/**
 * Compute `count` normalised peak values (0..1) for a waveform drawing.
 * Returns null for sources too large to decode comfortably in the browser.
 */
export async function computePeaks(source: string | Blob, count: number): Promise<number[] | null> {
  let data: ArrayBuffer;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > PEAK_DECODE_LIMIT_BYTES) return null;
    data = await res.arrayBuffer();
  } else {
    if (source.size > PEAK_DECODE_LIMIT_BYTES) return null;
    data = await source.arrayBuffer();
  }
  if (data.byteLength > PEAK_DECODE_LIMIT_BYTES) return null;

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(data);
    const channel = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / count));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < count; i++) {
      let peak = 0;
      const start = i * block;
      // Stride through the block; full scans are unnecessary for a thumbnail.
      for (let j = 0; j < block; j += 16) {
        const v = Math.abs(channel[start + j] || 0);
        if (v > peak) peak = v;
      }
      peaks.push(peak);
      if (peak > max) max = peak;
    }
    return peaks.map((p) => (max ? p / max : 0));
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
}

export function toSrt(paragraphs: TranscriptParagraph[]) {
  return paragraphs
    .map((p, i) => `${i + 1}\n${srtTime(p.start)} --> ${srtTime(p.end)}\n${p.text.trim()}\n`)
    .join('\n');
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Cloudinary: `fl_attachment` makes the browser download instead of opening a player. */
export function attachmentUrl(url: string, baseName: string) {
  const safe = baseName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'sonicpure';
  return url.includes('/upload/') ? url.replace('/upload/', `/upload/fl_attachment:${safe}_clean/`) : url;
}

export function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function vttTime(seconds: number) {
  return srtTime(seconds).replace(',', '.');
}

export function toVtt(segments: { start: number; end: number; text: string }[]) {
  return `WEBVTT\n\n${segments.map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text.trim()}\n`).join('\n')}`;
}
