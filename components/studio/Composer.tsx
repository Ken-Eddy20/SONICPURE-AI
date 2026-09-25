import { useEffect, useRef, useState } from 'react';
import {
  AudioLines, Sparkles, Mic, SlidersHorizontal, Lock, Upload, Square, X, Film, Music, AlertTriangle, Wand2, FileText,
  Clapperboard, Music2,
} from 'lucide-react';
import {
  PROFILES, CUSTOM_TOGGLES, LOUDNESS_TARGETS, EXPORT_FORMATS, DEFAULT_OPTIONS, estimateCredits, isPremiumPlan,
  AI_NOTES_CREDITS_PER_MIN,
} from '../../shared/processing.js';
import type { JobOptions, Plan } from '../../services/api';
import { formatBytes, formatDuration, probeDuration } from '../../services/media';

export interface PlanLimits {
  maxAudioLengthMins: number;
  maxDailyEnhances: number;
  extractAudioFromVideo: boolean;
  multipleUploads: boolean;
}

export interface QueuedFile {
  id: string;
  file: File;
  duration: number | null;
  isVideo: boolean;
}

interface ComposerProps {
  plan: Plan;
  credits: number | null;
  limits: PlanLimits | null;
  enhancesLeftToday: number | null;
  onStart: (files: QueuedFile[], feature: string, options: JobOptions) => void;
  onUpgrade: () => void;
}

const PROFILE_ICONS: Record<string, typeof AudioLines> = {
  noise_removal: AudioLines,
  audio_enhancement: Sparkles,
  voice_clarity: Mic,
  custom: SlidersHorizontal,
};

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.mkv,.avi,.webm';

let fileSeq = 0;

export default function Composer({ plan, credits, limits, enhancesLeftToday, onStart, onUpgrade }: ComposerProps) {
  const premium = isPremiumPlan(plan);
  const multi = Boolean(limits?.multipleUploads);

  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [feature, setFeature] = useState<string>('noise_removal');
  const [options, setOptions] = useState<JobOptions>(() => ({ ...(DEFAULT_OPTIONS as JobOptions), custom: { ...DEFAULT_OPTIONS.custom } }));
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasVideo = files.some((f) => f.isVideo);
  const set = <K extends keyof JobOptions>(key: K, value: JobOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  const addFiles = async (list: FileList | File[]) => {
    setNotice(null);
    const incoming = Array.from(list);
    const accepted: QueuedFile[] = [];
    for (const file of incoming) {
      const isVideo = file.type.startsWith('video/') || (!file.type && /\.(mp4|mov|mkv|avi)$/i.test(file.name));
      const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name);
      if (!isVideo && !isAudio) {
        setNotice(`${file.name} is not an audio or video file.`);
        continue;
      }
      if (isVideo && !limits?.extractAudioFromVideo) {
        setNotice('Video uploads are available on Pro and Audio Master. Upload the audio track, or upgrade.');
        continue;
      }
      const duration = await probeDuration(file);
      const max = limits?.maxAudioLengthMins ?? -1;
      if (duration && max !== -1 && duration / 60 > max) {
        setNotice(`${file.name} is ${Math.ceil(duration / 60)} min. Your plan allows files up to ${max} min.`);
        continue;
      }
      accepted.push({ id: `f${++fileSeq}`, file, duration, isVideo });
    }
    if (!accepted.length) return;
    setFiles((prev) => (multi ? [...prev, ...accepted] : [accepted[0]]));
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  // Drop selections that the current plan can't use (e.g. after a downgrade).
  useEffect(() => {
    if (PROFILES[feature]?.premium && !premium) setFeature('noise_removal');
    if (!premium && (options.aiNotes || options.returnVideo)) setOptions((o) => ({ ...o, aiNotes: false, returnVideo: false }));
  }, [premium]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCost = files.reduce((sum, f) => sum + estimateCredits(feature, f.duration ?? 60, options), 0);
  const unknownDuration = files.some((f) => !f.duration);
  const short = credits !== null && totalCost > credits;
  const outOfDaily = enhancesLeftToday !== null && enhancesLeftToday < files.length;
  const canStart = files.length > 0 && !short && !outOfDaily;

  const start = () => {
    if (!canStart) return;
    onStart(files, feature, { ...options, returnVideo: options.returnVideo && hasVideo });
    setFiles([]);
  };

  return (
    <div className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-accent">New cleanup</p>
          <h2 className="mt-1.5 text-2xl font-extrabold tracking-tight">What are we cleaning today?</h2>
        </div>
        {enhancesLeftToday !== null && (
          <span className="chip">
            {enhancesLeftToday} of {limits?.maxDailyEnhances} left today
          </span>
        )}
      </div>

      {/* Step 1: source */}
      <StepLabel n={1} title="Add your recording" />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={`rounded-3xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-line-strong bg-sunken'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple={multi}
          accept={limits?.extractAudioFromVideo ? `${AUDIO_ACCEPT},${VIDEO_ACCEPT}` : AUDIO_ACCEPT}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <Upload className="mx-auto h-6 w-6 text-accent" />
        <p className="mt-3 font-semibold">
          Drop {multi ? 'files' : 'a file'} here, or{' '}
          <button type="button" onClick={() => inputRef.current?.click()} className="text-accent underline underline-offset-4">
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-muted">
          {limits?.extractAudioFromVideo ? 'Audio or video · MP3, WAV, M4A, FLAC, MP4, MOV and more' : 'MP3, WAV, M4A, AAC, FLAC, OGG'}
          {limits && limits.maxAudioLengthMins !== -1 && ` · up to ${limits.maxAudioLengthMins} min`}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-faint">
          <span className="h-px w-10 bg-line-strong" /> or <span className="h-px w-10 bg-line-strong" />
        </div>
        <Recorder onRecorded={(file, duration) => {
          setFiles((prev) => {
            const item = { id: `f${++fileSeq}`, file, duration, isVideo: false };
            return multi ? [...prev, item] : [item];
          });
        }} />
      </div>

      {notice && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          {!premium && /Pro|plan/.test(notice) && (
            <button type="button" onClick={onUpgrade} className="font-bold underline">Upgrade</button>
          )}
        </div>
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              {f.isVideo ? <Film className="h-5 w-5 shrink-0 text-muted" /> : <Music className="h-5 w-5 shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{f.file.name}</p>
                <p className="text-xs text-muted">
                  {f.duration ? formatDuration(f.duration) : 'Length detected after upload'} · {formatBytes(f.file.size)}
                </p>
              </div>
              <button type="button" onClick={() => removeFile(f.id)} className="rounded-full p-1.5 text-faint hover:bg-sunken hover:text-ink" aria-label={`Remove ${f.file.name}`}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Step 2: profile */}
      <StepLabel n={2} title="Choose a profile" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.values(PROFILES).map((p) => {
          const Icon = PROFILE_ICONS[p.id];
          const locked = p.premium && !premium;
          const selected = feature === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => (locked ? onUpgrade() : setFeature(p.id))}
              aria-pressed={selected}
              className={`group relative rounded-2xl border p-4 text-left transition-all ${
                selected ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`grid h-9 w-9 place-items-center rounded-xl ${selected ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted'}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-bold">{p.name}</span>
                <span className="ml-auto text-xs font-semibold text-faint">
                  {locked ? <Lock className="h-3.5 w-3.5" /> : `${p.creditsPerMin} cr/min`}
                </span>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted">{p.tagline}</p>
              {!premium && p.id === 'voice_clarity' && (
                <p className="mt-2 text-[11px] font-semibold text-warn">Filler and stutter removal needs Pro</p>
              )}
            </button>
          );
        })}
      </div>

      {feature === 'custom' && premium && (
        <div className="mt-3 grid gap-2 rounded-2xl border border-line bg-sunken p-3 sm:grid-cols-2">
          {CUSTOM_TOGGLES.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              hint={t.hint}
              checked={Boolean(options.custom[t.key])}
              onChange={(v) => set('custom', { ...options.custom, [t.key]: v })}
            />
          ))}
        </div>
      )}

      {/* Step 3: output */}
      <StepLabel n={3} title="Output" />
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">Loudness</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(LOUDNESS_TARGETS).map(([key, t]) => (
              <button
                key={key}
                type="button"
                onClick={() => set('loudness', key as JobOptions['loudness'])}
                aria-pressed={options.loudness === key}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  options.loudness === key ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="block text-[11px] text-muted">{t.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={options.returnVideo && hasVideo ? 'pointer-events-none opacity-40' : ''}>
          <p className="mb-2 text-xs font-semibold text-muted">Audio format</p>
          <div className="inline-flex rounded-full border border-line bg-surface p-1">
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set('exportFormat', f as JobOptions['exportFormat'])}
                aria-pressed={options.exportFormat === f}
                className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase transition-colors ${
                  options.exportFormat === f ? 'bg-ink text-bg' : 'text-muted hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {feature !== 'custom' && (
            <Toggle
              icon={<Music2 className="h-4 w-4" />}
              label="Protect music"
              hint="Keep intro music and worship songs intact"
              checked={options.keepMusic}
              onChange={(v) => set('keepMusic', v)}
            />
          )}
          <Toggle
            icon={<FileText className="h-4 w-4" />}
            label="AI show notes"
            hint={`Transcript, summary, chapters, social posts · +${AI_NOTES_CREDITS_PER_MIN} cr/min`}
            checked={options.aiNotes}
            locked={!premium}
            onLocked={onUpgrade}
            onChange={(v) => set('aiNotes', v)}
          />
          {hasVideo && (
            <Toggle
              icon={<Clapperboard className="h-4 w-4" />}
              label="Return the video"
              hint="Get your video back with clean audio"
              checked={options.returnVideo}
              locked={!premium}
              onLocked={onUpgrade}
              onChange={(v) => set('returnVideo', v)}
            />
          )}
        </div>
      </div>

      {/* Summary + start */}
      <div className="mt-7 flex flex-col gap-4 rounded-2xl bg-sunken p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {files.length === 0 ? (
            <span className="text-muted">Add a recording to see the cost.</span>
          ) : (
            <>
              <span className="font-bold">
                {unknownDuration ? '~' : ''}
                {totalCost} credits
              </span>
              <span className="text-muted"> · {credits ?? 0} available</span>
              {short && <p className="mt-1 text-xs font-semibold text-danger">Not enough credits for this job.</p>}
              {outOfDaily && <p className="mt-1 text-xs font-semibold text-danger">You've reached today's limit.</p>}
              {unknownDuration && !short && <p className="mt-1 text-xs text-muted">Final cost is based on the exact length.</p>}
            </>
          )}
        </div>
        {short || outOfDaily ? (
          <button type="button" onClick={onUpgrade} className="btn-ink px-6 py-3">
            {short ? 'Top up credits' : 'Upgrade for more per day'}
          </button>
        ) : (
          <button type="button" onClick={start} disabled={!canStart} className="btn-primary px-6 py-3">
            <Wand2 className="h-4 w-4" />
            {files.length > 1 ? `Clean ${files.length} files` : 'Clean it'}
          </button>
        )}
      </div>
    </div>
  );
}

function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-2.5">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[11px] font-bold text-bg">{n}</span>
      <h3 className="text-sm font-bold">{title}</h3>
    </div>
  );
}

interface ToggleProps {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  checked: boolean;
  locked?: boolean;
  onLocked?: () => void;
  onChange: (value: boolean) => void;
}

function Toggle({ label, hint, icon, checked, locked, onLocked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => (locked ? onLocked?.() : onChange(!checked))}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      {icon && <span className="text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {label} {locked && <span className="chip px-1.5 py-0 text-[10px]">Pro</span>}
        </span>
        {hint && <span className="block truncate text-[11px] text-muted">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked && !locked ? 'bg-accent' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked && !locked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

/** In-browser recording with a live level meter. */
function Recorder({ onRecorded }: { onRecorded: (file: File, duration: number) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'denied'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const cleanup = useRef<() => void>(() => {});
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => () => cleanup.current(), []);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    } catch {
      setState('denied');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    const began = Date.now();

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(peak / 128);
      setElapsed((Date.now() - began) / 1000);
      raf = requestAnimationFrame(tick);
    };
    tick();

    cleanup.current = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };

    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const duration = (Date.now() - began) / 1000;
      cleanup.current();
      const type = rec.mimeType.split(';')[0] || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : 'webm';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      onRecorded(new File(chunks, `recording-${stamp}.${ext}`, { type }), duration);
      setState('idle');
      setElapsed(0);
      setLevel(0);
    };
    rec.start(1000);
    recorder.current = rec;
    setState('recording');
  };

  if (state === 'recording') {
    return (
      <div className="mt-4 flex items-center justify-center gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-danger">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" /> {formatDuration(elapsed)}
        </span>
        <span className="flex h-6 items-end gap-0.5" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-accent transition-[height] duration-75"
              style={{ height: `${Math.max(12, Math.min(100, level * 180 * (0.5 + ((i * 7) % 5) / 8)))}%` }}
            />
          ))}
        </span>
        <button type="button" onClick={() => recorder.current?.stop()} className="btn-ink py-2">
          <Square className="h-3.5 w-3.5 fill-current" /> Stop
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={start} className="btn-ghost py-2">
        <Mic className="h-4 w-4 text-danger" /> Record in browser
      </button>
      {state === 'denied' && (
        <p className="mt-2 text-xs text-danger">Microphone access was blocked. Allow it in your browser's site settings.</p>
      )}
    </div>
  );
}
