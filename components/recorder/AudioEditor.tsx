import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Crop, Loader2, Maximize2, Pause, Play, Redo2, Scissors, SkipBack, Square, Undo2,
  VolumeX, ZoomIn, ZoomOut, Waves, TrendingUp, TrendingDown, Plus,
} from 'lucide-react';
import {
  changeGain, clipLength, crop, cut, fadeIn, fadeOut, insertSilence, mute, normalize, schedule, timelinePeaks, totalLength,
  type EditState, type SourcePeaks,
} from '../../services/audioEdit';
import type { SavedRecording } from '../../services/api';
import AddAudio from './AddAudio';

interface Props {
  sources: AudioBuffer[];
  peaks: SourcePeaks[];
  state: EditState;
  onChange: (next: EditState) => void;
  /** Decode another file and return its source index. */
  onAddSource: (blob: Blob) => Promise<{ src: number; seconds: number }>;
  /** Saved recordings the user can pick as an intro, outro or insert. */
  library: SavedRecording[] | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  title: string;
  onBack: () => void;
  onNext: () => void;
}

type Sel = { a: number; b: number } | null;

export function fmtTime(t: number, precise = true) {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = precise ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${secStr}` : `${m}:${secStr}`;
}

function parseTime(v: string): number | null {
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** The editor always uses a dark studio console, whatever the site theme. */
const STUDIO = {
  screen: '#07080b',
  ruler: '#0d1015',
  grid: 'rgba(255,255,255,0.05)',
  label: '#6b7280',
  wave: '#2dd4bf',
  waveDim: 'rgba(45,212,191,0.55)',
  sel: 'rgba(251,191,36,0.13)',
  selWave: '#fbbf24',
  clip: '#f87171',
  added: '#fb923c',
  playhead: '#ef4444',
};

const METER_FLOOR_DB = -48;

export default function AudioEditor({ sources, peaks, state, onChange, onAddSource, library, canUndo, canRedo, onUndo, onRedo, title, onBack, onNext }: Props) {
  const duration = totalLength(state);
  const [view, setView] = useState({ start: 0, end: duration });
  const [sel, setSel] = useState<Sel>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gainDb, setGainDb] = useState(3);
  const [width, setWidth] = useState(800);
  /** Playback level 0..1 (on a dB scale) and a slowly falling peak hold. */
  const [level, setLevel] = useState({ now: 0, hold: 0, clip: false });

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<{ input: GainNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null>(null);
  const nodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const playRef = useRef<{ startAt: number; from: number; to: number } | null>(null);
  const rafRef = useRef(0);
  const dragRef = useRef<{ x: number; t: number; moved: boolean } | null>(null);

  // Keep the view valid when the length changes (after crop/cut).
  useEffect(() => {
    setView((v) => {
      const span = Math.min(duration, Math.max(0.5, v.end - v.start));
      const start = Math.min(Math.max(0, v.start), Math.max(0, duration - span));
      return { start, end: start + span };
    });
    setPlayhead((p) => Math.min(p, duration));
    setSel((s) => (s && s.b <= duration ? s : null));
  }, [duration]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Playback ──
  const stop = useCallback(() => {
    nodesRef.current.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    });
    nodesRef.current = [];
    playRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setLevel({ now: 0, hold: 0, clip: false });
  }, []);

  const play = useCallback(
    (from: number, to: number) => {
      stop();
      if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: sources[0].sampleRate });
      const ctx = ctxRef.current;
      if (!meterRef.current) {
        const input = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        input.connect(analyser).connect(ctx.destination);
        meterRef.current = { input, analyser, buf: new Float32Array(analyser.fftSize) };
      }
      const meter = meterRef.current;
      ctx.resume();
      const startAt = ctx.currentTime + 0.05;
      nodesRef.current = schedule(ctx, sources, state, from, to, startAt, meter.input);
      playRef.current = { startAt, from, to };
      setPlaying(true);
      let hold = 0;
      let clipUntil = 0;
      const tick = () => {
        const p = playRef.current;
        if (!p) return;
        const t = p.from + Math.max(0, ctx.currentTime - p.startAt);
        if (t >= p.to) {
          setPlayhead(p.to >= duration ? p.from : p.to);
          stop();
          return;
        }
        // Peak level of the last ~46 ms, shown on a dB scale.
        meter.analyser.getFloatTimeDomainData(meter.buf);
        let peak = 0;
        for (let i = 0; i < meter.buf.length; i++) {
          const v = Math.abs(meter.buf[i]);
          if (v > peak) peak = v;
        }
        const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        const now = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
        hold = Math.max(now, hold - 0.012);
        if (peak >= 0.99) clipUntil = performance.now() + 1500;
        setLevel({ now, hold, clip: performance.now() < clipUntil });
        setPlayhead(t);
        // Follow the playhead when zoomed in.
        setView((v) => (t > v.end || t < v.start ? { start: t, end: Math.min(duration, t + (v.end - v.start)) } : v));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [sources, state, duration, stop],
  );

  useEffect(() => () => {
    stop();
    ctxRef.current?.close().catch(() => {});
  }, [stop]);

  // Any edit invalidates what is scheduled.
  useEffect(() => {
    if (playRef.current) stop();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = () => (playing ? stop() : play(sel && playhead >= sel.a && playhead < sel.b ? playhead : sel ? sel.a : playhead, sel ? sel.b : duration));

  // ── Drawing ──
  const RULER = 20;
  const HEIGHT = 200;
  const colPeaks = useMemo(() => timelinePeaks(state, peaks, view.start, view.end, Math.floor(width / 2)), [state, peaks, view, width]);
  // Where the added audio (intros, inserts, outros) sits on the timeline.
  const addedRanges = useMemo(() => {
    const out: [number, number][] = [];
    let pos = 0;
    for (const c of state.clips) {
      const len = clipLength(c);
      if ((c.src ?? 0) > 0 && c.silence === undefined) out.push([pos, pos + len]);
      pos += len;
    }
    return out;
  }, [state]);
  const miniPeaks = useMemo(() => timelinePeaks(state, peaks, 0, duration || 1, Math.floor(width / 2)), [state, peaks, duration, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = view.end - view.start || 1;
    const x = (t: number) => ((t - view.start) / span) * width;

    // Screen and ruler.
    g.fillStyle = STUDIO.screen;
    g.fillRect(0, 0, width, HEIGHT);
    g.fillStyle = STUDIO.ruler;
    g.fillRect(0, 0, width, RULER);

    // Time grid: major ticks with labels, minor ticks between.
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => (s / span) * width > 80) || 3600;
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let t = Math.floor(view.start / (step / 4)) * (step / 4); t <= view.end; t += step / 4) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      const px = Math.round(x(t)) + 0.5;
      g.fillStyle = major ? STUDIO.label : 'rgba(255,255,255,0.12)';
      g.fillRect(px, major ? 8 : 14, 1, major ? RULER - 8 : RULER - 14);
      if (major) {
        g.fillText(fmtTime(t, step < 1), px + 4, 11);
        g.fillStyle = STUDIO.grid;
        g.fillRect(px, RULER, 1, HEIGHT - RULER);
      }
    }

    const mid = RULER + (HEIGHT - RULER) / 2;
    const amp = (HEIGHT - RULER - 16) / 2;
    // Level guides at -6 dB and the centre line.
    g.fillStyle = STUDIO.grid;
    g.fillRect(0, Math.round(mid) + 0.5, width, 1);
    for (const f of [0.5, 1]) {
      g.fillRect(0, Math.round(mid - amp * f) + 0.5, width, 1);
      g.fillRect(0, Math.round(mid + amp * f) + 0.5, width, 1);
    }

    if (sel) {
      g.fillStyle = STUDIO.sel;
      g.fillRect(x(sel.a), RULER, Math.max(1, x(sel.b) - x(sel.a)), HEIGHT - RULER);
      g.fillStyle = STUDIO.selWave;
      g.fillRect(x(sel.a), RULER, 1, HEIGHT - RULER);
      g.fillRect(x(sel.b) - 1, RULER, 1, HEIGHT - RULER);
    }

    // Waveform: bright where selected or loud, softer elsewhere.
    const colW = width / colPeaks.length;
    for (let i = 0; i < colPeaks.length; i++) {
      const t = view.start + (i / colPeaks.length) * span;
      const inSel = sel && t >= sel.a && t <= sel.b;
      const v = Math.min(1, colPeaks[i]);
      const h = Math.max(1, v * amp);
      g.fillStyle = colPeaks[i] > 0.99 ? STUDIO.clip : inSel ? STUDIO.selWave : v > 0.5 ? STUDIO.wave : STUDIO.waveDim;
      g.fillRect(i * colW, mid - h, Math.max(1, colW - 0.6), h * 2);
    }

    // Added audio: a band along the bottom of the screen.
    g.fillStyle = STUDIO.added;
    for (const [a, b] of addedRanges) {
      if (b < view.start || a > view.end) continue;
      g.fillRect(x(a), HEIGHT - 4, Math.max(2, x(b) - x(a)), 4);
    }

    // Playhead with a cap on the ruler.
    const ph = Math.round(x(playhead));
    g.fillStyle = STUDIO.playhead;
    g.fillRect(ph - 1, RULER, 2, HEIGHT - RULER);
    g.beginPath();
    g.moveTo(ph - 6, 0);
    g.lineTo(ph + 6, 0);
    g.lineTo(ph, 9);
    g.closePath();
    g.fill();
  }, [colPeaks, view, sel, playhead, width, addedRanges]);

  useEffect(() => {
    const canvas = miniRef.current;
    if (!canvas) return;
    const H = 34;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = STUDIO.ruler;
    g.fillRect(0, 0, width, H);
    const colW = width / miniPeaks.length;
    g.fillStyle = 'rgba(148,163,184,0.45)';
    for (let i = 0; i < miniPeaks.length; i++) {
      const h = Math.max(1, Math.min(1, miniPeaks[i]) * (H / 2 - 3));
      g.fillRect(i * colW, H / 2 - h, Math.max(1, colW - 0.5), h * 2);
    }
    const d = duration || 1;
    const vx = (view.start / d) * width;
    const vw = Math.max(4, ((view.end - view.start) / d) * width);
    g.fillStyle = 'rgba(45,212,191,0.12)';
    g.fillRect(vx, 0, vw, H);
    g.strokeStyle = STUDIO.wave;
    g.lineWidth = 1.5;
    g.strokeRect(vx + 0.75, 0.75, vw - 1.5, H - 1.5);
    g.fillStyle = STUDIO.playhead;
    g.fillRect((playhead / d) * width - 1, 0, 2, H);
  }, [miniPeaks, view, playhead, width, duration]);

  // ── Pointer: click sets playhead, drag selects ──
  const timeAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return view.start + f * (view.end - view.start);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const t = timeAt(e.clientX);
    dragRef.current = { x: e.clientX, t, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
    if (d.moved) {
      const t = timeAt(e.clientX);
      setSel({ a: Math.min(d.t, t), b: Math.max(d.t, t) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      setSel(null);
      setPlayhead(timeAt(e.clientX));
      if (playing) play(timeAt(e.clientX), duration);
    } else {
      setPlayhead(Math.min(d.t, timeAt(e.clientX)));
    }
  };

  const zoomTo = (center: number, span: number) => {
    const s = Math.min(duration, Math.max(0.5, span));
    const start = Math.min(Math.max(0, center - s / 2), Math.max(0, duration - s));
    setView({ start, end: start + s });
  };
  const zoom = (factor: number) => zoomTo(sel ? (sel.a + sel.b) / 2 : playhead, (view.end - view.start) * factor);
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomTo(timeAt(e.clientX), (view.end - view.start) * (e.deltaY > 0 ? 1.25 : 0.8));
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      const span = view.end - view.start;
      const delta = ((e.shiftKey ? e.deltaY : e.deltaX) / width) * span;
      const start = Math.min(Math.max(0, view.start + delta), Math.max(0, duration - span));
      setView({ start, end: start + span });
    }
  };
  const onMiniClick = (e: React.MouseEvent) => {
    const rect = miniRef.current!.getBoundingClientRect();
    zoomTo(((e.clientX - rect.left) / rect.width) * duration, view.end - view.start);
  };

  // ── Edits ──
  const hasSel = Boolean(sel && sel.b - sel.a > 0.01);
  const range = (): [number, number] => (sel && hasSel ? [sel.a, sel.b] : [0, duration]);
  const apply = (next: EditState, after?: () => void) => {
    onChange(next);
    after?.();
  };
  const doCut = () => sel && hasSel && apply(cut(state, sel.a, sel.b), () => { setPlayhead(sel.a); setSel(null); });
  const doCrop = () => sel && hasSel && apply(crop(state, sel.a, sel.b), () => { setPlayhead(0); setSel(null); setView({ start: 0, end: sel.b - sel.a }); });
  const doGain = (db: number) => apply(changeGain(state, ...range(), Math.pow(10, db / 20)));
  const doMute = () => sel && hasSel && apply(mute(state, sel.a, sel.b));
  const doFadeIn = () => sel && hasSel && apply(fadeIn(state, sel.a, sel.b));
  const doFadeOut = () => sel && hasSel && apply(fadeOut(state, sel.a, sel.b));
  const doSilence = (s: number) => apply(insertSilence(state, playhead, s));
  const doNormalize = () => apply(normalize(state, peaks));

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSel) {
        e.preventDefault();
        doCut();
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        onRedo();
      } else if (e.key === 'Escape') {
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selLen = sel ? sel.b - sel.a : 0;

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b0d11] text-zinc-100 shadow-2xl">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-[#0f1217] px-4 py-3 sm:px-5">
        <button type="button" onClick={() => { stop(); onBack(); }} className="flex items-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Recorder
        </button>
        <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1 sm:justify-center">
          <span className="rounded bg-teal-400/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest text-teal-300">EDIT</span>
          <p className="truncate text-sm font-semibold text-zinc-200">{title}</p>
        </div>
        <button type="button" onClick={() => { stop(); onNext(); }} className="btn-primary ml-auto py-2 sm:ml-0">
          Details &amp; export <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {/* Transport */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-2xl border border-white/5 bg-[#12151b] p-1.5">
            <TransportBtn label="Back to start" onClick={() => { stop(); setPlayhead(sel ? sel.a : 0); }}><SkipBack className="h-4 w-4" /></TransportBtn>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className={`grid h-11 w-11 place-items-center rounded-xl transition-colors ${playing ? 'bg-amber-400 text-black' : 'bg-teal-400 text-black hover:bg-teal-300'}`}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
            <TransportBtn label="Stop" onClick={() => { stop(); setPlayhead(sel ? sel.a : 0); }}><Square className="h-3.5 w-3.5" /></TransportBtn>
          </div>

          {/* Time display */}
          <div className="min-w-[13rem] flex-1 rounded-2xl border border-white/10 bg-black px-4 py-2 sm:flex-none">
            <p className="font-mono text-2xl font-semibold tabular-nums tracking-wider text-teal-300 [text-shadow:0_0_12px_rgba(45,212,191,0.45)]">
              {fmtTime(playhead)}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              of {fmtTime(duration)}
              {hasSel && sel && <span className="text-amber-300"> · sel {fmtTime(sel.a)}–{fmtTime(sel.b)} ({fmtTime(selLen)})</span>}
            </p>
          </div>

          <LevelMeter level={level} active={playing} />

          <div className="ml-auto flex items-center gap-1 rounded-2xl border border-white/5 bg-[#12151b] p-1.5">
            <TransportBtn label="Zoom out" onClick={() => zoom(2)}><ZoomOut className="h-4 w-4" /></TransportBtn>
            <TransportBtn label="Zoom in" onClick={() => zoom(0.5)}><ZoomIn className="h-4 w-4" /></TransportBtn>
            <TransportBtn label="Show everything" onClick={() => setView({ start: 0, end: duration })}><Maximize2 className="h-4 w-4" /></TransportBtn>
          </div>
        </div>

        {/* Screen */}
        <div ref={wrapRef} className="select-none overflow-hidden rounded-2xl border border-white/10 shadow-[inset_0_0_40px_rgba(0,0,0,0.6)]">
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: HEIGHT, touchAction: 'none' }}
            className="block cursor-text"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            aria-label="Waveform. Click to move the playhead, drag to select."
            role="img"
          />
          <canvas ref={miniRef} style={{ width: '100%', height: 34 }} className="block cursor-pointer border-t border-white/10" onClick={onMiniClick} aria-label="Overview" role="img" />
        </div>

        <SelectionBar sel={sel} duration={duration} onChange={setSel} onZoom={() => sel && zoomTo((sel.a + sel.b) / 2, selLen * 1.2)} />

        {/* Racks */}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1.3fr_0.8fr_0.8fr]">
          <Rack title="Edit" status={hasSel ? `SEL ${fmtTime(selLen)}` : 'Drag to select'} lit={hasSel}>
            <div className="grid grid-cols-2 gap-2">
              <Pad icon={<Crop className="h-4 w-4" />} label="Crop" hint="Keep only the selection" disabled={!hasSel} onClick={doCrop} />
              <Pad icon={<Scissors className="h-4 w-4" />} label="Cut" hint="Remove the selection (Delete)" disabled={!hasSel} onClick={doCut} />
              <Pad icon={<VolumeX className="h-4 w-4" />} label="Mute" hint="Silence the selection" disabled={!hasSel} onClick={doMute} />
              <Pad icon={<Plus className="h-4 w-4" />} label="+2s gap" hint="Insert 2 seconds of silence at the playhead" onClick={() => doSilence(2)} />
            </div>
          </Rack>

          <Rack title="Gain" status={hasSel ? 'Selection' : 'Whole track'} lit>
            <div className="flex items-stretch gap-3">
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Amount</span>
                  <span className={`font-mono text-lg font-semibold tabular-nums ${gainDb > 0 ? 'text-teal-300' : gainDb < 0 ? 'text-amber-300' : 'text-zinc-400'}`}>
                    {gainDb > 0 ? '+' : ''}{gainDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={gainDb}
                  onChange={(e) => setGainDb(Number(e.target.value))}
                  onDoubleClick={() => setGainDb(0)}
                  className="studio-fader mt-2 w-full"
                  aria-label="Volume change in decibels"
                />
                <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-600">
                  <span>-12</span><span>-6</span><span>0</span><span>+6</span><span>+12</span>
                </div>
              </div>
              <div className="flex w-24 flex-col gap-2">
                <button type="button" onClick={() => doGain(gainDb)} disabled={gainDb === 0} className="flex-1 rounded-xl bg-teal-400 px-2 text-xs font-bold text-black transition-colors hover:bg-teal-300 disabled:opacity-30">
                  Apply
                </button>
                <button type="button" onClick={doNormalize} title="As loud as possible without distortion" className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#1a1e26] px-2 text-xs font-semibold text-zinc-200 hover:border-teal-400/50">
                  <Waves className="h-3.5 w-3.5" /> Normalise
                </button>
              </div>
            </div>
          </Rack>

          <Rack title="Fades" status={hasSel ? 'Ready' : 'Needs selection'} lit={hasSel}>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              <Pad icon={<TrendingUp className="h-4 w-4" />} label="Fade in" hint="Across the selection" disabled={!hasSel} onClick={doFadeIn} />
              <Pad icon={<TrendingDown className="h-4 w-4" />} label="Fade out" hint="Across the selection" disabled={!hasSel} onClick={doFadeOut} />
            </div>
          </Rack>

          <Rack title="History" status={canUndo ? 'Edits made' : 'No edits'} lit={canUndo}>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              <Pad icon={<Undo2 className="h-4 w-4" />} label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
              <Pad icon={<Redo2 className="h-4 w-4" />} label="Redo" hint="Ctrl+Y" disabled={!canRedo} onClick={onRedo} />
            </div>
          </Rack>
        </div>

        <AddAudio
          state={state}
          playhead={playhead}
          library={library}
          onAddSource={onAddSource}
          onBefore={stop}
          onInserted={(next, at, seconds) => {
            apply(next);
            // Select the new audio so it can be faded or its volume matched straight away.
            setSel({ a: at, b: at + seconds });
            setPlayhead(at);
            setView({ start: 0, end: totalLength(next) });
          }}
        />

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-zinc-500">
          {[['Space', 'play / pause'], ['Del', 'cut'], ['Ctrl Z', 'undo'], ['Ctrl scroll', 'zoom'], ['Shift scroll', 'move'], ['Esc', 'clear selection']].map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <kbd className="rounded border border-white/10 border-b-white/20 bg-[#1a1e26] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{k}</kbd> {v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Segmented playback meter: green to -12 dB, amber to -3 dB, red above; peak hold and clip light. */
function LevelMeter({ level, active }: { level: { now: number; hold: number; clip: boolean }; active: boolean }) {
  const SEGMENTS = 24;
  const lit = Math.round(level.now * SEGMENTS);
  const holdSeg = Math.min(SEGMENTS - 1, Math.round(level.hold * SEGMENTS) - 1);
  const colour = (i: number) => {
    const db = METER_FLOOR_DB + ((i + 1) / SEGMENTS) * -METER_FLOOR_DB;
    return db > -3 ? 'bg-red-500' : db > -12 ? 'bg-amber-400' : 'bg-emerald-400';
  };
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/5 bg-[#12151b] px-3 py-2" aria-label="Output level" role="meter" aria-valuenow={Math.round(level.now * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="font-mono text-[10px] font-bold tracking-widest text-zinc-500">OUT</span>
      <div className="flex h-5 items-end gap-[2px]">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-full w-1.5 rounded-[1px] ${i < lit || (active && i === holdSeg) ? colour(i) : 'bg-white/[0.07]'}`}
            style={{ opacity: i < lit ? 1 : active && i === holdSeg ? 0.8 : 1 }}
          />
        ))}
      </div>
      <span className={`h-2.5 w-2.5 rounded-full ${level.clip ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-white/10'}`} title="Clip: the signal hit full scale" />
    </div>
  );
}

function SelectionBar({ sel, duration, onChange, onZoom }: { sel: Sel; duration: number; onChange: (s: Sel) => void; onZoom: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  useEffect(() => {
    setA(sel ? fmtTime(sel.a) : '');
    setB(sel ? fmtTime(sel.b) : '');
  }, [sel]);
  const commit = () => {
    const ta = parseTime(a);
    const tb = parseTime(b);
    if (ta === null || tb === null) return;
    const lo = Math.max(0, Math.min(ta, tb));
    const hi = Math.min(duration, Math.max(ta, tb));
    if (hi - lo > 0.01) onChange({ a: lo, b: hi });
  };
  const input = 'w-24 rounded-lg border border-white/10 bg-black px-2 py-1.5 font-mono text-xs text-amber-200 outline-none placeholder:text-zinc-600 focus:border-amber-400/60';
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">Selection</span>
      <input value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="start" className={input} aria-label="Selection start (m:ss.s)" />
      <span>to</span>
      <input value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="end" className={input} aria-label="Selection end (m:ss.s)" />
      {sel && (
        <>
          <button type="button" onClick={onZoom} className="font-semibold text-teal-300 hover:text-teal-200">Zoom to selection</button>
          <button type="button" onClick={() => onChange(null)} className="font-semibold hover:text-white">Clear</button>
        </>
      )}
      {!sel && <span className="text-zinc-500">Type times like 12:30.5, or drag on the waveform.</span>}
    </div>
  );
}

/** A rack unit: label strip with a status light, controls below. */
function Rack({ title, status, lit, children }: { title: string; status: string; lit?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-[#161a21] to-[#12151b] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
          <span className={`h-1.5 w-1.5 rounded-full ${lit ? 'bg-teal-400 shadow-[0_0_6px_#2dd4bf]' : 'bg-zinc-700'}`} />
          {title}
        </span>
        <span className="truncate font-mono text-[10px] text-zinc-500">{status}</span>
      </div>
      {children}
    </div>
  );
}

function Pad({ icon, label, hint, onClick, disabled }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="group flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#1a1e26] px-3 py-2.5 text-left text-sm font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:border-teal-400/50 hover:bg-[#1e232c] hover:text-white active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.06] disabled:hover:bg-[#1a1e26]"
    >
      <span className="text-teal-300 group-disabled:text-zinc-500">{icon}</span>
      {label}
    </button>
  );
}

function TransportBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white">
      {children}
    </button>
  );
}

export function EditorLoading({ label }: { label: string }) {
  return (
    <div className="grid place-items-center gap-3 rounded-3xl border border-white/10 bg-[#0b0d11] p-16 text-sm text-zinc-400">
      <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
      {label}
    </div>
  );
}
