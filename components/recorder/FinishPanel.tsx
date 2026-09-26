import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CloudUpload, Download, ImagePlus, Loader2, Lock, Podcast, Send, Sparkles, X } from 'lucide-react';
import {
  ApiError,
  createEpisode,
  recordingToStudio,
  saveRecording,
  startProcessing,
  type JobOptions,
  type Plan,
  type SavedRecording,
  type ShowType,
} from '../../services/api';
import { totalLength, type EditState } from '../../services/audioEdit';
import { encodeMp3, prepareCover, safeFileName, tagMp3, type AudioMetadata } from '../../services/mp3Export';
import { EPISODE_FEATURE, EPISODE_OPTIONS, DEFAULT_OPTIONS, showType as showLabels } from '../../shared/processing.js';
import { formatBytes } from '../../services/media';
import { fmtTime } from './AudioEditor';

interface Props {
  sources: AudioBuffer[];
  state: EditState;
  meta: AudioMetadata;
  coverUrl: string | null;
  /** Updater form, so quick successive edits never overwrite each other. */
  onMetaChange: (update: (meta: AudioMetadata) => AudioMetadata, coverUrl?: string | null) => void;
  plan: Plan;
  showActive: boolean;
  showType: ShowType | null;
  onBack: () => void;
  onSaved: (rec: SavedRecording) => void;
  onUpgrade: (tier?: 'payg' | 'show') => void;
}

const GENRES = ['Gospel', 'Sermon', 'Worship', 'Choir', 'Praise', 'Teaching', 'Podcast', 'Speech', 'Highlife', 'Afrobeats', 'Hiplife', 'Other'];

type Busy = null | 'encode' | 'save' | 'whatsapp' | 'telegram' | 'clean' | 'publish';

export default function FinishPanel({ sources, state, meta, coverUrl, onMetaChange, plan, showActive, showType, onBack, onSaved, onUpgrade }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const cacheRef = useRef<{ key: string; blob: Blob } | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const paid = plan !== 'free';
  /** Publish straight from the recorder: cleaned first (credits) or exactly as edited (no credits). */
  const [cleanFirst, setCleanFirst] = useState(true);

  const set = (key: keyof AudioMetadata) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    onMetaChange((m) => ({ ...m, [key]: value }));
  };

  // Any change to the audio or tags makes the saved copy out of date.
  const key = JSON.stringify({ c: state.clips, m: { ...meta, cover: meta.cover ? meta.cover.data.byteLength : 0 } });
  useEffect(() => setSaved(null), [key]);

  const fileName = `${safeFileName(meta.title || 'Recording')}.mp3`;

  async function buildMp3(): Promise<Blob> {
    if (cacheRef.current?.key === key) return cacheRef.current.blob;
    setBusy((b) => b ?? 'encode');
    setProgress(0);
    const raw = await encodeMp3(sources, state, setProgress);
    const blob = tagMp3(raw, meta);
    cacheRef.current = { key, blob };
    return blob;
  }

  async function ensureSaved(): Promise<SavedRecording> {
    if (saved) return saved;
    const blob = await buildMp3();
    const coverBlob = meta.cover ? new Blob([meta.cover.data], { type: meta.cover.mime }) : null;
    const { cover: _c, ...fields } = meta;
    const rec = await saveRecording(blob, fileName, fields as unknown as Record<string, string>, coverBlob);
    setSaved(rec);
    onSaved(rec);
    return rec;
  }

  const run = async (kind: Busy, fn: () => Promise<string | void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if ((err as Error)?.name === 'AbortError') return;
      setMessage({ ok: false, text: e?.message || (err as Error)?.message || 'Something went wrong. Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run('encode', async () => {
      const blob = await buildMp3();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return `Downloaded ${fileName} (${formatBytes(blob.size)}).`;
    });

  const share = (app: 'whatsapp' | 'telegram') =>
    run(app, async () => {
      const blob = await buildMp3();
      const file = new File([blob], fileName, { type: 'audio/mpeg' });
      const text = meta.title || 'Recording';
      // On phones, share the actual file straight into WhatsApp or Telegram.
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: text, text });
          return;
        } catch (err) {
          // Phones only allow sharing right after a tap; long files take longer than that to prepare.
          if ((err as Error)?.name === 'NotAllowedError') {
            return `Your MP3 is ready. Tap ${app === 'whatsapp' ? 'WhatsApp' : 'Telegram'} again to share it.`;
          }
          throw err;
        }
      }
      // On computers, share a link to the saved copy.
      const rec = await ensureSaved();
      const url = app === 'whatsapp'
        ? `https://wa.me/?text=${encodeURIComponent(`${text}\n${rec.audioUrl}`)}`
        : `https://t.me/share/url?url=${encodeURIComponent(rec.audioUrl)}&text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener');
      return 'Saved to your library and opened sharing.';
    });

  const clean = () =>
    run('clean', async () => {
      if (!paid) {
        onUpgrade('payg');
        return;
      }
      const rec = await ensureSaved();
      const { fileId } = await recordingToStudio(rec.id);
      await startProcessing(fileId, 'voice_clarity', { ...(DEFAULT_OPTIONS as JobOptions), keepMusic: true });
      return 'AI cleaning started. The cleaned file will appear in Studio → Library in a few minutes.';
    });

  const publish = () =>
    run('publish', async () => {
      if (!showActive) {
        onUpgrade('show');
        return;
      }
      const rec = await ensureSaved();
      const { fileId } = await recordingToStudio(rec.id);
      if (cleanFirst) await startProcessing(fileId, EPISODE_FEATURE, EPISODE_OPTIONS as JobOptions);
      const t = showLabels(showType);
      const track = parseInt(meta.track, 10);
      await createEpisode(fileId, {
        title: meta.title || t.item,
        speaker: meta.artist,
        guests: '',
        series: t.series ? meta.album : '',
        reference: '',
        season: null,
        episode: t.numbered && Number.isFinite(track) && track > 0 ? track : null,
        date: new Date().toISOString().slice(0, 10),
        description: meta.comment,
      });
      return cleanFirst
        ? `Sent to your podcast. It is being cleaned now; publish it from Podcast → ${t.items} when it is ready.`
        : `Added to Podcast → ${t.items}. Open it there and press Publish.`;
    });

  const pickCover = async (file?: File) => {
    if (!file) return;
    setCoverBusy(true);
    try {
      const c = await prepareCover(file);
      onMetaChange((m) => ({ ...m, cover: { data: c.data, mime: c.mime } }), c.url);
    } catch {
      setMessage({ ok: false, text: 'Could not read that image. Try a JPG or PNG.' });
    } finally {
      setCoverBusy(false);
    }
  };

  const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent';
  const working = busy !== null || coverBusy;

  return (
    <div className="space-y-5">
      <div className="card p-5 sm:p-7">
        <button type="button" onClick={onBack} disabled={working} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back to editing
        </button>
        <h2 className="text-2xl font-extrabold tracking-tight">Details &amp; export</h2>
        <p className="mt-1 text-sm text-muted">These details are written into the MP3, so they show in music players, WhatsApp and car stereos. Length: {fmtTime(totalLength(state), false)}</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
          <div>
            <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickCover(e.target.files?.[0])} />
            <button type="button" onClick={() => coverInput.current?.click()} className="group relative grid aspect-square w-full place-items-center overflow-hidden rounded-3xl border-2 border-dashed border-line-strong bg-sunken hover:border-accent">
              {coverBusy ? (
                <span className="flex flex-col items-center gap-2 text-sm text-muted"><Loader2 className="h-6 w-6 animate-spin text-accent" /> Adding cover…</span>
              ) : coverUrl ? (
                <img src={coverUrl} alt="Cover art" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted">
                  <ImagePlus className="h-7 w-7 text-accent" />
                  Add cover art
                  <span className="text-[11px]">Square works best</span>
                </span>
              )}
            </button>
            {coverUrl && (
              <button type="button" onClick={() => onMetaChange((m) => ({ ...m, cover: null }), null)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-muted hover:text-danger">
                <X className="h-3.5 w-3.5" /> Remove cover
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-muted sm:col-span-2">
              Title
              <input value={meta.title} onChange={set('title')} className={input} placeholder="e.g. Sunday Service, 21 September" maxLength={150} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Artist / host / preacher
              <input value={meta.artist} onChange={set('artist')} className={input} placeholder="e.g. Rev. Mensah" maxLength={150} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Album / series
              <input value={meta.album} onChange={set('album')} className={input} placeholder="e.g. Walking by Faith" maxLength={150} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Album artist / show / church
              <input value={meta.albumArtist} onChange={set('albumArtist')} className={input} maxLength={150} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Composer / songwriter
              <input value={meta.composer} onChange={set('composer')} className={input} maxLength={150} />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Genre
              <input list="sp-genres" value={meta.genre} onChange={set('genre')} className={input} maxLength={60} />
              <datalist id="sp-genres">{GENRES.map((g) => <option key={g} value={g} />)}</datalist>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-muted">
                Year
                <input value={meta.year} onChange={set('year')} inputMode="numeric" maxLength={4} className={input} />
              </label>
              <label className="block text-xs font-semibold text-muted">
                Track no.
                <input value={meta.track} onChange={set('track')} inputMode="numeric" maxLength={7} placeholder="e.g. 3/12" className={input} />
              </label>
            </div>
            <label className="block text-xs font-semibold text-muted sm:col-span-2">
              Description / comment
              <textarea value={meta.comment} onChange={set('comment')} rows={2} maxLength={1000} className={input} />
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Save &amp; share</h3>
            <span className="chip py-0.5 text-[11px]">Free</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={download} disabled={working} className="btn-primary py-3">
              {busy === 'encode' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download MP3
            </button>
            <button type="button" onClick={() => run('save', async () => { await ensureSaved(); return 'Saved to your library.'; })} disabled={working || Boolean(saved)} className="btn-ghost py-3">
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4 text-accent" /> : <CloudUpload className="h-4 w-4" />} {saved ? 'Saved' : 'Save to library'}
            </button>
            <button type="button" onClick={() => share('whatsapp')} disabled={working} className="btn-ghost py-3">
              {busy === 'whatsapp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <WhatsAppIcon />} WhatsApp
            </button>
            <button type="button" onClick={() => share('telegram')} disabled={working} className="btn-ghost py-3">
              {busy === 'telegram' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 text-[#229ED9]" />} Telegram
            </button>
          </div>
          {busy && progress > 0 && progress < 1 && (
            <div className="mt-4" role="status">
              <div className="flex justify-between text-xs text-muted"><span>Preparing MP3</span><span className="font-mono">{Math.round(progress * 100)}%</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} /></div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">On a phone, sharing sends the audio file itself. On a computer, it shares a link.</p>
        </div>

        <div className="card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Go further</h3>
            <span className="chip py-0.5 text-[11px]">Paid</span>
          </div>
          <div className="mt-4 space-y-2">
            <PaidAction
              icon={<Sparkles className="h-4 w-4" />}
              title="Clean with AI"
              text="Remove background noise, generator hum, fillers and breaths. Uses your credits."
              locked={!paid}
              lockedText="Buy credits to unlock"
              busy={busy === 'clean'}
              disabled={working}
              onClick={clean}
            />
            <PaidAction
              icon={<Podcast className="h-4 w-4" />}
              title="Publish to Spotify & Apple Podcasts"
              text={cleanFirst
                ? showType === 'church' ? 'Cleans it, writes the sermon notes and adds it to your church podcast.' : 'Cleans it, writes the show notes and adds it to your podcast.'
                : 'Adds it to your podcast exactly as you edited it. No credits used.'}
              locked={!showActive}
              lockedText="Podcast or Church plan"
              busy={busy === 'publish'}
              disabled={working}
              onClick={publish}
            />
            {showActive && (
              <label className="flex items-center gap-2 px-1 text-xs text-muted">
                <input type="checkbox" checked={cleanFirst} onChange={(e) => setCleanFirst(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                Clean with AI before publishing (uses credits)
              </label>
            )}
          </div>
        </div>
      </div>

      {message && (
        <p className={`rounded-2xl px-4 py-3 text-sm ${message.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`} role="status">{message.text}</p>
      )}
    </div>
  );
}

function PaidAction({ icon, title, text, locked, lockedText, busy, disabled, onClick }: {
  icon: React.ReactNode; title: string; text: string; locked: boolean; lockedText: string; busy: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-accent disabled:opacity-60">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      {locked && <span className="chip shrink-0 py-0.5 text-[11px]"><Lock className="h-3 w-3" /> {lockedText}</span>}
    </button>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#25D366]" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.82 14.12c-.25.69-1.45 1.32-2 1.36-.51.05-.99.24-3.34-.7-2.82-1.11-4.6-3.99-4.74-4.18-.14-.19-1.13-1.5-1.13-2.87 0-1.36.71-2.03.97-2.31.25-.28.55-.35.73-.35h.53c.17 0 .4-.06.62.48.24.56.8 1.93.87 2.07.07.14.12.3.02.49-.09.19-.14.3-.28.46-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.07.95 1.97 1.25 2.25 1.39.28.14.44.12.61-.07.17-.19.7-.82.89-1.1.19-.28.37-.23.63-.14.25.09 1.62.76 1.9.9.28.14.46.21.53.33.07.12.07.69-.18 1.38z" />
    </svg>
  );
}
