import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Download, FileAudio, Globe, Loader2, Lock, Plus, Radio, Trash2, Upload, XCircle,
} from 'lucide-react';
import {
  ApiError,
  createSermon,
  deleteSermon,
  getSermon,
  listSermons,
  startProcessing,
  updateSermon,
  uploadMedia,
  type AudioJob,
  type Church,
  type JobOptions,
  type Sermon,
  type SermonFields,
} from '../../services/api';
import { SERMON_FEATURE, SERMON_OPTIONS, estimateCredits } from '../../shared/processing.js';
import { attachmentUrl, formatBytes, formatDuration, probeDuration } from '../../services/media';
import { Notes } from '../studio/JobDetail';
import TranscriptsPanel from '../studio/TranscriptsPanel';

const POLL_MS = 5000;
const isRunning = (s?: string) => s === 'uploading' || s === 'uploaded' || s === 'processing';

interface Props {
  church: Church;
  onActivate: () => void;
  onChanged: () => void;
}

export default function SermonsTab({ church, onActivate, onChanged }: Props) {
  const [sermons, setSermons] = useState<Sermon[] | null>(null);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string }>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSermons((await listSermons()).sermons);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load sermons.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyRunning = sermons?.some((s) => isRunning(s.file?.status));
  useEffect(() => {
    if (!anyRunning || mode.kind !== 'list') return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, load, mode.kind]);

  if (mode.kind === 'new') {
    return (
      <NewSermon
        church={church}
        onCancel={() => setMode({ kind: 'list' })}
        onCreated={(id) => {
          load();
          onChanged();
          setMode({ kind: 'detail', id });
        }}
      />
    );
  }
  if (mode.kind === 'detail') {
    return (
      <SermonDetail
        id={mode.id}
        onBack={() => {
          load();
          setMode({ kind: 'list' });
        }}
      />
    );
  }

  return (
    <div className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Sermons</h2>
          <p className="text-sm text-muted">Every sermon your team uploads, newest first.</p>
        </div>
        {church.active ? (
          <button type="button" onClick={() => setMode({ kind: 'new' })} className="btn-primary px-5 py-2.5">
            <Plus className="h-4 w-4" /> New sermon
          </button>
        ) : (
          church.role === 'owner' && (
            <button type="button" onClick={onActivate} className="btn-ink px-5 py-2.5">
              <Lock className="h-4 w-4" /> Activate to add sermons
            </button>
          )
        )}
      </div>

      {error && <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

      <div className="mt-6">
        {sermons === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-sunken" />)}</div>
        ) : sermons.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center">
            <Mic className="mx-auto" />
            <p className="mt-3 font-semibold">No sermons yet</p>
            <p className="mt-1 text-sm text-muted">
              {church.active ? 'Upload last Sunday’s recording to get started.' : 'Once the Church plan is active, your team can upload sermons here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-3xl border border-line">
            {sermons.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setMode({ kind: 'detail', id: s.id })} className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-sunken sm:px-5">
                  <StatusIcon sermon={s} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.title}</p>
                    <p className="truncate text-xs text-muted">
                      {[s.preacher, s.date && new Date(`${s.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), s.file?.durationSeconds ? formatDuration(s.file.durationSeconds) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {isRunning(s.file?.status) && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, s.file?.percent ?? 3)}%` }} />
                      </div>
                    )}
                  </div>
                  <StatusChip sermon={s} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Mic({ className = '' }: { className?: string }) {
  return <FileAudio className={`h-6 w-6 text-faint ${className}`} />;
}

function StatusIcon({ sermon }: { sermon: Sermon }) {
  const st = sermon.file?.status;
  if (isRunning(st)) return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />;
  if (st === 'failed') return <XCircle className="h-5 w-5 shrink-0 text-danger" />;
  return <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />;
}

function StatusChip({ sermon }: { sermon: Sermon }) {
  const st = sermon.file?.status;
  if (isRunning(st)) return <span className="chip shrink-0">{sermon.file?.stage || 'Cleaning'}</span>;
  if (st === 'failed') return <span className="chip shrink-0 border-danger/30 text-danger">Failed</span>;
  if (sermon.status === 'published') return <span className="chip shrink-0 border-accent/30 bg-accent-soft text-accent"><Radio className="h-3 w-3" /> On podcast</span>;
  return <span className="chip shrink-0">Draft</span>;
}

// ─── New sermon ──────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

function NewSermon({ church, onCancel, onCreated }: { church: Church; onCancel: () => void; onCreated: (id: string) => void }) {
  const [fields, setFields] = useState<SermonFields>({ title: '', preacher: '', date: today(), series: '', scripture: '', description: '' });
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [keepMusic, setKeepMusic] = useState(true);
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof SermonFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setDuration(await probeDuration(f));
    if (!fields.title) setFields((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
  };

  const cost = duration ? estimateCredits(SERMON_FEATURE, duration, SERMON_OPTIONS) : null;
  const short = cost !== null && cost > church.credits;

  const submit = async () => {
    if (!file || !fields.title.trim()) return;
    setError(null);
    try {
      setProgress({ label: 'Uploading', percent: 0 });
      const uploaded = await uploadMedia(file, duration, (p) => setProgress({ label: 'Uploading', percent: p }));
      setProgress({ label: 'Starting clean-up', percent: 100 });
      const options = { ...SERMON_OPTIONS, keepMusic } as JobOptions;
      await startProcessing(uploaded.fileId, SERMON_FEATURE, options);
      const created = await createSermon(uploaded.fileId, fields);
      onCreated(created.id);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    }
  };

  const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent';

  return (
    <div className="card p-5 sm:p-7">
      <button type="button" onClick={onCancel} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Sermons
      </button>
      <h2 className="text-2xl font-extrabold tracking-tight">New sermon</h2>
      <p className="mt-1 text-sm text-muted">We clean the sound, keep worship songs, and write the summary, chapters and social posts.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-muted">
            Sermon title *
            <input value={fields.title} onChange={set('title')} className={input} placeholder="e.g. Walking by faith" maxLength={150} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-muted">
              Preacher
              <input value={fields.preacher} onChange={set('preacher')} className={input} placeholder="e.g. Rev. Mensah" maxLength={100} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Date preached
              <input type="date" value={fields.date} onChange={set('date')} className={input} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Series
              <input value={fields.series} onChange={set('series')} className={input} placeholder="Optional" maxLength={100} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Scripture
              <input value={fields.scripture} onChange={set('scripture')} className={input} placeholder="e.g. Hebrews 11:1-6" maxLength={150} />
            </label>
          </div>
          <label className="block text-xs font-semibold text-muted">
            Description (optional)
            <textarea value={fields.description} onChange={set('description')} rows={3} className={input} maxLength={3000} placeholder="Leave empty and we will use the AI summary." />
          </label>
        </div>

        <div className="space-y-3">
          <input ref={inputRef} type="file" className="hidden" accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov" onChange={(e) => pick(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-line-strong bg-sunken px-6 py-10 text-center transition-colors hover:border-accent"
          >
            <Upload className="h-6 w-6 text-accent" />
            <span className="mt-3 font-semibold">{file ? file.name : 'Choose the service recording'}</span>
            <span className="mt-1 text-xs text-muted">
              {file ? `${duration ? formatDuration(duration) : 'Length checked on upload'} · ${formatBytes(file.size)}` : 'MP3, WAV, M4A or video · up to 150 minutes'}
            </span>
          </button>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
            <span>
              <span className="block text-sm font-semibold">Keep worship songs</span>
              <span className="block text-xs text-muted">Music stays untouched while speech is cleaned</span>
            </span>
            <input type="checkbox" checked={keepMusic} onChange={(e) => setKeepMusic(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          </label>

          <div className="rounded-2xl bg-sunken p-4 text-sm">
            {cost !== null ? (
              <>
                <p><span className="font-bold">{cost} credits</span> <span className="text-muted">from {church.credits.toLocaleString()} shared credits</span></p>
                {short && <p className="mt-1 text-xs font-semibold text-danger">Not enough shared credits for this sermon.</p>}
              </>
            ) : (
              <p className="text-muted">Choose a recording to see the cost.</p>
            )}
          </div>

          {progress && (
            <div className="rounded-2xl border border-line p-4" role="status">
              <div className="flex justify-between text-sm font-semibold">
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {progress.label}</span>
                <span className="font-mono text-muted">{progress.percent}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
          {error && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

          <button type="button" onClick={submit} disabled={!file || !fields.title.trim() || short || progress !== null} className="btn-primary w-full py-3.5">
            Upload and clean sermon
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sermon detail ───────────────────────────────────────────────

function SermonDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [job, setJob] = useState<AudioJob | null>(null);
  const [editing, setEditing] = useState<SermonFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getSermon(id);
      setSermon(res.sermon);
      setJob(res.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this sermon.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The status call also advances the cleaning job on the server.
  useEffect(() => {
    if (!job || !isRunning(job.status)) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [job, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!sermon) {
    return (
      <div className="card grid place-items-center p-16">
        {error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-accent" />}
      </div>
    );
  }

  const ready = job?.status === 'processed';
  const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent';

  return (
    <div className="space-y-5">
      <div className="card p-5 sm:p-7">
        <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Sermons
        </button>

        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(['title', 'preacher', 'series', 'scripture'] as const).map((key) => (
              <label key={key} className="block text-xs font-semibold capitalize text-muted">
                {key}
                <input value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} className={input} />
              </label>
            ))}
            <label className="block text-xs font-semibold text-muted">
              Date preached
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className={input} />
            </label>
            <label className="block text-xs font-semibold text-muted sm:col-span-2">
              Description
              <textarea rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={input} />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" disabled={busy} onClick={() => act(() => updateSermon(sermon.id, editing)).then(() => setEditing(null))} className="btn-primary">Save</button>
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-extrabold tracking-tight">{sermon.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {[sermon.preacher, sermon.scripture, sermon.series && `Series: ${sermon.series}`, sermon.date && new Date(`${sermon.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing({ title: sermon.title, preacher: sermon.preacher, date: sermon.date, series: sermon.series, scripture: sermon.scripture, description: sermon.description })} className="btn-ghost py-2">
                Edit details
              </button>
              <button
                type="button"
                aria-label="Delete sermon"
                disabled={busy}
                onClick={() => window.confirm('Delete this sermon? It will also be removed from your podcast. The audio file stays in the uploader’s library.') && act(() => deleteSermon(sermon.id)).then(onBack)}
                className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="mt-6">
          {job && isRunning(job.status) && (
            <div className="rounded-3xl border border-line bg-sunken p-6" role="status">
              <div className="flex justify-between text-sm font-semibold">
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {job.stage || 'Cleaning'}</span>
                <span className="font-mono text-muted">{job.percent ?? 3}%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, job.percent ?? 3)}%` }} />
              </div>
              <p className="mt-4 text-sm text-muted">A one-hour service usually takes 5 to 15 minutes. You can leave this page.</p>
            </div>
          )}
          {job?.status === 'failed' && (
            <p className="rounded-3xl bg-danger-soft p-5 text-sm text-danger">{job.error || 'Cleaning failed.'} The credits were refunded.</p>
          )}
          {ready && job?.processedFileUrl && (
            <div className="space-y-5">
              <audio src={job.processedFileUrl} controls preload="metadata" className="w-full" />
              <div className="flex flex-col gap-3 rounded-3xl border border-line p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 font-bold">
                    {sermon.status === 'published' ? <Globe className="h-4 w-4 text-accent" /> : <Radio className="h-4 w-4 text-muted" />}
                    {sermon.status === 'published' ? 'Published on your podcast' : 'Not on your podcast yet'}
                  </p>
                  <p className="mt-1 text-xs text-muted">Published sermons appear in your feed within minutes. Apps like Spotify check a few times a day.</p>
                </div>
                <div className="flex gap-2">
                  <a href={attachmentUrl(job.processedFileUrl, sermon.title)} className="btn-ghost py-2.5">
                    <Download className="h-4 w-4" /> MP3
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(() => updateSermon(sermon.id, { status: sermon.status === 'published' ? 'draft' : 'published' }))}
                    className={sermon.status === 'published' ? 'btn-ghost py-2.5' : 'btn-primary py-2.5'}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {sermon.status === 'published' ? 'Unpublish' : 'Publish to podcast'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
        </div>
      </div>

      {ready && job && (
        <>
          {job.hasNotes && (
            <div className="card p-5 sm:p-7">
              <h3 className="mb-4 text-lg font-bold">Sermon notes</h3>
              <Notes job={job} />
            </div>
          )}
          <TranscriptsPanel job={job} />
        </>
      )}
    </div>
  );
}
