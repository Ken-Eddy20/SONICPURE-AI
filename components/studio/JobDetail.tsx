import { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, Download, FileAudio, Loader2, Trash2, Check, ArrowLeft,
} from 'lucide-react';
import { PROFILES } from '../../shared/processing.js';
import { getJob, type AudioJob } from '../../services/api';
import { attachmentUrl, baseName, downloadText, formatDuration, toSrt } from '../../services/media';
import ComparePlayer from './ComparePlayer';

export interface ClientJob extends AudioJob {
  uploadPercent?: number;
  upgrade?: boolean;
}

interface JobDetailProps {
  job: ClientJob;
  onBack: () => void;
  onDelete: (job: ClientJob) => void;
  onUpgrade: () => void;
}

export default function JobDetail({ job, onBack, onDelete, onUpgrade }: JobDetailProps) {
  const profile = job.feature ? PROFILES[job.feature] : null;

  return (
    <div className="card p-5 sm:p-7">
      <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> New cleanup
      </button>

      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sunken text-muted">
          <FileAudio className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-extrabold tracking-tight">{job.originalFileName}</h2>
          <p className="mt-0.5 text-sm text-muted">
            {profile?.name || 'Upload'}
            {job.durationSeconds ? ` · ${formatDuration(job.durationSeconds)}` : ''}
            {job.creditsUsed ? ` · ${job.creditsUsed} credits` : ''}
          </p>
        </div>
        {(job.status === 'processed' || job.status === 'failed') && (
          <button
            type="button"
            onClick={() => onDelete(job)}
            className="grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-danger-soft hover:text-danger"
            aria-label="Delete file"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-6">
        {job.status === 'uploading' && (
          <Progress label="Uploading" detail="Keep this tab open until the upload finishes." percent={job.uploadPercent ?? 0} />
        )}
        {(job.status === 'uploaded' || job.status === 'processing') && (
          <Progress
            label={job.stage || 'Starting'}
            detail="Usually 1 to 3 minutes. You can start another file meanwhile; this one keeps running."
            percent={job.percent ?? 3}
            pulse
          />
        )}
        {job.status === 'failed' && <Failed job={job} onUpgrade={onUpgrade} />}
        {job.status === 'processed' && job.processedFileUrl && <Result job={job} />}
      </div>
    </div>
  );
}

function Progress({ label, detail, percent, pulse }: { label: string; detail: string; percent: number; pulse?: boolean }) {
  return (
    <div className="rounded-3xl border border-line bg-sunken p-6" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" /> {label}
        </span>
        <span className="font-mono text-muted">{Math.round(percent)}%</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full bg-accent transition-[width] duration-700 ${pulse ? 'animate-pulse' : ''}`}
          style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
        />
      </div>
      <p className="mt-4 text-sm text-muted">{detail}</p>
    </div>
  );
}

function Failed({ job, onUpgrade }: { job: ClientJob; onUpgrade: () => void }) {
  return (
    <div className="rounded-3xl border border-danger/30 bg-danger-soft p-6 text-sm">
      <p className="flex items-center gap-2 font-bold text-danger">
        <AlertTriangle className="h-4 w-4" /> This file couldn't be processed
      </p>
      <p className="mt-2 text-ink">{job.error || 'Something went wrong.'}</p>
      <p className="mt-2 text-muted">No credits were taken for this file.</p>
      {job.upgrade && (
        <button type="button" onClick={onUpgrade} className="btn-ink mt-4">
          See plans
        </button>
      )}
    </div>
  );
}

const STAT_LABELS: [keyof NonNullable<AudioJob['statistics']>, string][] = [
  ['fillers', 'filler words'],
  ['stutters', 'stutters'],
  ['mouthSounds', 'mouth sounds'],
  ['breaths', 'breaths'],
  ['deadAir', 'silences trimmed'],
];

function Result({ job: initial }: { job: ClientJob }) {
  const [job, setJob] = useState<AudioJob>(initial);

  // History entries are light; fetch transcript and notes on demand.
  useEffect(() => {
    setJob(initial);
    if (initial.hasNotes && initial.transcript === undefined) {
      getJob(initial.fileId).then(setJob).catch(() => {});
    }
  }, [initial]);

  const stats = STAT_LABELS.filter(([k]) => (job.statistics?.[k] || 0) > 0);
  const ext = job.processedIsVideo ? 'mp4' : job.options?.exportFormat || 'audio';

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-accent">
        <CheckCircle2 className="h-4 w-4" /> Cleaned{job.qualityLevel === 100 ? ' at full studio strength' : ''}
      </p>

      {job.processedIsVideo && (
        <video src={job.processedFileUrl!} controls playsInline className="w-full rounded-3xl border border-line bg-black" />
      )}

      <ComparePlayer originalUrl={job.originalFileUrl} cleanedUrl={job.processedFileUrl!} />

      <div className="flex flex-wrap gap-2">
        <span className="chip border-accent/30 bg-accent-soft text-accent">Background noise removed</span>
        {stats.map(([k, label]) => (
          <span key={k} className="chip">
            <strong className="text-ink">{job.statistics![k]}</strong> {label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <a href={attachmentUrl(job.processedFileUrl!, job.originalFileName)} className="btn-primary px-6 py-3">
          <Download className="h-4 w-4" /> Download cleaned {ext.toUpperCase()}
        </a>
        <a href={job.originalFileUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost px-6 py-3">
          Original
        </a>
      </div>
      {job.hasNotes && <Notes job={job} />}
    </div>
  );
}

type NotesTab = 'summary' | 'chapters' | 'transcript' | 'social';

function Notes({ job }: { job: AudioJob }) {
  const [tab, setTab] = useState<NotesTab>('summary');
  if (job.transcript === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-3xl border border-line p-6 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading show notes…
      </div>
    );
  }

  const name = baseName(job.originalFileName);
  const paragraphs = job.transcript?.paragraphs || [];
  const transcriptText = paragraphs.map((p) => p.text.trim()).join('\n\n');
  const tabs: { id: NotesTab; label: string; show: boolean }[] = [
    { id: 'summary', label: 'Summary', show: Boolean(job.summary) },
    { id: 'chapters', label: 'Chapters', show: Boolean(job.summary?.chapters.length) },
    { id: 'transcript', label: 'Transcript', show: paragraphs.length > 0 },
    { id: 'social', label: 'Social posts', show: Boolean(job.social) },
  ];
  const visible = tabs.filter((t) => t.show);
  const current = visible.find((t) => t.id === tab) ? tab : visible[0]?.id;
  if (!current) return null;

  return (
    <div className="rounded-3xl border border-line">
      <div className="flex gap-1 overflow-x-auto border-b border-line p-2 scrollbar-thin" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${
              current === t.id ? 'bg-ink text-bg' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[28rem] overflow-y-auto p-5 text-sm leading-relaxed scrollbar-thin">
        {current === 'summary' && job.summary && (
          <div className="space-y-5">
            {job.summary.title && <h3 className="text-lg font-bold">{job.summary.title}</h3>}
            <Block label="Summary" text={job.summary.summary} />
            <Block label="Episode description" text={job.summary.episodeDescription} />
            <Block label="Key takeaways" text={job.summary.keyLearnings} />
          </div>
        )}

        {current === 'chapters' && job.summary && (
          <>
            <ul className="space-y-2">
              {job.summary.chapters.map((c) => (
                <li key={`${c.start}-${c.title}`} className="flex gap-3">
                  <span className="w-14 shrink-0 font-mono text-xs leading-6 text-accent">{formatDuration(c.start)}</span>
                  <span>{c.title}</span>
                </li>
              ))}
            </ul>
            <CopyButton
              className="mt-4"
              text={job.summary.chapters.map((c) => `${formatDuration(c.start)} ${c.title}`).join('\n')}
              label="Copy for YouTube description"
            />
          </>
        )}

        {current === 'transcript' && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <CopyButton text={transcriptText} label="Copy" />
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => downloadText(`${name}.txt`, transcriptText)}>
                <Download className="h-3.5 w-3.5" /> TXT
              </button>
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => downloadText(`${name}.srt`, toSrt(paragraphs))}>
                <Download className="h-3.5 w-3.5" /> SRT subtitles
              </button>
            </div>
            <div className="space-y-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 font-mono text-xs leading-6 text-faint">{formatDuration(p.start)}</span>
                  <span>{p.text}</span>
                </p>
              ))}
            </div>
            {job.transcript?.truncated && <p className="mt-4 text-xs text-muted">Transcript shortened for display.</p>}
          </>
        )}

        {current === 'social' && job.social && (
          <div className="space-y-5">
            <Block label="X / Twitter thread" text={job.social.twitterThread} copy />
            <Block label="LinkedIn post" text={job.social.linkedin} copy />
            <Block label="Newsletter" text={job.social.newsletter} copy />
          </div>
        )}
      </div>
    </div>
  );
}

function Block({ label, text, copy }: { label: string; text: string; copy?: boolean }) {
  if (!text) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        {copy && <CopyButton text={text} label="Copy" small />}
      </div>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}

function CopyButton({ text, label, className = '', small }: { text: string; label: string; className?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${small ? 'text-xs font-semibold text-accent' : 'btn-ghost py-1.5 text-xs'} inline-flex items-center gap-1.5 ${className}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}
