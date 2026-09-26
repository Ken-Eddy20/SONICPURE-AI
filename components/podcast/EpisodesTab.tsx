import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Download, FileAudio, Globe, Loader2, Lock, Plus, Radio, Trash2, Upload, XCircle,
} from 'lucide-react';
import {
  ApiError,
  EMPTY_EPISODE,
  createEpisode,
  deleteEpisode,
  getEpisode,
  listEpisodes,
  startProcessing,
  updateEpisode,
  uploadMedia,
  type AudioJob,
  type Episode,
  type EpisodeFields,
  type JobOptions,
  type Show,
} from '../../services/api';
import { EPISODE_FEATURE, EPISODE_OPTIONS, estimateCredits, showType } from '../../shared/processing.js';
import { attachmentUrl, formatBytes, formatDuration, probeDuration } from '../../services/media';
import { Notes } from '../studio/JobDetail';
import TranscriptsPanel from '../studio/TranscriptsPanel';

const POLL_MS = 5000;
const isRunning = (s?: string) => s === 'uploading' || s === 'uploaded' || s === 'processing';
const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent';
type Labels = ReturnType<typeof showType>;

interface Props {
  show: Show;
  onActivate: () => void;
  onChanged: () => void;
}

export default function EpisodesTab({ show, onActivate, onChanged }: Props) {
  const t = showType(show.type);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string }>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEpisodes((await listEpisodes()).episodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the list.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyRunning = episodes?.some((e) => isRunning(e.file?.status));
  useEffect(() => {
    if (!anyRunning || mode.kind !== 'list') return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, load, mode.kind]);

  if (mode.kind === 'new') {
    return (
      <NewEpisode
        show={show}
        t={t}
        nextNumber={t.numbered ? Math.max(0, ...(episodes || []).map((e) => e.episode || 0)) + 1 : null}
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
      <EpisodeDetail
        id={mode.id}
        t={t}
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
          <h2 className="text-xl font-extrabold tracking-tight">{t.items}</h2>
          <p className="text-sm text-muted">Everything your team uploads, newest first.</p>
        </div>
        {show.active ? (
          <button type="button" onClick={() => setMode({ kind: 'new' })} className="btn-primary px-5 py-2.5">
            <Plus className="h-4 w-4" /> New {t.item.toLowerCase()}
          </button>
        ) : (
          show.role === 'owner' && (
            <button type="button" onClick={onActivate} className="btn-ink px-5 py-2.5">
              <Lock className="h-4 w-4" /> Activate to add {t.items.toLowerCase()}
            </button>
          )
        )}
      </div>

      {error && <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

      <div className="mt-6">
        {episodes === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-sunken" />)}</div>
        ) : episodes.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center">
            <FileAudio className="mx-auto h-6 w-6 text-faint" />
            <p className="mt-3 font-semibold">No {t.items.toLowerCase()} yet</p>
            <p className="mt-1 text-sm text-muted">
              {show.active
                ? show.type === 'church' ? 'Upload last Sunday’s recording to get started.' : 'Upload your first recording, or record one in the Record & edit tab.'
                : `Once a plan is active, your team can upload ${t.items.toLowerCase()} here.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-3xl border border-line">
            {episodes.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setMode({ kind: 'detail', id: e.id })} className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-sunken sm:px-5">
                  <StatusIcon episode={e} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {e.episode ? <span className="mr-1.5 font-mono text-xs text-muted">#{e.episode}</span> : null}
                      {e.title}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[
                        e.speaker,
                        e.date && new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
                        e.file?.durationSeconds ? formatDuration(e.file.durationSeconds) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {isRunning(e.file?.status) && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, e.file?.percent ?? 3)}%` }} />
                      </div>
                    )}
                  </div>
                  <StatusChip episode={e} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ episode }: { episode: Episode }) {
  const st = episode.file?.status;
  if (isRunning(st)) return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />;
  if (st === 'failed') return <XCircle className="h-5 w-5 shrink-0 text-danger" />;
  return <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />;
}

function StatusChip({ episode }: { episode: Episode }) {
  const st = episode.file?.status;
  if (isRunning(st)) return <span className="chip shrink-0">{episode.file?.stage || 'Cleaning'}</span>;
  if (st === 'failed') return <span className="chip shrink-0 border-danger/30 text-danger">Failed</span>;
  if (episode.status === 'published') return <span className="chip shrink-0 border-accent/30 bg-accent-soft text-accent"><Radio className="h-3 w-3" /> On podcast</span>;
  return <span className="chip shrink-0">Draft</span>;
}

/** The detail fields for a show type: speaker, guests, series, reference, numbering. */
function DetailFields({ t, fields, onChange }: { t: Labels; fields: EpisodeFields; onChange: (f: EpisodeFields) => void }) {
  const text = (key: 'speaker' | 'guests' | 'series' | 'reference') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...fields, [key]: e.target.value });
  const num = (key: 'season' | 'episode') => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...fields, [key]: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs font-semibold text-muted">
        {t.speaker}
        <input value={fields.speaker} onChange={text('speaker')} className={input} placeholder={t.speakerPlaceholder} maxLength={100} />
      </label>
      <label className="block text-xs font-semibold text-muted">
        {t.item === 'Sermon' ? 'Date preached' : 'Recorded on'}
        <input type="date" value={fields.date} onChange={(e) => onChange({ ...fields, date: e.target.value })} className={input} />
      </label>
      {t.guests && (
        <label className="block text-xs font-semibold text-muted">
          {t.guests}
          <input value={fields.guests} onChange={text('guests')} className={input} placeholder="Optional, comma separated" maxLength={200} />
        </label>
      )}
      {t.series && (
        <label className="block text-xs font-semibold text-muted">
          {t.series}
          <input value={fields.series} onChange={text('series')} className={input} placeholder="Optional" maxLength={100} />
        </label>
      )}
      {t.reference && (
        <label className="block text-xs font-semibold text-muted">
          {t.reference}
          <input value={fields.reference} onChange={text('reference')} className={input} placeholder={t.referencePlaceholder} maxLength={150} />
        </label>
      )}
      {t.numbered && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-muted">
            Season
            <input type="number" min={1} value={fields.season ?? ''} onChange={num('season')} className={input} placeholder="–" />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Episode no.
            <input type="number" min={1} value={fields.episode ?? ''} onChange={num('episode')} className={input} placeholder="–" />
          </label>
        </div>
      )}
    </div>
  );
}

// ─── New episode ─────────────────────────────────────────────────

function NewEpisode({ show, t, nextNumber, onCancel, onCreated }: { show: Show; t: Labels; nextNumber: number | null; onCancel: () => void; onCreated: (id: string) => void }) {
  const [fields, setFields] = useState<EpisodeFields>({ ...EMPTY_EPISODE, date: new Date().toISOString().slice(0, 10), episode: nextNumber });
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [keepMusic, setKeepMusic] = useState(true);
  const [progress, setProgress] = useState<{ label: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setDuration(await probeDuration(f));
    if (!fields.title) setFields((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
  };

  const cost = duration ? estimateCredits(EPISODE_FEATURE, duration, EPISODE_OPTIONS) : null;
  const short = cost !== null && cost > show.credits;

  const submit = async () => {
    if (!file || !fields.title.trim()) return;
    setError(null);
    try {
      setProgress({ label: 'Uploading', percent: 0 });
      const uploaded = await uploadMedia(file, duration, (p) => setProgress({ label: 'Uploading', percent: p }));
      setProgress({ label: 'Starting clean-up', percent: 100 });
      await startProcessing(uploaded.fileId, EPISODE_FEATURE, { ...EPISODE_OPTIONS, keepMusic } as JobOptions);
      const created = await createEpisode(uploaded.fileId, fields);
      onCreated(created.id);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    }
  };

  return (
    <div className="card p-5 sm:p-7">
      <button type="button" onClick={onCancel} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {t.items}
      </button>
      <h2 className="text-2xl font-extrabold tracking-tight">New {t.item.toLowerCase()}</h2>
      <p className="mt-1 text-sm text-muted">We clean the sound, keep the music, and write the summary, chapters and social posts.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-muted">
            Title *
            <input
              value={fields.title}
              onChange={(e) => setFields({ ...fields, title: e.target.value })}
              className={input}
              placeholder={show.type === 'church' ? 'e.g. Walking by faith' : 'e.g. Starting a business with GHS 500'}
              maxLength={150}
            />
          </label>
          <DetailFields t={t} fields={fields} onChange={setFields} />
          <label className="block text-xs font-semibold text-muted">
            Description (optional)
            <textarea value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} rows={3} className={input} maxLength={3000} placeholder="Leave empty and we will use the AI summary." />
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
            <span className="mt-3 font-semibold">{file ? file.name : 'Choose the recording'}</span>
            <span className="mt-1 text-xs text-muted">
              {file ? `${duration ? formatDuration(duration) : 'Length checked on upload'} · ${formatBytes(file.size)}` : 'MP3, WAV, M4A or video'}
            </span>
          </button>

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
            <span>
              <span className="block text-sm font-semibold">{t.keepMusicLabel}</span>
              <span className="block text-xs text-muted">Music stays untouched while speech is cleaned</span>
            </span>
            <input type="checkbox" checked={keepMusic} onChange={(e) => setKeepMusic(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          </label>

          <div className="rounded-2xl bg-sunken p-4 text-sm">
            {cost !== null ? (
              <>
                <p><span className="font-bold">{cost} credits</span> <span className="text-muted">from {show.credits.toLocaleString()} shared credits</span></p>
                {short && <p className="mt-1 text-xs font-semibold text-danger">Not enough shared credits for this recording.</p>}
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
            Upload and clean {t.item.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Episode detail ──────────────────────────────────────────────

const toFields = (e: Episode): EpisodeFields => ({
  title: e.title, speaker: e.speaker, guests: e.guests, series: e.series, reference: e.reference,
  season: e.season, episode: e.episode, date: e.date, description: e.description,
});

function EpisodeDetail({ id, t, onBack }: { id: string; t: Labels; onBack: () => void }) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [job, setJob] = useState<AudioJob | null>(null);
  const [editing, setEditing] = useState<EpisodeFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getEpisode(id);
      setEpisode(res.episode);
      setJob(res.job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this recording.');
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
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!episode) {
    return (
      <div className="card grid place-items-center p-16">
        {error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-accent" />}
      </div>
    );
  }

  const ready = job?.status === 'processed';
  const meta = [
    episode.season && `Season ${episode.season}`,
    episode.episode && `Episode ${episode.episode}`,
    episode.speaker,
    episode.guests && `with ${episode.guests}`,
    episode.reference,
    episode.series && `${t.series || 'Series'}: ${episode.series}`,
    episode.date && new Date(`${episode.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="card p-5 sm:p-7">
        <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t.items}
        </button>

        {editing ? (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-muted">
              Title
              <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={input} maxLength={150} />
            </label>
            <DetailFields t={t} fields={editing} onChange={setEditing} />
            <label className="block text-xs font-semibold text-muted">
              Description
              <textarea rows={3} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={input} maxLength={3000} />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !editing.title.trim()} onClick={() => act(() => updateEpisode(episode.id, editing)).then((ok) => ok && setEditing(null))} className="btn-primary">
                Save
              </button>
              <button type="button" onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-extrabold tracking-tight">{episode.title}</h2>
              <p className="mt-1 text-sm text-muted">{meta.join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(toFields(episode))} className="btn-ghost py-2">
                Edit details
              </button>
              <button
                type="button"
                aria-label={`Delete ${t.item.toLowerCase()}`}
                disabled={busy}
                onClick={() =>
                  window.confirm(`Delete this ${t.item.toLowerCase()}? It will also be removed from your podcast. The audio file stays in the uploader’s library.`) &&
                  act(() => deleteEpisode(episode.id)).then((ok) => ok && onBack())
                }
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
              <p className="mt-4 text-sm text-muted">A one-hour recording usually takes 5 to 15 minutes. You can leave this page.</p>
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
                    {episode.status === 'published' ? <Globe className="h-4 w-4 text-accent" /> : <Radio className="h-4 w-4 text-muted" />}
                    {episode.status === 'published' ? 'Published on your podcast' : 'Not on your podcast yet'}
                  </p>
                  <p className="mt-1 text-xs text-muted">Published {t.items.toLowerCase()} appear in your feed within minutes. Spotify and Apple check a few times a day.</p>
                </div>
                <div className="flex gap-2">
                  <a href={attachmentUrl(job.processedFileUrl, episode.title)} className="btn-ghost py-2.5">
                    <Download className="h-4 w-4" /> MP3
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(() => updateEpisode(episode.id, { status: episode.status === 'published' ? 'draft' : 'published' }))}
                    className={episode.status === 'published' ? 'btn-ghost py-2.5' : 'btn-primary py-2.5'}
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {episode.status === 'published' ? 'Unpublish' : 'Publish to podcast'}
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
              <h3 className="mb-4 text-lg font-bold">{t.item} notes</h3>
              <Notes job={job} />
            </div>
          )}
          <TranscriptsPanel job={job} />
        </>
      )}
    </div>
  );
}
