import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FolderOpen, LifeBuoy, Mic, Music, Send, Trash2 } from 'lucide-react';
import { ApiError, deleteRecording, listRecordings, type Plan, type SavedRecording, type ShowType } from '../../services/api';
import {
  MAX_EDIT_SECONDS, MAX_INSERT_SECONDS, computeSourcePeaks, decodeRateFor, initialState, totalLength, type EditState, type SourcePeaks,
} from '../../services/audioEdit';
import { EMPTY_METADATA, type AudioMetadata } from '../../services/mp3Export';
import { deleteSession, listSessions, loadSession, type SessionInfo } from '../../services/recordingStore';
import { attachmentUrl, formatBytes, formatDuration, probeDuration } from '../../services/media';
import LiveRecorder from './LiveRecorder';
import AudioEditor, { EditorLoading } from './AudioEditor';
import FinishPanel from './FinishPanel';

interface Props {
  plan: Plan;
  /** The user's podcast or church team has an active plan. */
  showActive: boolean;
  /** The team's type, or null when the user has no team yet. */
  showType: ShowType | null;
  onUpgrade: (tier?: 'payg' | 'show') => void;
}

type Screen = 'home' | 'record' | 'loading' | 'edit' | 'finish';

interface Project {
  /** [0] is the recording; intros, outros and inserted files follow. Never shrinks, so undo stays valid. */
  sources: AudioBuffer[];
  peaks: SourcePeaks[];
  sessionId: string | null;
  name: string;
}

const HISTORY_LIMIT = 100;

export default function RecorderStudio({ plan, showActive, showType, onUpgrade }: Props) {
  const [screen, setScreen] = useState<Screen>('home');
  const [loadingLabel, setLoadingLabel] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [history, setHistory] = useState<{ past: EditState[]; present: EditState | null; future: EditState[] }>({ past: [], present: null, future: [] });
  const [meta, setMeta] = useState<AudioMetadata>(EMPTY_METADATA);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [library, setLibrary] = useState<SavedRecording[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const refresh = useCallback(async () => {
    listRecordings()
      .then((r) => {
        setLibrary(r.recordings);
        setLimit(r.limit);
      })
      .catch(() => setLibrary([]));
    setSessions(await listSessions());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (screen !== 'edit' && screen !== 'finish') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [screen]);

  const open = async (blob: Blob, name: string, hintSeconds: number | null, sessionId: string | null) => {
    setError(null);
    setScreen('loading');
    setLoadingLabel('Preparing the audio for editing…');
    try {
      const seconds = hintSeconds || (await probeDuration(new File([blob], name, { type: blob.type })));
      if (seconds && seconds > MAX_EDIT_SECONDS) {
        throw new Error('This recording is longer than 3 hours. Split it into shorter parts to edit it here.');
      }
      const rate = decodeRateFor(seconds);
      const ctx = new OfflineAudioContext(1, 1, rate);
      const source = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (source.duration > MAX_EDIT_SECONDS) throw new Error('This recording is longer than 3 hours. Split it into shorter parts to edit it here.');
      setLoadingLabel('Drawing the waveform…');
      await new Promise((r) => setTimeout(r, 30));
      const peaks = computeSourcePeaks(source);
      setProject({ sources: [source], peaks: [peaks], sessionId, name });
      setHistory({ past: [], present: initialState(source), future: [] });
      setMeta({ ...EMPTY_METADATA, title: name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
      setCoverUrl(null);
      setScreen('edit');
    } catch (err) {
      setScreen('home');
      setError(
        (err as Error)?.message?.includes('3 hours')
          ? (err as Error).message
          : 'This audio could not be opened. Try an MP3, M4A or WAV file. Very long files may need a computer rather than a phone.',
      );
    }
  };

  /** Decode another file (intro, outro, insert) at the recording's sample rate and add it as a source. */
  const addSource = async (blob: Blob): Promise<{ src: number; seconds: number }> => {
    if (!project || !history.present) throw new Error('Nothing is open.');
    let buffer: AudioBuffer;
    try {
      const ctx = new OfflineAudioContext(1, 1, project.sources[0].sampleRate);
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error('That file could not be opened. Try an MP3, M4A or WAV file.');
    }
    if (buffer.duration > MAX_INSERT_SECONDS) throw new Error('Intros, outros and inserts can be up to 30 minutes long.');
    if (totalLength(history.present) + buffer.duration > MAX_EDIT_SECONDS) throw new Error('That would make the recording longer than 3 hours.');
    const src = project.sources.length;
    const peaks = computeSourcePeaks(buffer);
    setProject((p) => (p ? { ...p, sources: [...p.sources, buffer], peaks: [...p.peaks, peaks] } : p));
    return { src, seconds: buffer.duration };
  };

  const change = (next: EditState) =>
    setHistory((h) => ({ past: [...h.past, h.present!].slice(-HISTORY_LIMIT), present: next, future: [] }));
  const undo = () => setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present!, ...h.future] } : h));
  const redo = () => setHistory((h) => (h.future.length ? { past: [...h.past, h.present!], present: h.future[0], future: h.future.slice(1) } : h));

  const leaveEditor = () => {
    if (history.past.length && !window.confirm('Leave the editor? Edits you have not saved or downloaded will be lost.')) return;
    setProject(null);
    setScreen('home');
    refresh();
  };

  if (screen === 'record') {
    return (
      <LiveRecorder
        onCancel={() => setScreen('home')}
        onDone={(blob, seconds, sessionId) => {
          const stamp = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
          open(blob, `Recording ${stamp}`, seconds, sessionId);
        }}
      />
    );
  }
  if (screen === 'loading') return <EditorLoading label={loadingLabel} />;
  if (screen === 'edit' && project && history.present) {
    return (
      <AudioEditor
        sources={project.sources}
        peaks={project.peaks}
        state={history.present}
        onChange={change}
        onAddSource={addSource}
        library={library}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={undo}
        onRedo={redo}
        title={meta.title || project.name}
        onBack={leaveEditor}
        onNext={() => setScreen('finish')}
      />
    );
  }
  if (screen === 'finish' && project && history.present) {
    return (
      <FinishPanel
        sources={project.sources}
        state={history.present}
        meta={meta}
        coverUrl={coverUrl}
        onMetaChange={(update, url) => {
          setMeta(update);
          if (url !== undefined) setCoverUrl(url);
        }}
        plan={plan}
        showActive={showActive}
        showType={showType}
        onBack={() => setScreen('edit')}
        onSaved={(rec) => {
          if (project.sessionId) deleteSession(project.sessionId).then(refresh);
          setLibrary((l) => (l ? [rec, ...l.filter((x) => x.id !== rec.id)] : [rec]));
        }}
        onUpgrade={onUpgrade}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="card overflow-hidden">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <span className="chip border-accent/30 bg-accent-soft text-accent">Free for everyone</span>
            <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Record, edit and share, <span className="display italic">right in your browser.</span>
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">
              Record live or open an existing file. Trim the start and end, cut out a section, fix the volume,
              add cover art and song details, then download or send it on WhatsApp and Telegram.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <button type="button" onClick={() => setScreen('record')} className="flex items-center gap-4 rounded-3xl bg-ink p-5 text-left text-bg transition-transform active:scale-[0.99]">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-danger text-white"><Mic className="h-5 w-5" /></span>
              <span>
                <span className="block font-bold">Record live</span>
                <span className="block text-xs opacity-70">From a mic, USB interface or mixer</span>
              </span>
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 text-left hover:border-accent">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><FolderOpen className="h-5 w-5" /></span>
              <span>
                <span className="block font-bold">Open an audio file</span>
                <span className="block text-xs text-muted">MP3, M4A, WAV, or a video's sound</span>
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.ogg,.opus,.flac,.mp4,.mov,.webm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) open(f, f.name, null, null);
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="flex gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
      )}

      {sessions.length > 0 && (
        <div className="card border-warn/40 p-5">
          <p className="flex items-center gap-2 font-bold"><LifeBuoy className="h-4 w-4 text-warn" /> Unfinished recordings on this device</p>
          <p className="mt-1 text-xs text-muted">These were being recorded when the browser closed or before they were saved.</p>
          <ul className="mt-3 divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{new Date(s.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="text-muted"> · about {formatDuration(s.seconds)}</span>
                </span>
                <button
                  type="button"
                  className="btn-primary py-2 text-xs"
                  onClick={async () => {
                    const blob = await loadSession(s.id);
                    if (blob) open(blob, `Recovered recording ${new Date(s.startedAt).toLocaleDateString()}`, s.seconds || null, s.id);
                  }}
                >
                  Recover &amp; edit
                </button>
                <button type="button" className="btn-ghost py-2 text-xs" onClick={() => window.confirm('Delete this unfinished recording from this device?') && deleteSession(s.id).then(refresh)}>
                  Discard
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Your saved recordings</h3>
          {limit !== null && library && (
            <span className="text-xs text-muted">
              {library.length} of {limit} on the free plan ·{' '}
              <button type="button" onClick={() => onUpgrade('payg')} className="font-semibold text-accent">Keep more</button>
            </span>
          )}
        </div>
        {library === null ? (
          <div className="mt-4 space-y-2">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-sunken" />)}</div>
        ) : library.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-sunken px-4 py-6 text-center text-sm text-muted">Recordings you save appear here, ready to play, download or share.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {library.map((r) => (
              <LibraryItem
                key={r.id}
                rec={r}
                onDelete={async () => {
                  if (!window.confirm(`Delete "${r.title}" from your library?`)) return;
                  try {
                    await deleteRecording(r.id);
                    setLibrary((l) => l?.filter((x) => x.id !== r.id) || null);
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Could not delete.');
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LibraryItem({ rec, onDelete }: { rec: SavedRecording; onDelete: () => void }) {
  const text = `${rec.title}\n${rec.audioUrl}`;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-sunken">
          {rec.coverUrl ? <img src={rec.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music className="h-5 w-5 text-faint" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{rec.title}</p>
          <p className="truncate text-xs text-muted">
            {[rec.meta.artist, rec.meta.album, formatDuration(rec.durationSeconds), formatBytes(rec.bytes)].filter(Boolean).join(' · ')}
          </p>
          <audio src={rec.audioUrl} controls preload="none" className="mt-2 h-8 w-full max-w-sm" />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <a href={attachmentUrl(rec.audioUrl, rec.title)} className="grid h-9 w-9 place-items-center rounded-full border border-line hover:border-accent" aria-label="Download" title="Download">
          <Download className="h-4 w-4" />
        </a>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-full border border-line hover:border-accent" aria-label="Share on WhatsApp" title="Share on WhatsApp">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#25D366]" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2z" /></svg>
        </a>
        <a href={`https://t.me/share/url?url=${encodeURIComponent(rec.audioUrl)}&text=${encodeURIComponent(rec.title)}`} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 place-items-center rounded-full border border-line hover:border-accent" aria-label="Share on Telegram" title="Share on Telegram">
          <Send className="h-4 w-4 text-[#229ED9]" />
        </a>
        <button type="button" onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
