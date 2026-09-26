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
    <div className="rounded-2xl border border-white/5 bg-gradient-to-b from-[#161a21] to-[#12151b] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            <span className={`h-1.5 w-1.5 rounded-full ${pending ? 'bg-orange-400 shadow-[0_0_6px_#fb923c]' : 'bg-zinc-700'}`} />
            Add audio
          </p>
          <p className="mt-1 text-xs text-zinc-500">A jingle, intro music, an announcement or another recording: in front, in between, or at the end.</p>
        </div>
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500"><span className="inline-block h-1 w-4 rounded-full bg-orange-400" /> added audio</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {WHERE.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            disabled={busy !== null}
            aria-pressed={pending?.where === id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors disabled:opacity-40 ${
              pending?.where === id ? 'border-orange-400/60 bg-orange-400/10' : 'border-white/[0.06] bg-[#1a1e26] hover:border-orange-400/40'
            }`}
          >
            <Icon className="h-5 w-5 shrink-0 text-orange-300" />
            <span>
              <span className="block text-sm font-semibold text-zinc-100">{label}</span>
              <span className="block text-[11px] text-zinc-500">{id === 'playhead' ? `At ${fmtTime(playhead)} (the red line)` : hint}</span>
            </span>
          </button>
        ))}
      </div>

      {pending && current && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-100">
              {current.label}
              {pending.where === 'playhead' && <span className="font-mono font-normal text-amber-300"> at {fmtTime(pending.at)}</span>}: choose the audio
            </p>
            <button type="button" onClick={() => setPending(null)} aria-label="Cancel" className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-white">
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
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-400 py-2.5 text-sm font-bold text-black transition-colors hover:bg-orange-300 disabled:opacity-40 sm:w-auto sm:px-5">
            {busy === 'file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Choose a file from this device
          </button>

          {saved.length > 0 && (
            <>
              <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-zinc-400"><Library className="h-3.5 w-3.5" /> Or use one of your saved recordings</p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {saved.map((rec) => (
                  <li key={rec.id}>
                    <button
                      type="button"
                      onClick={() => fromLibrary(rec)}
                      disabled={busy !== null}
                      className="flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-[#1a1e26] px-3 py-2 text-left text-sm text-zinc-200 hover:border-orange-400/40 disabled:opacity-40"
                    >
                      {busy === rec.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-300" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{rec.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-500">{formatDuration(rec.durationSeconds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-[11px] text-zinc-500">Up to 30 minutes. After adding, it is selected so you can fade it or match its volume. Undo removes it.</p>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
