/**
 * Non-destructive audio editing.
 *
 * The recording is decoded once into `sources[0]`. Intros, outros and inserted files are
 * decoded once into further sources. The edited audio is a list of clips that point into a
 * source (or are silence), each with a linear gain ramp g0 → g1. Crop, cut, insert, volume,
 * fades and mute only rewrite this small list, so undo/redo is instant and memory stays
 * flat even for multi-hour recordings.
 */

export interface Clip {
  /** Index of the source buffer (0 = the main recording). */
  src?: number;
  /** Start/end inside the source buffer, in seconds. Ignored for silence. */
  srcStart: number;
  srcEnd: number;
  /** Silence clip of this length instead of source audio. */
  silence?: number;
  /** Gain at the clip's start and end (linear, 1 = unchanged). */
  g0: number;
  g1: number;
}

export interface EditState {
  clips: Clip[];
}

export const clipLength = (c: Clip) => (c.silence !== undefined ? c.silence : c.srcEnd - c.srcStart);
export const totalLength = (s: EditState) => s.clips.reduce((t, c) => t + clipLength(c), 0);

export function initialState(source: AudioBuffer): EditState {
  return { clips: [{ srcStart: 0, srcEnd: source.duration, g0: 1, g1: 1 }] };
}

const EPS = 1e-4;

/** Split the clip under time t so a clip boundary sits exactly at t. */
function splitAt(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  let pos = 0;
  for (const c of clips) {
    const len = clipLength(c);
    if (t > pos + EPS && t < pos + len - EPS) {
      const f = (t - pos) / len;
      const gMid = c.g0 + (c.g1 - c.g0) * f;
      if (c.silence !== undefined) {
        out.push({ ...c, silence: t - pos, g1: gMid }, { ...c, silence: pos + len - t, g0: gMid });
      } else {
        const cut = c.srcStart + (t - pos);
        out.push({ ...c, srcEnd: cut, g1: gMid }, { ...c, srcStart: cut, g0: gMid });
      }
    } else {
      out.push({ ...c });
    }
    pos += len;
  }
  return out;
}

/** Split at a and b, then call fn(clip, clipStart, clipEnd) for clips fully inside [a, b]. */
function mapRange(state: EditState, a: number, b: number, fn: (c: Clip, start: number, end: number) => Clip | null): EditState {
  const clips = splitAt(splitAt(state.clips, a), b);
  const out: Clip[] = [];
  let pos = 0;
  for (const c of clips) {
    const len = clipLength(c);
    const inside = pos >= a - EPS && pos + len <= b + EPS;
    const mapped = inside ? fn(c, pos, pos + len) : c;
    if (mapped && clipLength(mapped) > EPS) out.push(mapped);
    pos += len;
  }
  return { clips: out };
}

export const cut = (s: EditState, a: number, b: number) => mapRange(s, a, b, () => null);

export function crop(s: EditState, a: number, b: number): EditState {
  const len = totalLength(s);
  return cut(cut(s, b, len), 0, a);
}

/** Multiply volume in [a, b] by a factor (e.g. 10^(dB/20)). */
export const changeGain = (s: EditState, a: number, b: number, factor: number) =>
  mapRange(s, a, b, (c) => ({ ...c, g0: c.g0 * factor, g1: c.g1 * factor }));

export const mute = (s: EditState, a: number, b: number) => mapRange(s, a, b, (c) => ({ ...c, g0: 0, g1: 0 }));

export const fadeIn = (s: EditState, a: number, b: number) =>
  mapRange(s, a, b, (c, start, end) => ({
    ...c,
    g0: c.g0 * ((start - a) / (b - a)),
    g1: c.g1 * ((end - a) / (b - a)),
  }));

export const fadeOut = (s: EditState, a: number, b: number) =>
  mapRange(s, a, b, (c, start, end) => ({
    ...c,
    g0: c.g0 * (1 - (start - a) / (b - a)),
    g1: c.g1 * (1 - (end - a) / (b - a)),
  }));

/** Put a clip in at time `at` (0 = the very start, totalLength = the end). */
function insertClip(s: EditState, at: number, clip: Clip): EditState {
  const clips = splitAt(s.clips, at);
  const out: Clip[] = [];
  let pos = 0;
  let inserted = false;
  for (const c of clips) {
    if (!inserted && pos >= at - EPS) {
      out.push(clip);
      inserted = true;
    }
    out.push(c);
    pos += clipLength(c);
  }
  if (!inserted) out.push(clip);
  return { clips: out };
}

export const insertSilence = (s: EditState, at: number, seconds: number) =>
  insertClip(s, at, { srcStart: 0, srcEnd: 0, silence: seconds, g0: 1, g1: 1 });

/** Insert the whole of source `src` (an intro, outro or other file) at time `at`. */
export const insertAudio = (s: EditState, at: number, src: number, seconds: number) =>
  insertClip(s, at, { src, srcStart: 0, srcEnd: seconds, g0: 1, g1: 1 });

// ─── Waveform peaks ──────────────────────────────────────────────

export interface SourcePeaks {
  /** Max absolute sample per bin. */
  peaks: Float32Array;
  binsPerSecond: number;
}

/** Pre-compute source peaks once (100 bins per second), so drawing any zoom level is cheap. */
export function computeSourcePeaks(source: AudioBuffer, binsPerSecond = 100): SourcePeaks {
  const bins = Math.ceil(source.duration * binsPerSecond);
  const peaks = new Float32Array(bins);
  const perBin = source.sampleRate / binsPerSecond;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let b = 0; b < bins; b++) {
      const from = Math.floor(b * perBin);
      const to = Math.min(data.length, Math.floor((b + 1) * perBin));
      let max = peaks[b];
      for (let i = from; i < to; i += 4) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  return { peaks, binsPerSecond };
}

/** Peak of the edited timeline for each of `count` columns between t0 and t1. */
export function timelinePeaks(state: EditState, peaks: SourcePeaks[], t0: number, t1: number, count: number): Float32Array {
  const out = new Float32Array(count);
  const colDur = (t1 - t0) / count;
  let pos = 0;
  for (const c of state.clips) {
    const len = clipLength(c);
    const cStart = pos;
    const cEnd = pos + len;
    pos = cEnd;
    if (cEnd <= t0 || cStart >= t1 || c.silence !== undefined) continue;
    const src = peaks[c.src ?? 0];
    const firstCol = Math.max(0, Math.floor((cStart - t0) / colDur));
    const lastCol = Math.min(count - 1, Math.floor((cEnd - t0) / colDur));
    for (let col = firstCol; col <= lastCol; col++) {
      const colStart = Math.max(cStart, t0 + col * colDur);
      const colEnd = Math.min(cEnd, t0 + (col + 1) * colDur);
      if (colEnd <= colStart) continue;
      const f = ((colStart + colEnd) / 2 - cStart) / len;
      const gain = Math.abs(c.g0 + (c.g1 - c.g0) * f);
      const b0 = Math.floor((c.srcStart + (colStart - cStart)) * src.binsPerSecond);
      const b1 = Math.max(b0 + 1, Math.ceil((c.srcStart + (colEnd - cStart)) * src.binsPerSecond));
      let max = 0;
      for (let b = b0; b < b1 && b < src.peaks.length; b++) if (src.peaks[b] > max) max = src.peaks[b];
      const v = max * gain;
      if (v > out[col]) out[col] = v;
    }
  }
  return out;
}

/** Loudest point after edits, used by Normalise. */
export function timelinePeak(state: EditState, peaks: SourcePeaks[]): number {
  let peak = 0;
  for (const c of state.clips) {
    if (c.silence !== undefined) continue;
    const src = peaks[c.src ?? 0];
    const b0 = Math.floor(c.srcStart * src.binsPerSecond);
    const b1 = Math.ceil(c.srcEnd * src.binsPerSecond);
    const g = Math.max(Math.abs(c.g0), Math.abs(c.g1));
    for (let b = b0; b < b1 && b < src.peaks.length; b++) {
      const v = src.peaks[b] * g;
      if (v > peak) peak = v;
    }
  }
  return peak;
}

export function normalize(state: EditState, peaks: SourcePeaks[], target = 0.89): EditState {
  const peak = timelinePeak(state, peaks);
  if (peak <= 0) return state;
  const factor = target / peak;
  return { clips: state.clips.map((c) => ({ ...c, g0: c.g0 * factor, g1: c.g1 * factor })) };
}

// ─── Playback & rendering ────────────────────────────────────────

/**
 * Schedule the timeline from `from` seconds on an AudioContext (live playback) or
 * OfflineAudioContext (export). Returns the scheduled nodes so playback can be stopped.
 */
export function schedule(
  ctx: BaseAudioContext,
  sources: AudioBuffer[],
  state: EditState,
  from: number,
  to: number,
  when = 0,
): AudioScheduledSourceNode[] {
  const nodes: AudioScheduledSourceNode[] = [];
  let pos = 0;
  for (const c of state.clips) {
    const len = clipLength(c);
    const cStart = pos;
    const cEnd = pos + len;
    pos = cEnd;
    if (cEnd <= from || cStart >= to || c.silence !== undefined) continue;
    const segStart = Math.max(cStart, from);
    const segEnd = Math.min(cEnd, to);
    const gainAt = (t: number) => c.g0 + (c.g1 - c.g0) * ((t - cStart) / len);

    const node = ctx.createBufferSource();
    node.buffer = sources[c.src ?? 0];
    const gain = ctx.createGain();
    const t0 = when + (segStart - from);
    const t1 = when + (segEnd - from);
    gain.gain.setValueAtTime(gainAt(segStart), t0);
    gain.gain.linearRampToValueAtTime(gainAt(segEnd), t1);
    node.connect(gain).connect(ctx.destination);
    node.start(t0, c.srcStart + (segStart - cStart), segEnd - segStart);
    nodes.push(node);
  }
  return nodes;
}

/** Render [from, to] of the edited timeline to raw channel data. */
export async function renderRange(sources: AudioBuffer[], state: EditState, from: number, to: number, sampleRate: number) {
  const channels = outputChannels(sources);
  const length = Math.max(1, Math.round((to - from) * sampleRate));
  const ctx = new OfflineAudioContext(channels, length, sampleRate);
  schedule(ctx, sources, state, from, to, 0);
  const rendered = await ctx.startRendering();
  return Array.from({ length: channels }, (_, i) => rendered.getChannelData(i));
}

/** Stereo when any source is stereo, otherwise mono. */
export const outputChannels = (sources: AudioBuffer[]) => Math.min(2, Math.max(...sources.map((s) => s.numberOfChannels)));

/** Longest intro, outro or inserted file. */
export const MAX_INSERT_SECONDS = 30 * 60;

/**
 * Pick a decode sample rate that keeps a whole recording in memory on normal devices.
 * Long recordings are edited at speech quality (still clear for sermons and meetings).
 */
export function decodeRateFor(durationSeconds: number | null) {
  const d = durationSeconds || 0;
  if (d <= 45 * 60) return 44100;
  if (d <= 100 * 60) return 22050;
  return 16000;
}

export const MAX_EDIT_SECONDS = 3 * 60 * 60;
