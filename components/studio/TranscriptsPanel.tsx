import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Captions, Check, Copy, Download, Languages, Loader2 } from 'lucide-react';
import {
  CAPTION_MAX_MINUTES,
  CAPTION_STYLES,
  TRANSCRIBE_LANGUAGES,
  estimateCaptionCredits,
  estimateTranscriptCredits,
  languageName,
  translationPair,
} from '../../shared/processing.js';
import {
  ApiError,
  getCaptionJob,
  getTranscript,
  getTranscriptConfig,
  listCaptions,
  listTranscripts,
  startCaptions,
  startTranscript,
  type AudioJob,
  type CaptionJob,
  type Segment,
  type Transcript,
} from '../../services/api';
import { attachmentUrl, baseName, downloadText, formatDuration, toSrt, toVtt } from '../../services/media';

const POLL_MS = 4000;
const running = (s: string) => s === 'queued' || s === 'processing';

interface Props {
  job: AudioJob;
  onUpgrade?: () => void;
}

/** Local-language transcripts, translation and (for videos) burned-in captions for one file. */
export default function TranscriptsPanel({ job, onUpgrade }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [captions, setCaptions] = useState<CaptionJob[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<Transcript | null>(null);

  const load = useCallback(async () => {
    const [t, c] = await Promise.all([
      listTranscripts(job.fileId).catch(() => ({ transcripts: [] as Transcript[] })),
      job.sourceType === 'video' ? listCaptions(job.fileId).catch(() => ({ captions: [] as CaptionJob[] })) : { captions: [] as CaptionJob[] },
    ]);
    setTranscripts(t.transcripts);
    setCaptions(c.captions);
    return t.transcripts;
  }, [job.fileId, job.sourceType]);

  useEffect(() => {
    getTranscriptConfig().then((c) => setEnabled(c.enabled)).catch(() => setEnabled(false));
    load().then((list) => {
      const firstDone = list.find((t) => t.status === 'done');
      if (firstDone) setOpenId(firstDone.id);
    });
  }, [load]);

  // Poll while anything is running.
  const busy = transcripts.some((t) => running(t.status)) || captions.some((c) => running(c.status));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      const before = transcripts.filter((t) => running(t.status)).map((t) => t.id);
      const list = await load();
      const finished = list.find((t) => before.includes(t.id) && t.status === 'done');
      if (finished) setOpenId(finished.id);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, load, transcripts]);

  useEffect(() => {
    if (!openId) return setOpen(null);
    getTranscript(openId).then(setOpen).catch(() => setOpen(null));
  }, [openId, transcripts.find((t) => t.id === openId)?.status]);

  return (
    <div className="rounded-3xl border border-line">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <Languages className="h-5 w-5 text-accent" />
        <div>
          <h3 className="font-bold">Transcripts in local languages</h3>
          <p className="text-xs text-muted">Twi, Fante, Ga, Ewe, Dagbani, Hausa and more. Translate to or from English.</p>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {enabled === false ? (
          <p className="flex gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Local-language transcripts are not switched on yet on this server.
          </p>
        ) : (
          <NewTranscript job={job} disabled={enabled === null} onStarted={(id) => load().then(() => setOpenId(id))} onUpgrade={onUpgrade} />
        )}

        {transcripts.length > 0 && (
          <ul className="space-y-2">
            {transcripts.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => t.status === 'done' && setOpenId(t.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                    openId === t.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {languageName(t.language)}
                      {t.translateTo && <span className="font-normal text-muted"> → {languageName(t.translateTo)}</span>}
                    </span>
                    <span className="text-xs text-muted">
                      {running(t.status) ? `${t.stage || 'Working'} · ${t.percent ?? 0}%` : t.status === 'failed' ? 'Failed · refunded' : 'Ready'}
                    </span>
                  </div>
                  {running(t.status) && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, t.percent ?? 0)}%` }} />
                    </div>
                  )}
                  {t.status === 'failed' && t.error && <p className="mt-1 text-xs text-danger">{t.error}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {open?.status === 'done' && <TranscriptViewer transcript={open} fileName={job.originalFileName} />}

        {job.sourceType === 'video' && (
          <CaptionsSection
            job={job}
            transcripts={transcripts.filter((t) => t.status === 'done')}
            captions={captions}
            onStarted={load}
            onUpgrade={onUpgrade}
          />
        )}
      </div>
    </div>
  );
}

function NewTranscript({
  job,
  disabled,
  onStarted,
  onUpgrade,
}: {
  job: AudioJob;
  disabled: boolean;
  onStarted: (id: string) => void;
  onUpgrade?: () => void;
}) {
  const [language, setLanguage] = useState('twi');
  const [translateTo, setTranslateTo] = useState<string>('eng');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const targets = useMemo(
    () => TRANSCRIBE_LANGUAGES.filter((l) => translationPair(language, l.code)),
    [language],
  );
  useEffect(() => {
    if (translateTo && !translationPair(language, translateTo)) setTranslateTo(targets[0]?.code || '');
  }, [language, targets, translateTo]);

  const cost = estimateTranscriptCredits(job.durationSeconds, Boolean(translateTo));

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await startTranscript(job.fileId, language, translateTo || null);
      onStarted(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, { error: 'Could not start the transcript.' }));
    } finally {
      setBusy(false);
    }
  };

  const select = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold outline-none focus:border-accent';

  return (
    <div className="rounded-2xl bg-sunken p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-muted">
          Language spoken in the recording
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={select}>
            {TRANSCRIBE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-muted">
          Also translate to
          <select value={translateTo} onChange={(e) => setTranslateTo(e.target.value)} className={select}>
            <option value="">No translation</option>
            {targets.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          <span className="font-bold">{cost} credits</span>
          <span className="text-muted"> · {formatDuration(job.durationSeconds)} of audio</span>
        </p>
        <button type="button" onClick={start} disabled={busy || disabled} className="btn-primary px-5 py-2.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          Make transcript
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-danger">
          {error.message}{' '}
          {error.wantsUpgrade && onUpgrade && (
            <button type="button" onClick={onUpgrade} className="font-bold underline">Top up</button>
          )}
        </p>
      )}
    </div>
  );
}

function TranscriptViewer({ transcript, fileName }: { transcript: Transcript; fileName: string }) {
  const [side, setSide] = useState<'original' | 'translation'>('original');
  const [copied, setCopied] = useState(false);
  const segments: Segment[] =
    side === 'translation' && transcript.translation ? transcript.translation.segments : transcript.segments || [];
  const lang = side === 'translation' && transcript.translation ? transcript.translation.language : transcript.language;
  const text = segments.map((s) => s.text).join('\n');
  const name = `${baseName(fileName)}-${lang}`;

  return (
    <div className="rounded-2xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-2">
        <div className="flex gap-1">
          <Tab active={side === 'original'} onClick={() => setSide('original')}>{languageName(transcript.language)}</Tab>
          {transcript.translation && (
            <Tab active={side === 'translation'} onClick={() => setSide('translation')}>
              {languageName(transcript.translation.language)}
            </Tab>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn-ghost py-1.5 text-xs"
            onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => downloadText(`${name}.txt`, text)}>
            <Download className="h-3.5 w-3.5" /> TXT
          </button>
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => downloadText(`${name}.srt`, toSrt(segments))}>
            <Download className="h-3.5 w-3.5" /> SRT
          </button>
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => downloadText(`${name}.vtt`, toVtt(segments))}>
            <Download className="h-3.5 w-3.5" /> VTT
          </button>
        </div>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto p-4 text-sm leading-relaxed scrollbar-thin">
        {segments.map((s, i) => (
          <p key={i} className="flex gap-3">
            <span className="w-12 shrink-0 font-mono text-xs leading-6 text-faint">{formatDuration(s.start)}</span>
            <span>{s.text}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${active ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

// ─── Captions ────────────────────────────────────────────────────

const PREVIEW: Record<string, string> = {
  classic: 'text-white [text-shadow:0_0_3px_#000,0_0_3px_#000,0_0_3px_#000]',
  boxed: 'bg-black/70 px-2 text-white',
  social: 'text-[#FFE500] text-[15px] [text-shadow:0_0_3px_#000,0_0_3px_#000,0_2px_4px_#000]',
};

function CaptionsSection({
  job,
  transcripts,
  captions,
  onStarted,
  onUpgrade,
}: {
  job: AudioJob;
  transcripts: Transcript[];
  captions: CaptionJob[];
  onStarted: () => void;
  onUpgrade?: () => void;
}) {
  const [transcriptId, setTranscriptId] = useState('');
  const [useTranslation, setUseTranslation] = useState(false);
  const [style, setStyle] = useState<CaptionJob['style']>('social');
  const [position, setPosition] = useState<CaptionJob['position']>('bottom');
  const [size, setSize] = useState<CaptionJob['size']>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const chosen = transcripts.find((t) => t.id === transcriptId) || transcripts[0];
  useEffect(() => {
    if (chosen && chosen.id !== transcriptId) setTranscriptId(chosen.id);
  }, [chosen, transcriptId]);
  const tooLong = job.durationSeconds / 60 > CAPTION_MAX_MINUTES;
  const cost = estimateCaptionCredits(job.durationSeconds);

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await startCaptions({ transcriptId: chosen.id, useTranslation: useTranslation && Boolean(chosen.translateTo), style, position, size });
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, { error: 'Could not start captions.' }));
    } finally {
      setBusy(false);
    }
  };

  const seg = 'rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition-colors';

  return (
    <div className="border-t border-line pt-5">
      <div className="flex items-center gap-2">
        <Captions className="h-5 w-5 text-accent" />
        <h3 className="font-bold">Captions on your video</h3>
      </div>
      <p className="mt-1 text-xs text-muted">Burn subtitles into the video so they show on WhatsApp, TikTok, Reels and YouTube Shorts.</p>

      {transcripts.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-sunken px-4 py-3 text-sm text-muted">Make a transcript above first. Captions use its text and timing.</p>
      ) : tooLong ? (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">Captions work on videos up to {CAPTION_MAX_MINUTES} minutes. Cut a shorter clip for social media.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <select
              value={chosen?.id}
              onChange={(e) => setTranscriptId(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold outline-none focus:border-accent"
              aria-label="Transcript to use"
            >
              {transcripts.map((t) => (
                <option key={t.id} value={t.id}>
                  {languageName(t.language)}{t.translateTo ? ` → ${languageName(t.translateTo)}` : ''}
                </option>
              ))}
            </select>
            {chosen?.translateTo && (
              <div className="inline-flex rounded-xl border border-line bg-surface p-1 text-xs font-semibold">
                <button type="button" onClick={() => setUseTranslation(false)} className={`rounded-lg px-3 py-1.5 ${!useTranslation ? 'bg-ink text-bg' : 'text-muted'}`}>
                  {languageName(chosen.language)} text
                </button>
                <button type="button" onClick={() => setUseTranslation(true)} className={`rounded-lg px-3 py-1.5 ${useTranslation ? 'bg-ink text-bg' : 'text-muted'}`}>
                  {languageName(chosen.translateTo)} text
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(CAPTION_STYLES) as CaptionJob['style'][]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStyle(key)}
                aria-pressed={style === key}
                className={`overflow-hidden rounded-2xl border text-left transition-colors ${style === key ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong'}`}
              >
                <div className="grid h-20 place-items-end bg-gradient-to-br from-slate-600 to-slate-800 p-2">
                  <span className={`mx-auto text-center text-xs font-bold ${PREVIEW[key]}`}>Onyame yɛ</span>
                </div>
                <div className="px-3 py-2">
                  <p className="text-sm font-bold">{CAPTION_STYLES[key].name}</p>
                  <p className="text-[11px] text-muted">{CAPTION_STYLES[key].hint}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">Position</p>
              <div className="flex gap-1.5">
                {(['bottom', 'middle', 'top'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPosition(p)} className={`${seg} ${position === p ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted">Size</p>
              <div className="flex gap-1.5">
                {(['small', 'medium', 'large'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSize(s)} className={`${seg} ${size === s ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl bg-sunken p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm"><span className="font-bold">{cost} credits</span><span className="text-muted"> · usually ready in a few minutes</span></p>
            <button type="button" onClick={start} disabled={busy} className="btn-primary px-5 py-2.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Captions className="h-4 w-4" />}
              Add captions
            </button>
          </div>
          {error && (
            <p className="text-sm text-danger">
              {error.message}{' '}
              {error.wantsUpgrade && onUpgrade && <button type="button" onClick={onUpgrade} className="font-bold underline">Top up</button>}
            </p>
          )}
        </div>
      )}

      {captions.length > 0 && (
        <ul className="mt-5 space-y-3">
          {captions.map((c) => (
            <CaptionResult key={c.id} job={c} fileName={job.originalFileName} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CaptionResult({ job: initial, fileName }: { job: CaptionJob; fileName: string }) {
  const [job, setJob] = useState(initial);
  useEffect(() => setJob(initial), [initial]);
  useEffect(() => {
    if (!running(job.status)) return;
    const timer = setInterval(() => getCaptionJob(job.id).then(setJob).catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [job.id, job.status]);

  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{CAPTION_STYLES[job.style]?.name} captions · {job.position}</span>
        <span className="text-xs text-muted">
          {running(job.status) ? `${job.stage || 'Working'} · ${job.percent ?? 0}%` : job.status === 'failed' ? 'Failed · refunded' : 'Ready'}
        </span>
      </div>
      {running(job.status) && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(3, job.percent ?? 0)}%` }} />
        </div>
      )}
      {job.status === 'failed' && job.error && <p className="mt-2 text-xs text-danger">{job.error}</p>}
      {job.status === 'done' && job.outputUrl && (
        <div className="mt-3 space-y-3">
          <video src={job.outputUrl} controls playsInline className="max-h-[28rem] w-full rounded-2xl bg-black" />
          <a href={attachmentUrl(job.outputUrl, `${baseName(fileName)}-captions`)} className="btn-primary py-2.5">
            <Download className="h-4 w-4" /> Download captioned video
          </a>
        </div>
      )}
    </li>
  );
}
