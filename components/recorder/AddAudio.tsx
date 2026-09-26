import { useRef, useState } from 'react';
import { FolderOpen, Library, ListEnd, ListStart, Loader2, SquarePlus, X } from 'lucide-react';
import { insertAudio, totalLength, type EditState } from '../../services/audioEdit';
import type { SavedRecording } from '../../services/api';
import { formatDuration } from '../../services/media';
import { fmtTime } from './AudioEditor';

type Where = 'start' | 'playhead' | 'end';

interface Props {
  state: EditState;
  playhead: number;
  library: SavedRecording[] | null;
  onAddSource: (blob: Blob) => Promise<{ src: number; seconds: number }>;
  /** Called before inserting (stops playback). */
  onBefore: () => void;
  onInserted: (next: EditState, at: number, seconds: number) => void;
}

const WHERE: { id: Where; label: string; hint: string; icon: typeof ListStart }[] = [
  { id: 'start', label: 'Add intro', hint: 'Plays before everything', icon: ListStart },
  { id: 'playhead', label: 'Insert in between', hint: 'At the red playhead', icon: SquarePlus },
  { id: 'end', label: 'Add outro', hint: 'Plays after everything', icon: ListEnd },
];

/** Put another audio file in front, in between, or at the end of the recording. */
export default function AddAudio({ state, playhead, library, onAddSource, onBefore, onInserted }: Props) {
  const [pending, setPending] = useState<{ where: Where; at: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const choose = (where: Where) => {
    setError(null);
    // Pin the position when the button is pressed, so moving the playhead later does not change it.
    setPending({ where, at: where === 'start' ? 0 : where === 'end' ? totalLength(state) : playhead });
  };

  const insert = async (key: string, getBlob: () => Promise<Blob>) => {
    if (!pending) return;
    setBusy(key);
    setError(null);
    onBefore();
    try {
      const blob = await getBlob();
      const { src, seconds } = await onAddSource(blob);
      // Recompute the end position in case the length changed while the file was loading.
      const at = pending.where === 'end' ? totalLength(state) : Math.min(pending.at, totalLength(state));
      onInserted(insertAudio(state, at, src, seconds), at, seconds);
      setPending(null);
    } catch (err) {
      setError((err as Error)?.message || 'That file could not be added.');
    } finally {
      setBusy(null);
    }
  };

  const fromLibrary = (rec: SavedRecording) =>
    insert(rec.id, async () => {
      const res = await fetch(rec.audioUrl);
      if (!res.ok) throw new Error('Could not download that recording. Check your connection.');
      return res.blob();
    });

  const current = WHERE.find((w) => w.id === pending?.where);
  const saved = (library || []).filter((r) => r.durationSeconds <= 30 * 60).slice(0, 8);

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Add audio</p>
          <p className="text-xs text-muted">Put a jingle, intro music, an announcement or another recording in front, in between, or at the end.</p>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted"><span className="inline-block h-1 w-4 rounded-full bg-warn" /> added audio on the waveform</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {WHERE.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            disabled={busy !== null}
            aria-pressed={pending?.where === id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
              pending?.where === id ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent'
            }`}
          >
            <Icon className="h-5 w-5 shrink-0 text-accent" />
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block text-[11px] text-muted">{id === 'playhead' ? `At ${fmtTime(playhead)} (the red line)` : hint}</span>
            </span>
          </button>
        ))}
      </div>

      {pending && current && (
        <div className="mt-3 rounded-2xl border border-line bg-sunken p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {current.label}
              {pending.where === 'playhead' && <span className="font-normal text-muted"> at {fmtTime(pending.at)}</span>}: choose the audio
            </p>
            <button type="button" onClick={() => setPending(null)} aria-label="Cancel" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) insert('file', async () => f);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="btn-primary mt-3 w-full py-2.5 sm:w-auto sm:px-5">
            {busy === 'file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Choose a file from this device
          </button>

          {saved.length > 0 && (
            <>
              <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-muted"><Library className="h-3.5 w-3.5" /> Or use one of your saved recordings</p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {saved.map((rec) => (
                  <li key={rec.id}>
                    <button
                      type="button"
                      onClick={() => fromLibrary(rec)}
                      disabled={busy !== null}
                      className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-50"
                    >
                      {busy === rec.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{rec.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">{formatDuration(rec.durationSeconds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-[11px] text-muted">Up to 30 minutes. After adding, it is selected so you can fade it or match its volume. Undo removes it.</p>
        </div>
      )}

      {error && <p className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
