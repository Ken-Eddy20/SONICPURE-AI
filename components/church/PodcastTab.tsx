import { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, ImagePlus, Loader2 } from 'lucide-react';
import { ApiError, updateChurch, uploadChurchArtwork, type Church, type PodcastSettings } from '../../services/api';

interface Props {
  church: Church;
  onChanged: () => void;
}

const LANGUAGES = [
  ['en', 'English'],
  ['tw', 'Twi'],
  ['ak', 'Akan (Fante)'],
  ['ee', 'Ewe'],
  ['gaa', 'Ga'],
  ['ha', 'Hausa'],
  ['fr', 'French'],
];

export default function PodcastTab({ church, onChanged }: Props) {
  const owner = church.role === 'owner';
  const [form, setForm] = useState<PodcastSettings>({
    title: church.podcast.title || church.name,
    author: church.podcast.author || church.name,
    description: church.podcast.description || '',
    language: church.podcast.language || 'en',
    subcategory: church.podcast.subcategory || 'Christianity',
    email: church.podcast.email || '',
  });
  const [busy, setBusy] = useState<'save' | 'art' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy('save');
    setMessage(null);
    try {
      await updateChurch({ podcast: form });
      setMessage({ ok: true, text: 'Podcast settings saved.' });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(null);
    }
  };

  const uploadArt = async (file: File | undefined) => {
    if (!file) return;
    setBusy('art');
    setMessage(null);
    try {
      await uploadChurchArtwork(file);
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Could not upload the image.' });
    } finally {
      setBusy(null);
    }
  };

  const input = 'mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent disabled:opacity-60';
  const set = (key: keyof PodcastSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="card p-6">
        <h2 className="text-lg font-bold">Podcast details</h2>
        <p className="mt-1 text-sm text-muted">This is what listeners see on Spotify, Apple Podcasts and other apps.</p>

        <div className="mt-5 flex items-center gap-4">
          <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-sunken">
            {church.podcast.artworkUrl ? (
              <img src={church.podcast.artworkUrl} alt="Podcast cover" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-7 w-7 text-faint" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">Cover image</p>
            <p className="text-xs text-muted">Square, at least 1400 × 1400 px. JPG or PNG.</p>
            {owner && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadArt(e.target.files?.[0])} />
                <button type="button" disabled={busy !== null} onClick={() => fileRef.current?.click()} className="btn-ghost mt-2 py-2 text-xs">
                  {busy === 'art' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {church.podcast.artworkUrl ? 'Change image' : 'Upload image'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-muted sm:col-span-2">
            Podcast name
            <input value={form.title} onChange={set('title')} disabled={!owner} className={input} maxLength={120} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Author / ministry
            <input value={form.author} onChange={set('author')} disabled={!owner} className={input} maxLength={120} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Contact email (for Apple and Spotify)
            <input type="email" value={form.email} onChange={set('email')} disabled={!owner} className={input} maxLength={120} />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Main language
            <select value={form.language} onChange={set('language')} disabled={!owner} className={input}>
              {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            Category
            <select value={form.subcategory} onChange={set('subcategory')} disabled={!owner} className={input}>
              {['Christianity', 'Islam', 'Spirituality', 'Religion'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted sm:col-span-2">
            About the podcast
            <textarea rows={4} value={form.description} onChange={set('description')} disabled={!owner} className={input} maxLength={3500} placeholder="Weekly sermons and teachings from our church family." />
          </label>
        </div>

        {owner ? (
          <button type="button" onClick={save} disabled={busy !== null} className="btn-primary mt-5 px-6 py-3">
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Save podcast details
          </button>
        ) : (
          <p className="mt-5 text-xs text-muted">Only the church admin can change these details.</p>
        )}
        {message && (
          <p className={`mt-3 rounded-2xl px-4 py-3 text-sm ${message.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}>{message.text}</p>
        )}
      </div>

      <div className="card h-fit p-6">
        <h2 className="text-lg font-bold">Get on Spotify and Apple Podcasts</h2>
        <p className="mt-1 text-sm text-muted">Do this once. New sermons you publish show up automatically after that.</p>

        <p className="eyebrow mt-5">Your podcast feed link</p>
        <div className="mt-2 flex gap-2">
          <input readOnly value={church.feedUrl} className="min-w-0 flex-1 rounded-xl border border-line bg-sunken px-3 py-2 font-mono text-xs" aria-label="Podcast feed link" />
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(church.feedUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
            className="btn-ghost shrink-0 px-3 py-2"
            aria-label="Copy feed link"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <ol className="mt-5 space-y-4 text-sm">
          {[
            ['Add a cover image, email and description here, then publish at least one sermon.', null],
            ['Spotify: open Spotify for Creators, choose “Find an existing show” and paste your feed link.', 'https://creators.spotify.com/'],
            ['Apple Podcasts: sign in to Podcasts Connect, add a show with “RSS feed” and paste the same link.', 'https://podcastsconnect.apple.com/'],
            ['Approval usually takes 1 to 5 days. After that, every sermon you publish appears automatically.', null],
          ].map(([text, link], i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-bg">{i + 1}</span>
              <span>
                {text}{' '}
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>
        <a href={church.feedUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost mt-5 w-full py-2.5 text-xs">
          Preview feed <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
