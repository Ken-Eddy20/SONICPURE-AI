import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Copy, Check, Download, FileText, Languages, Loader2, Pencil,
  Plus, Search, Sparkles, Trash2, Upload, Users, XCircle,
} from 'lucide-react';
import {
  ApiError,
  deleteMeeting,
  getMeeting,
  getMeetingConfig,
  listMeetings,
  regenerateMinutes,
  updateMeeting,
  uploadMeeting,
  type Meeting,
  type MeetingConfig,
  type MeetingMinutes,
  type MeetingSegment,
} from '../../services/api';
import {
  MINUTES_CREDITS_PER_HOUR,
  TRANSCRIBE_LANGUAGES,
  estimateMeetingCredits,
  languageName,
  translationPair,
} from '../../shared/processing.js';
import { downloadText, downloadWordDoc, escapeHtml, formatBytes, formatDuration, probeDuration, toSrt, toVtt } from '../../services/media';

const POLL_MS = 5000;
const running = (s: Meeting['status']) => s === 'uploading' || s === 'processing';

interface Props {
  credits: number | null;
  onUpgrade: () => void;
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string };

export default function MeetingsView({ credits, onUpgrade }: Props) {
  const [config, setConfig] = useState<MeetingConfig | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMeetings((await listMeetings()).meetings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your meetings.');
    }
  }, []);

  useEffect(() => {
    getMeetingConfig().then(setConfig).catch(() => setConfig(null));
    load();
  }, [load]);

  const busy = meetings?.some((m) => m.status === 'processing');
  useEffect(() => {
    if (!busy || mode.kind !== 'list') return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load, mode.kind]);

  if (mode.kind === 'new') {
    return (
      <NewMeeting
        config={config}
        credits={credits}
        onUpgrade={onUpgrade}
        onCancel={() => setMode({ kind: 'list' })}
        onCreated={(id) => {
          load();
          setMode({ kind: 'detail', id });
        }}
      />
    );
  }
  if (mode.kind === 'detail') {
    return (
      <MeetingDetail
        id={mode.id}
        minutesEnabled={Boolean(config?.minutes)}
        onUpgrade={onUpgrade}
        onBack={() => {
          load();
          setMode({ kind: 'list' });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div>
          <p className="eyebrow text-accent">Meetings</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Hours of talking, <span className="display italic">minutes to read.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Upload a meeting recording, audio or video, even several hours long. Get a full transcript with speakers,
            an English translation for local-language meetings, and minutes with decisions and action items.
          </p>
        </div>
        <button type="button" onClick={() => setMode({ kind: 'new' })} className="btn-primary shrink-0 px-6 py-3">
          <Plus className="h-4 w-4" /> New meeting
        </button>
      </div>

      {error && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

      <div className="card p-2 sm:p-3">
        {meetings === null ? (
          <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-sunken" />)}</div>
        ) : meetings.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <ClipboardList className="mx-auto h-7 w-7 text-faint" />
            <p className="mt-3 font-semibold">No meetings yet</p>
            <p className="mt-1 text-sm text-muted">Board meetings, staff briefings, AGMs, interviews, lectures: upload the recording to start.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setMode({ kind: 'detail', id: m.id })} className="flex w-full items-center gap-4 rounded-2xl px-3 py-4 text-left hover:bg-sunken sm:px-4">
                  {running(m.status) ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent" />
                  ) : m.status === 'failed' ? (
                    <XCircle className="h-5 w-5 shrink-0 text-danger" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{m.title}</p>
                    <p className="truncate text-xs text-muted">
                      {[
                        m.date && new Date(`${m.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
                        languageName(m.language),
                        m.durationSeconds ? formatDuration(m.durationSeconds) : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {m.status === 'processing' && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, m.percent ?? 3)}%` }} />
                      </div>
                    )}
                  </div>
                  <span className="chip shrink-0">
                    {m.status === 'processing' ? m.stage || 'Working' : m.status === 'uploading' ? 'Upload not finished' : m.status === 'failed' ? 'Failed' : m.minutes ? 'Minutes ready' : 'Transcript ready'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── New meeting ─────────────────────────────────────────────────

function NewMeeting({
  config,
  credits,
  onUpgrade,
  onCancel,
  onCreated,
}: {
  config: MeetingConfig | null;
  credits: number | null;
  onUpgrade: () => void;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [language, setLanguage] = useState('eng');
  const [translate, setTranslate] = useState(true);
  const [minutes, setMinutes] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number; started: number } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isEnglish = language === 'eng';
  const canTranslate = !isEnglish && Boolean(translationPair(language, 'eng'));
  const minutesOn = Boolean(config?.minutes) && minutes && (isEnglish || canTranslate);
  const translateOn = !isEnglish && canTranslate && (translate || minutesOn);
  const languageAvailable = isEnglish ? Boolean(config?.englishSpeakers || config?.localLanguages) : Boolean(config?.localLanguages);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setFile(f);
    setDuration(await probeDuration(f));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  };

  const tooBig = file && config ? file.size > config.maxBytes : false;
  const tooLong = duration && config ? duration / 60 > config.maxMinutes : false;
  const cost = duration ? estimateMeetingCredits(duration, { translate: translateOn, minutes: minutesOn }) : null;
  const short = cost !== null && credits !== null && cost > credits;

  const start = async () => {
    if (!file) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ sent: 0, total: file.size, started: Date.now() });
    try {
      const res = await uploadMeeting(
        file,
        { title: title.trim(), date, language, translate: translateOn, minutes: minutesOn },
        (sent, total) => setProgress((p) => ({ sent, total, started: p?.started ?? Date.now() })),
        controller.signal,
      );
      onCreated(res.id);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError ? err : new ApiError(0, { error: 'Upload failed. Try again.' }));
    }
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  const percent = progress ? Math.round((progress.sent / progress.total) * 100) : 0;
  const speed = progress && progress.sent > 0 ? progress.sent / ((Date.now() - progress.started) / 1000) : 0;
  const eta = speed > 0 && progress ? (progress.total - progress.sent) / speed : null;
  const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent';

  return (
    <div className="card p-5 sm:p-7">
      <button type="button" onClick={onCancel} disabled={progress !== null} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Meetings
      </button>
      <h2 className="text-2xl font-extrabold tracking-tight">New meeting</h2>
      <p className="mt-1 text-sm text-muted">Audio or video, up to {config ? Math.floor(config.maxMinutes / 60) : '…'} hours on your plan and 3 GB per file.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block text-xs font-semibold text-muted">
            Meeting title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Board meeting, September" maxLength={150} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Date of the meeting
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Main language spoken
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={input}>
              {TRANSCRIBE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          {config && !languageAvailable && (
            <p className="flex gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {languageName(language)} transcription is not switched on yet on this server.
            </p>
          )}
          {isEnglish && config?.englishSpeakers && (
            <p className="flex items-center gap-2 text-xs text-muted"><Users className="h-3.5 w-3.5 text-accent" /> English meetings are split by speaker.</p>
          )}

          <div className="space-y-2">
            {!isEnglish && (
              <Switch
                label="Translate to English"
                hint={canTranslate ? 'Full English version of the transcript' : `Not available for ${languageName(language)} yet`}
                checked={translateOn}
                disabled={!canTranslate || minutesOn}
                onChange={setTranslate}
              />
            )}
            <Switch
              label="Write the minutes"
              hint={
                !config?.minutes
                  ? 'Not switched on yet on this server'
                  : !isEnglish && !canTranslate
                    ? 'Needs an English translation'
                    : `Summary, decisions, action items · ${MINUTES_CREDITS_PER_HOUR} credits per hour`
              }
              checked={minutesOn}
              disabled={!config?.minutes || (!isEnglish && !canTranslate)}
              onChange={setMinutes}
            />
          </div>
        </div>

        <div className="space-y-4">
          <input ref={inputRef} type="file" className="hidden" accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.mkv,.webm" onChange={(e) => pick(e.target.files?.[0])} />
          <button
            type="button"
            disabled={progress !== null}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-line-strong bg-sunken px-6 py-10 text-center transition-colors hover:border-accent disabled:opacity-60"
          >
            <Upload className="h-6 w-6 text-accent" />
            <span className="mt-3 max-w-full truncate font-semibold">{file ? file.name : 'Choose the meeting recording'}</span>
            <span className="mt-1 text-xs text-muted">
              {file ? `${duration ? formatDuration(duration) : 'Length checked after upload'} · ${formatBytes(file.size)}` : 'Zoom, Google Meet, Teams, phone or camera recordings'}
            </span>
          </button>

          {tooBig && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">This file is over 3 GB. Export it at a lower quality, or as audio only (M4A or MP3).</p>}
          {tooLong && config && (
            <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
              This recording is {Math.ceil(duration! / 60)} min. Your plan allows up to {config.maxMinutes} min.{' '}
              <button type="button" onClick={onUpgrade} className="font-bold underline">Upgrade</button>
            </p>
          )}

          <div className="rounded-2xl bg-sunken p-4 text-sm">
            {cost !== null ? (
              <>
                <p><span className="font-bold">{cost} credits</span> <span className="text-muted">· {credits ?? 0} available</span></p>
                <p className="mt-1 text-xs text-muted">
                  Transcript{translateOn ? ' + translation' : ''}{minutesOn ? ' + minutes' : ''}. Charged when processing starts; refunded if it fails.
                </p>
                {short && (
                  <p className="mt-2 text-xs font-semibold text-danger">
                    Not enough credits. <button type="button" onClick={onUpgrade} className="underline">Top up</button>
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted">{file ? 'The exact cost is shown once the length is known.' : 'Choose a recording to see the cost.'}</p>
            )}
          </div>

          {progress && (
            <div className="rounded-2xl border border-line p-4" role="status">
              <div className="flex justify-between text-sm font-semibold">
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> Uploading</span>
                <span className="font-mono text-muted">{percent}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatBytes(progress.sent)} of {formatBytes(progress.total)}
                {eta !== null && eta > 5 ? ` · about ${formatDuration(eta)} left` : ''}. Keep this tab open until the upload finishes.
              </p>
              <button type="button" onClick={() => abortRef.current?.abort()} className="mt-2 text-xs font-semibold text-danger">Cancel upload</button>
            </div>
          )}

          {error && (
            <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {error.message}{' '}
              {error.wantsUpgrade && <button type="button" onClick={onUpgrade} className="font-bold underline">Top up</button>}
            </p>
          )}

          <button
            type="button"
            onClick={start}
            disabled={!file || !title.trim() || tooBig || Boolean(tooLong) || short || !languageAvailable || progress !== null}
            className="btn-primary w-full py-3.5"
          >
            <FileText className="h-4 w-4" /> Upload and transcribe
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ─── Meeting detail ──────────────────────────────────────────────

type Tab = 'minutes' | 'transcript' | 'english';

function MeetingDetail({ id, minutesEnabled, onBack, onUpgrade }: { id: string; minutesEnabled: boolean; onBack: () => void; onUpgrade: () => void }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcript, setTranscript] = useState<MeetingSegment[]>([]);
  const [translation, setTranslation] = useState<MeetingSegment[]>([]);
  const [tab, setTab] = useState<Tab>('minutes');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await getMeeting(id);
      setMeeting(res.meeting);
      setTranscript(res.transcript);
      setTranslation(res.translation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this meeting.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!meeting || meeting.status !== 'processing') return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [meeting, load]);
  useEffect(() => {
    if (meeting?.status === 'done' && !meeting.minutes && tab === 'minutes') setTab('transcript');
  }, [meeting, tab]);

  const names = meeting?.speakerNames || {};
  const named = useCallback((segs: MeetingSegment[]) => segs.map((s) => (s.speaker && names[s.speaker] ? { ...s, speaker: names[s.speaker] } : s)), [names]);

  const seek = (t: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    el.play().catch(() => {});
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(e?.message || 'That did not work. Try again.');
      if (e?.wantsUpgrade) onUpgrade();
    } finally {
      setBusy(false);
    }
  };

  if (!meeting) {
    return <div className="card grid place-items-center p-16">{error ? <p className="text-sm text-danger">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-accent" />}</div>;
  }

  const speakers = [...new Set(transcript.map((s) => s.speaker).filter(Boolean))] as string[];
  const done = meeting.status === 'done';

  return (
    <div className="space-y-5">
      <div className="card p-5 sm:p-7">
        <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Meetings
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-extrabold tracking-tight">{meeting.title}</h2>
            <p className="mt-1 text-sm text-muted">
              {[
                meeting.date && new Date(`${meeting.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
                languageName(meeting.language),
                meeting.durationSeconds ? formatDuration(meeting.durationSeconds) : null,
                meeting.creditsUsed ? `${meeting.creditsUsed} credits` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          {!running(meeting.status) && (
            <button
              type="button"
              aria-label="Delete meeting"
              disabled={busy}
              onClick={() => window.confirm('Delete this meeting, its audio, transcript and minutes?') && act(() => deleteMeeting(meeting.id)).then(onBack)}
              className="grid h-10 w-10 place-items-center rounded-full text-faint hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-6">
          {meeting.status === 'processing' && (
            <div className="rounded-3xl border border-line bg-sunken p-6" role="status">
              <div className="flex justify-between text-sm font-semibold">
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-accent" /> {meeting.stage || 'Working'}</span>
                <span className="font-mono text-muted">{meeting.percent ?? 1}%</span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, meeting.percent ?? 1)}%` }} />
              </div>
              <p className="mt-4 text-sm text-muted">A one-hour meeting usually takes 5 to 15 minutes. You can close this page; we keep working.</p>
            </div>
          )}
          {meeting.status === 'uploading' && (
            <p className="rounded-3xl bg-warn-soft p-5 text-sm text-warn">This upload did not finish. Delete it and upload the recording again.</p>
          )}
          {meeting.status === 'failed' && (
            <p className="rounded-3xl bg-danger-soft p-5 text-sm text-danger">{meeting.error || 'Processing failed.'} Any credits were refunded.</p>
          )}
          {done && meeting.audioUrl && <audio ref={audioRef} src={meeting.audioUrl} controls preload="metadata" className="w-full" />}
          {error && <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
        </div>
      </div>

      {done && (
        <>
          {speakers.length > 1 && <SpeakerNames speakers={speakers} names={names} onSave={(n) => act(() => updateMeeting(meeting.id, { speakerNames: n }))} busy={busy} />}

          <div className="card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 scrollbar-thin" role="tablist">
                {([
                  ['minutes', 'Minutes', Sparkles],
                  ['transcript', `Transcript (${languageName(meeting.language)})`, FileText],
                  ...(translation.length ? [['english', 'English translation', Languages]] : []),
                ] as [Tab, string, typeof FileText][]).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${tab === key ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              {tab === 'minutes' && (
                <MinutesPanel
                  meeting={meeting}
                  enabled={minutesEnabled}
                  busy={busy}
                  onSeek={seek}
                  onGenerate={() => act(() => regenerateMinutes(meeting.id))}
                />
              )}
              {tab === 'transcript' && <TranscriptPanel meeting={meeting} segments={named(transcript)} onSeek={seek} suffix={meeting.language} />}
              {tab === 'english' && <TranscriptPanel meeting={meeting} segments={named(translation)} onSeek={seek} suffix="eng" />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SpeakerNames({ speakers, names, onSave, busy }: { speakers: string[]; names: Record<string, string>; onSave: (n: Record<string, string>) => void; busy: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>(names);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(names), [names]);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          <h3 className="font-bold">Who spoke</h3>
          <span className="text-xs text-muted">Name the speakers so the transcript and minutes read properly.</span>
        </div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn-ghost py-1.5 text-xs"><Pencil className="h-3.5 w-3.5" /> Rename</button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {speakers.map((s) => (
            <label key={s} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="w-20 shrink-0 text-xs font-semibold text-muted">{s}</span>
              <input value={draft[s] || ''} onChange={(e) => setDraft({ ...draft, [s]: e.target.value })} placeholder="e.g. Mrs. Owusu" className="min-w-0 flex-1 bg-transparent outline-none" maxLength={60} />
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
            <button type="button" disabled={busy} onClick={() => { onSave(draft); setEditing(false); }} className="btn-primary py-2">Save names</button>
            <button type="button" onClick={() => { setDraft(names); setEditing(false); }} className="btn-ghost py-2">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {speakers.map((s) => <span key={s} className="chip">{names[s] ? `${names[s]} (${s})` : s}</span>)}
        </div>
      )}
    </div>
  );
}

function minutesHtml(meeting: Meeting, m: MeetingMinutes) {
  const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '<p>None recorded.</p>');
  return `<h1>${escapeHtml(meeting.title)}</h1>
<p class="t">${escapeHtml(meeting.date)} · ${escapeHtml(languageName(meeting.language))} · ${formatDuration(meeting.durationSeconds)}</p>
<h2>Summary</h2><p>${escapeHtml(m.summary).replace(/\n/g, '<br>')}</p>
<h2>Key points</h2>${list(m.keyPoints)}
<h2>Decisions</h2>${list(m.decisions)}
<h2>Action items</h2>${m.actionItems.length ? `<table><tr><th>Task</th><th>Owner</th><th>Due</th></tr>${m.actionItems.map((a) => `<tr><td>${escapeHtml(a.task)}</td><td>${escapeHtml(a.owner || '–')}</td><td>${escapeHtml(a.due || '–')}</td></tr>`).join('')}</table>` : '<p>None recorded.</p>'}
<h2>Topics</h2>${m.topics.length ? `<ul>${m.topics.map((t) => `<li>${formatDuration(t.start)} ${escapeHtml(t.title)}</li>`).join('')}</ul>` : '<p>–</p>'}
<p class="t">Minutes drafted by AI from the recording. Please review before circulating.</p>`;
}

function minutesText(meeting: Meeting, m: MeetingMinutes) {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- None recorded');
  return [
    meeting.title,
    `${meeting.date} · ${formatDuration(meeting.durationSeconds)}`,
    '',
    'SUMMARY',
    m.summary,
    '',
    'KEY POINTS',
    list(m.keyPoints),
    '',
    'DECISIONS',
    list(m.decisions),
    '',
    'ACTION ITEMS',
    m.actionItems.length ? m.actionItems.map((a) => `- ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, due ${a.due}` : ''}`).join('\n') : '- None recorded',
  ].join('\n');
}

function MinutesPanel({ meeting, enabled, busy, onSeek, onGenerate }: { meeting: Meeting; enabled: boolean; busy: boolean; onSeek: (t: number) => void; onGenerate: () => void }) {
  const [copied, setCopied] = useState(false);
  const m = meeting.minutes;
  const hours = Math.max(1, Math.ceil((meeting.durationSeconds || 60) / 3600));

  if (!m) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-accent" />
        <p className="mt-3 font-semibold">{meeting.minutesError ? 'The minutes could not be written' : 'No minutes yet'}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          {meeting.minutesError
            ? 'The transcript is ready and the minutes credits were refunded. You can try again.'
            : 'Get a summary, the decisions taken and a list of action items with owners and deadlines.'}
        </p>
        {enabled ? (
          <button type="button" disabled={busy} onClick={onGenerate} className="btn-primary mt-5 px-6 py-3">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write minutes · {hours * MINUTES_CREDITS_PER_HOUR} credits
          </button>
        ) : (
          <p className="mt-4 text-xs text-muted">Minutes are not switched on yet on this server.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => downloadWordDoc(`${meeting.title} - minutes`, meeting.title, minutesHtml(meeting, m))} className="btn-primary py-2 text-xs">
          <Download className="h-3.5 w-3.5" /> Word (.doc)
        </button>
        <button type="button" onClick={() => navigator.clipboard.writeText(minutesText(meeting, m)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} className="btn-ghost py-2 text-xs">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy for WhatsApp or email'}
        </button>
        {enabled && (
          <button type="button" disabled={busy} onClick={() => window.confirm(`Rewrite the minutes (for example after naming the speakers)? This costs ${hours * MINUTES_CREDITS_PER_HOUR} credits.`) && onGenerate()} className="btn-ghost py-2 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Rewrite
          </button>
        )}
      </div>

      <section>
        <p className="eyebrow">Summary</p>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{m.summary}</p>
      </section>

      {m.keyPoints.length > 0 && (
        <section>
          <p className="eyebrow">Key points</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">{m.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </section>
      )}

      <section>
        <p className="eyebrow">Decisions</p>
        {m.decisions.length ? (
          <ul className="mt-2 space-y-2">{m.decisions.map((d, i) => <li key={i} className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {d}</li>)}</ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No decisions were recorded.</p>
        )}
      </section>

      <section>
        <p className="eyebrow">Action items</p>
        {m.actionItems.length ? (
          <div className="mt-2 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr><th className="px-4 py-2.5 font-semibold">Task</th><th className="px-4 py-2.5 font-semibold">Owner</th><th className="px-4 py-2.5 font-semibold">Due</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {m.actionItems.map((a, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">{a.task}</td>
                    <td className="px-4 py-3 font-semibold">{a.owner || <span className="text-faint">–</span>}</td>
                    <td className="px-4 py-3">{a.due || <span className="text-faint">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No action items were recorded.</p>
        )}
      </section>

      {m.topics.length > 0 && (
        <section>
          <p className="eyebrow">Topics</p>
          <ul className="mt-2 space-y-1.5">
            {m.topics.map((t, i) => (
              <li key={i}>
                <button type="button" onClick={() => onSeek(t.start)} className="flex gap-3 text-left text-sm hover:text-accent">
                  <span className="w-14 shrink-0 font-mono text-xs leading-5 text-accent">{formatDuration(t.start)}</span> {t.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-faint">Minutes drafted by AI from the recording. Review before circulating.</p>
    </div>
  );
}

function TranscriptPanel({ meeting, segments, onSeek, suffix }: { meeting: Meeting; segments: MeetingSegment[]; onSeek: (t: number) => void; suffix: string }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? segments.filter((s) => s.text.toLowerCase().includes(q) || s.speaker?.toLowerCase().includes(q)) : segments), [segments, q]);
  const base = `${meeting.title} - ${suffix}`;
  const plain = segments.map((s) => `[${formatDuration(s.start)}]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`).join('\n');
  const doc = `<h1>${escapeHtml(meeting.title)}</h1><p class="t">${escapeHtml(meeting.date)} · Transcript (${escapeHtml(languageName(suffix))})</p>${segments
    .map((s) => `<p><span class="t">${formatDuration(s.start)}</span> ${s.speaker ? `<b>${escapeHtml(s.speaker)}:</b> ` : ''}${escapeHtml(s.text)}</p>`)
    .join('')}`;

  const highlight = (text: string) => {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="rounded bg-accent-soft px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length)}
      </>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the transcript" className="w-full bg-transparent text-sm outline-none" />
        </label>
        <button type="button" onClick={() => downloadWordDoc(base, meeting.title, doc)} className="btn-ghost py-2 text-xs"><Download className="h-3.5 w-3.5" /> Word</button>
        <button type="button" onClick={() => downloadText(`${base}.txt`, plain)} className="btn-ghost py-2 text-xs"><Download className="h-3.5 w-3.5" /> TXT</button>
        <button type="button" onClick={() => downloadText(`${base}.srt`, toSrt(segments.map((s) => ({ ...s, text: s.speaker ? `${s.speaker}: ${s.text}` : s.text }))))} className="btn-ghost py-2 text-xs"><Download className="h-3.5 w-3.5" /> SRT</button>
        <button type="button" onClick={() => downloadText(`${base}.vtt`, toVtt(segments))} className="btn-ghost py-2 text-xs"><Download className="h-3.5 w-3.5" /> VTT</button>
      </div>
      {q && <p className="mt-2 text-xs text-muted">{shown.length} matching {shown.length === 1 ? 'passage' : 'passages'}</p>}
      <div className="mt-4 max-h-[36rem] space-y-4 overflow-y-auto pr-1 text-sm leading-relaxed scrollbar-thin">
        {shown.map((s, i) => (
          <div key={i} className="flex gap-3">
            <button type="button" onClick={() => onSeek(s.start)} className="w-14 shrink-0 text-left font-mono text-xs leading-6 text-accent hover:underline" title="Play from here">
              {formatDuration(s.start)}
            </button>
            <p>
              {s.speaker && <span className="mr-1.5 font-bold">{s.speaker}:</span>}
              {highlight(s.text)}
            </p>
          </div>
        ))}
        {shown.length === 0 && <p className="text-muted">Nothing matches “{query}”.</p>}
      </div>
    </div>
  );
}
