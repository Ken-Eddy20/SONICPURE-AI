import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { computePeaks, formatDuration } from '../../services/media';

const PEAKS = 160;

interface ComparePlayerProps {
  originalUrl: string;
  cleanedUrl: string;
}

type Side = 'before' | 'after';

/**
 * A/B player: both versions share one timeline, so switching sides keeps your place.
 */
export default function ComparePlayer({ originalUrl, cleanedUrl }: ComparePlayerProps) {
  const before = useRef<HTMLAudioElement>(null);
  const after = useRef<HTMLAudioElement>(null);
  const [side, setSide] = useState<Side>('after');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Record<Side, number[] | null | undefined>>({ before: undefined, after: undefined });

  const active = () => (side === 'after' ? after.current : before.current);

  useEffect(() => {
    let cancelled = false;
    setPeaks({ before: undefined, after: undefined });
    computePeaks(cleanedUrl, PEAKS).then((p) => !cancelled && setPeaks((s) => ({ ...s, after: p }))).catch(() => !cancelled && setPeaks((s) => ({ ...s, after: null })));
    computePeaks(originalUrl, PEAKS).then((p) => !cancelled && setPeaks((s) => ({ ...s, before: p }))).catch(() => !cancelled && setPeaks((s) => ({ ...s, before: null })));
    return () => {
      cancelled = true;
    };
  }, [originalUrl, cleanedUrl]);

  useEffect(() => {
    const el = active();
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => Number.isFinite(el.duration) && setDuration(el.duration);
    const onEnd = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    onMeta();
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [side]);

  // Stop playback when unmounting (e.g. switching to another file).
  useEffect(() => () => {
    before.current?.pause();
    after.current?.pause();
  }, []);

  const toggle = () => {
    const el = active();
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const switchTo = (next: Side) => {
    if (next === side) return;
    const from = active();
    const to = next === 'after' ? after.current : before.current;
    if (!from || !to) return;
    const t = from.currentTime;
    from.pause();
    // The cleaned file can be shorter (silences trimmed), so clamp.
    to.currentTime = Math.min(t, Number.isFinite(to.duration) ? to.duration : t);
    setSide(next);
    if (playing) to.play().catch(() => setPlaying(false));
  };

  const seek = (ratio: number) => {
    const el = active();
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = ratio * el.duration;
    setTime(el.currentTime);
  };

  const progress = duration ? time / duration : 0;

  return (
    <div className="rounded-3xl border border-line bg-sunken p-4 sm:p-5">
      <audio ref={before} src={originalUrl} preload="metadata" crossOrigin="anonymous" />
      <audio ref={after} src={cleanedUrl} preload="metadata" crossOrigin="anonymous" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm font-semibold" role="tablist" aria-label="Compare versions">
          {(['before', 'after'] as Side[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => switchTo(s)}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                side === s ? (s === 'after' ? 'bg-accent text-accent-ink' : 'bg-noise text-white') : 'text-muted hover:text-ink'
              }`}
            >
              {s === 'before' ? 'Original' : 'Cleaned'}
            </button>
          ))}
        </div>
        <span className="font-mono text-xs text-muted">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-bg transition-transform active:scale-95"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>
        <WaveCanvas peaks={peaks[side]} progress={progress} tone={side === 'after' ? 'accent' : 'noise'} onSeek={seek} />
        <button
          type="button"
          onClick={() => seek(0)}
          className="hidden h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:text-ink sm:grid"
          aria-label="Back to start"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-xs text-faint">Tip: switch while playing to hear the difference at the same moment.</p>
    </div>
  );
}

interface WaveCanvasProps {
  peaks: number[] | null | undefined;
  progress: number;
  tone: 'accent' | 'noise';
  onSeek: (ratio: number) => void;
}

function WaveCanvas({ peaks, progress, tone, onSeek }: WaveCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const played = styles.getPropertyValue(tone === 'accent' ? '--accent' : '--noise').trim();
    const rest = styles.getPropertyValue('--line-strong').trim();

    const data = peaks || Array.from({ length: PEAKS }, () => 0.08);
    const gap = width / data.length;
    const barW = Math.max(1.5, gap * 0.6);
    const mid = height / 2;
    data.forEach((p, i) => {
      const x = i * gap;
      const h = Math.max(2, p * height * 0.92);
      ctx.fillStyle = i / data.length < progress ? played : rest;
      ctx.fillRect(x, mid - h / 2, barW, h);
    });
  }, [peaks, progress, tone]);

  return (
    <div className="relative h-16 flex-1">
      <canvas
        ref={ref}
        className="h-full w-full cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width);
        }}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      />
      {peaks === undefined && (
        <span className="absolute inset-0 grid place-items-center text-xs text-faint">Drawing waveform…</span>
      )}
    </div>
  );
}
