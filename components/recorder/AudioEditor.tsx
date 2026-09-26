import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Crop, Loader2, Maximize2, Pause, Play, Redo2, Scissors, SkipBack, Undo2, Volume1, Volume2,
  VolumeX, ZoomIn, ZoomOut, Waves, TrendingUp, TrendingDown, Plus,
} from 'lucide-react';
import {
  changeGain, crop, cut, fadeIn, fadeOut, insertSilence, mute, normalize, schedule, timelinePeaks, totalLength,
  type EditState, type SourcePeaks,
} from '../../services/audioEdit';

interface Props {
  source: AudioBuffer;
  peaks: SourcePeaks;
  state: EditState;
  onChange: (next: EditState) => void;
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

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function AudioEditor({ source, peaks, state, onChange, canUndo, canRedo, onUndo, onRedo, title, onBack, onNext }: Props) {
  const duration = totalLength(state);
  const [view, setView] = useState({ start: 0, end: duration });
  const [sel, setSel] = useState<Sel>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gainDb, setGainDb] = useState(3);
  const [width, setWidth] = useState(800);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
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
  }, []);

  const play = useCallback(
    (from: number, to: number) => {
      stop();
      if (!ctxRef.current) ctxRef.current = new AudioContext({ sampleRate: source.sampleRate });
      const ctx = ctxRef.current;
      ctx.resume();
      const startAt = ctx.currentTime + 0.05;
      nodesRef.current = schedule(ctx, source, state, from, to, startAt);
      playRef.current = { startAt, from, to };
      setPlaying(true);
      const tick = () => {
        const p = playRef.current;
        if (!p) return;
        const t = p.from + Math.max(0, ctx.currentTime - p.startAt);
        if (t >= p.to) {
          setPlayhead(p.to >= duration ? p.from : p.to);
          stop();
          return;
        }
        setPlayhead(t);
        // Follow the playhead when zoomed in.
        setView((v) => (t > v.end || t < v.start ? { start: t, end: Math.min(duration, t + (v.end - v.start)) } : v));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [source, state, duration, stop],
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
  const HEIGHT = 180;
  const colPeaks = useMemo(() => timelinePeaks(state, peaks, view.start, view.end, Math.floor(width / 2)), [state, peaks, view, width]);
  const miniPeaks = useMemo(() => timelinePeaks(state, peaks, 0, duration || 1, Math.floor(width / 2)), [state, peaks, duration, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const span = view.end - view.start || 1;
    const x = (t: number) => ((t - view.start) / span) * width;
    const accent = cssVar('--accent');
    const faint = cssVar('--line-strong');
    const ink = cssVar('--ink');
    const soft = cssVar('--accent-soft');

    // Time ruler.
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => (s / span) * width > 70) || 3600;
    g.fillStyle = faint;
    g.font = '10px Manrope, sans-serif';
    for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) {
      g.fillRect(x(t), 0, 1, 6);
      g.fillText(fmtTime(t, step < 1), x(t) + 3, 12);
    }

    if (sel) {
      g.fillStyle = soft;
      g.fillRect(x(sel.a), 16, Math.max(1, x(sel.b) - x(sel.a)), HEIGHT - 16);
    }
    const mid = 16 + (HEIGHT - 16) / 2;
    const amp = (HEIGHT - 24) / 2;
    const colW = width / colPeaks.length;
    for (let i = 0; i < colPeaks.length; i++) {
      const t = view.start + (i / colPeaks.length) * span;
      const inSel = sel && t >= sel.a && t <= sel.b;
      const h = Math.max(1, Math.min(1, colPeaks[i]) * amp);
      g.fillStyle = inSel ? accent : colPeaks[i] > 0.99 ? cssVar('--danger') : ink;
      g.globalAlpha = inSel ? 1 : 0.7;
      g.fillRect(i * colW, mid - h, Math.max(1, colW - 0.5), h * 2);
    }
    g.globalAlpha = 1;
    g.fillStyle = cssVar('--danger');
    g.fillRect(x(playhead) - 1, 14, 2, HEIGHT - 14);
  }, [colPeaks, view, sel, playhead, width]);

  useEffect(() => {
    const canvas = miniRef.current;
    if (!canvas) return;
    const H = 36;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, H);
    const colW = width / miniPeaks.length;
    g.fillStyle = cssVar('--line-strong');
    for (let i = 0; i < miniPeaks.length; i++) {
      const h = Math.max(1, Math.min(1, miniPeaks[i]) * (H / 2 - 2));
      g.fillRect(i * colW, H / 2 - h, Math.max(1, colW - 0.5), h * 2);
    }
    const d = duration || 1;
    g.strokeStyle = cssVar('--accent');
    g.lineWidth = 2;
    g.strokeRect((view.start / d) * width + 1, 1, Math.max(4, ((view.end - view.start) / d) * width - 2), H - 2);
    g.fillStyle = cssVar('--danger');
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
    <div className="space-y-4">
      <div className="card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => { stop(); onBack(); }} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Recorder
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-bold">{title}</p>
          <button type="button" onClick={() => { stop(); onNext(); }} className="btn-primary py-2">
            Details &amp; export <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Waveform */}
        <div ref={wrapRef} className="mt-5 select-none overflow-hidden rounded-2xl border border-line bg-sunken">
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
          <canvas ref={miniRef} style={{ width: '100%', height: 36 }} className="block cursor-pointer border-t border-line" onClick={onMiniClick} aria-label="Overview" role="img" />
        </div>

        {/* Transport + status */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { stop(); setPlayhead(sel ? sel.a : 0); }} className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface" aria-label="Back to start">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" onClick={togglePlay} className="grid h-12 w-12 place-items-center rounded-full bg-ink text-bg" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>
          <span className="font-mono text-sm tabular-nums">{fmtTime(playhead)} <span className="text-faint">/ {fmtTime(duration)}</span></span>
          <div className="ml-auto flex items-center gap-1">
            <IconBtn label="Zoom out" onClick={() => zoom(2)}><ZoomOut className="h-4 w-4" /></IconBtn>
            <IconBtn label="Zoom in" onClick={() => zoom(0.5)}><ZoomIn className="h-4 w-4" /></IconBtn>
            <IconBtn label="Show everything" onClick={() => setView({ start: 0, end: duration })}><Maximize2 className="h-4 w-4" /></IconBtn>
          </div>
        </div>

        <SelectionBar sel={sel} duration={duration} onChange={setSel} onZoom={() => sel && zoomTo((sel.a + sel.b) / 2, selLen * 1.2)} />
      </div>

      {/* Tools */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ToolGroup title="Edit" hint={hasSel ? `Selection: ${fmtTime(selLen)}` : 'Drag on the waveform to select a part'}>
          <Tool icon={<Crop className="h-4 w-4" />} label="Crop" hint="Keep only the selection" disabled={!hasSel} onClick={doCrop} />
          <Tool icon={<Scissors className="h-4 w-4" />} label="Cut out" hint="Remove the selection (Delete)" disabled={!hasSel} onClick={doCut} />
          <Tool icon={<VolumeX className="h-4 w-4" />} label="Mute" hint="Silence the selection" disabled={!hasSel} onClick={doMute} />
          <Tool icon={<Plus className="h-4 w-4" />} label="Add 2s silence" hint="At the playhead" onClick={() => doSilence(2)} />
        </ToolGroup>

        <ToolGroup title="Volume" hint={hasSel ? 'Applies to the selection' : 'Applies to the whole recording'}>
          <div className="col-span-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-muted">
              <span>Amount</span>
              <span className="font-mono text-ink">{gainDb > 0 ? '+' : ''}{gainDb} dB</span>
            </div>
            <input type="range" min={-12} max={12} step={1} value={gainDb} onChange={(e) => setGainDb(Number(e.target.value))} className="sp-range mt-2 w-full" aria-label="Volume change in decibels" />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => doGain(gainDb)} disabled={gainDb === 0} className="btn-primary flex-1 py-1.5 text-xs">
                {gainDb >= 0 ? <Volume2 className="h-3.5 w-3.5" /> : <Volume1 className="h-3.5 w-3.5" />} Apply
              </button>
            </div>
          </div>
          <Tool icon={<Waves className="h-4 w-4" />} label="Normalise" hint="Make it as loud as possible without distortion" onClick={doNormalize} />
        </ToolGroup>

        <ToolGroup title="Fades & history" hint="Smooth starts and endings">
          <Tool icon={<TrendingUp className="h-4 w-4" />} label="Fade in" hint="Across the selection" disabled={!hasSel} onClick={doFadeIn} />
          <Tool icon={<TrendingDown className="h-4 w-4" />} label="Fade out" hint="Across the selection" disabled={!hasSel} onClick={doFadeOut} />
          <Tool icon={<Undo2 className="h-4 w-4" />} label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
          <Tool icon={<Redo2 className="h-4 w-4" />} label="Redo" hint="Ctrl+Y" disabled={!canRedo} onClick={onRedo} />
        </ToolGroup>
      </div>
      <p className="text-center text-xs text-faint">Space: play or pause · Delete: cut out · Ctrl+scroll: zoom · Shift+scroll: move · Esc: clear selection</p>
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
  const input = 'w-24 rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-xs outline-none focus:border-accent';
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="font-semibold">Selection</span>
      <input value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="start" className={input} aria-label="Selection start (m:ss.s)" />
      <span>to</span>
      <input value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} placeholder="end" className={input} aria-label="Selection end (m:ss.s)" />
      {sel && (
        <>
          <button type="button" onClick={onZoom} className="font-semibold text-accent">Zoom to selection</button>
          <button type="button" onClick={() => onChange(null)} className="font-semibold">Clear</button>
        </>
      )}
      {!sel && <span>Type times like 12:30.5, or drag on the waveform.</span>}
    </div>
  );
}

function ToolGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-sm font-bold">{title}</p>
      <p className="text-xs text-muted">{hint}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function Tool({ icon, label, hint, onClick, disabled }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex flex-col items-start gap-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">{icon} {label}</span>
      <span className="text-[11px] leading-tight text-muted">{hint}</span>
    </button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted hover:text-ink">
      {children}
    </button>
  );
}

export function EditorLoading({ label }: { label: string }) {
  return (
    <div className="card grid place-items-center gap-3 p-16 text-sm text-muted">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
      {label}
    </div>
  );
}
