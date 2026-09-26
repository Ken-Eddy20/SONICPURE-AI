import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Church as ChurchIcon, Loader2, Mic2, Podcast, Users } from 'lucide-react';
import { ApiError, createChurch, getChurch, joinChurch, type Church, type ChurchMember, type Plan } from '../../services/api';
import RecorderStudio from '../recorder/RecorderStudio';
import type { SubscriptionTier } from '../../constants/subscriptionPlans';
import SermonsTab from './SermonsTab';
import TeamTab from './TeamTab';
import PodcastTab from './PodcastTab';

type Tab = 'recorder' | 'sermons' | 'team' | 'podcast' | 'setup';

interface Props {
  plan: Plan;
  /** The user's church has an active Church plan. */
  churchActive: boolean;
  onChoosePlan: (tier: SubscriptionTier) => void;
  /** Called after joining/creating/leaving so the app re-reads the user's church. */
  onChurchChanged: () => void;
}

export default function ChurchView({ plan, churchActive, onChoosePlan, onChurchChanged }: Props) {
  const [church, setChurch] = useState<Church | null | undefined>(undefined);
  const [members, setMembers] = useState<ChurchMember[]>([]);
  const [tab, setTab] = useState<Tab>('recorder');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await getChurch();
      setChurch(res.church);
      setMembers(res.members || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your church.');
      setChurch(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const changed = async () => {
    await reload();
    onChurchChanged();
  };

  if (church === undefined) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  // The recorder is free and works without a church account; the rest needs one.
  const tabs: [Tab, string, typeof Mic2][] = church
    ? [
        ['recorder', 'Record & edit', AudioLines],
        ['sermons', 'Sermons', Mic2],
        ['team', `Team (${church.memberCount}/${church.maxMembers})`, Users],
        ['podcast', 'Podcast', Podcast],
      ]
    : [
        ['recorder', 'Record & edit', AudioLines],
        ['setup', 'Church account', ChurchIcon],
      ];
  const current = tabs.some(([id]) => id === tab) ? tab : 'recorder';
  const upgrade = (tier?: 'payg' | 'church') => (tier === 'church' && !church ? setTab('setup') : onChoosePlan(tier || 'payg'));

  return (
    <div className="space-y-6">
      {church && <ChurchHeader church={church} onActivate={() => onChoosePlan('church')} />}

      <div className="flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 scrollbar-thin sm:w-fit" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={current === id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              current === id ? 'bg-ink text-bg' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {current === 'recorder' && <RecorderStudio plan={plan} churchActive={churchActive} onUpgrade={upgrade} />}
      {current === 'setup' && <ChurchSetup onDone={changed} error={error} />}
      {church && current === 'sermons' && <SermonsTab church={church} onActivate={() => onChoosePlan('church')} onChanged={reload} />}
      {church && current === 'team' && <TeamTab church={church} members={members} onChanged={changed} />}
      {church && current === 'podcast' && <PodcastTab church={church} onChanged={reload} />}
    </div>
  );
}

function ChurchHeader({ church, onActivate }: { church: Church; onActivate: () => void }) {
  return (
    <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div className="flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent-soft text-accent">
          {church.podcast.artworkUrl ? (
            <img src={church.podcast.artworkUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ChurchIcon className="h-6 w-6" />
          )}
        </span>
        <div>
          <p className="eyebrow text-accent">Church account</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{church.name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {church.role === 'owner' ? 'You manage this account' : 'You are on the media team'}
          </p>
        </div>
      </div>

      {church.active ? (
        <div className="flex gap-6 sm:text-right">
          <div>
            <p className="eyebrow">Shared credits</p>
            <p className="mt-1 text-2xl font-extrabold">{church.credits.toLocaleString()}</p>
          </div>
          <div>
            <p className="eyebrow">Renews</p>
            <p className="mt-1 text-sm font-semibold">
              {church.billingRenewDate ? new Date(church.billingRenewDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '–'}
            </p>
            {church.role === 'owner' && (
              <button type="button" onClick={onActivate} className="mt-1 text-xs font-bold text-accent">Add 1,500 credits</button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-warn-soft p-4 text-sm sm:max-w-xs">
          <p className="font-bold text-warn">Church plan not active</p>
          <p className="mt-1 text-ink">
            {church.role === 'owner'
              ? 'Activate it to process sermons with your team’s shared credits.'
              : 'Ask your church admin to activate the Church plan.'}
          </p>
          {church.role === 'owner' && (
            <button type="button" onClick={onActivate} className="btn-primary mt-3 w-full py-2.5">
              Activate Church plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChurchSetup({ onDone, error }: { onDone: () => void; error: string | null }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [message, setMessage] = useState<string | null>(error);

  const run = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'create') await createChurch(name);
      else await joinChurch(code);
      onDone();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const input = 'mt-1.5 w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm outline-none focus:border-accent';

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="eyebrow text-accent">Church package</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Sunday’s sermon, <span className="display italic">ready by Monday.</span>
            </h1>
            <p className="mt-4 max-w-lg leading-relaxed text-muted">
              Upload the service recording. SonicPure cleans the sound, keeps the worship songs, writes the title, summary,
              chapters and social posts, and publishes it to your church podcast on Spotify and Apple Podcasts.
            </p>
            <ol className="mt-6 space-y-3 text-sm">
              {[
                'Create your church account (free).',
                'Activate the Church plan: 1,500 shared credits a month for up to 5 people.',
                'Invite your media team with a code.',
                'Upload a sermon. Publish it to your podcast with one click.',
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-bg">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-line p-5">
              <h2 className="font-bold">Create a church account</h2>
              <p className="mt-1 text-xs text-muted">You will manage billing and the team.</p>
              <label className="mt-4 block text-xs font-semibold text-muted">
                Church name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grace Chapel, Kumasi" className={input} maxLength={80} />
              </label>
              <button type="button" onClick={() => run('create')} disabled={busy !== null || name.trim().length < 2} className="btn-primary mt-4 w-full py-3">
                {busy === 'create' && <Loader2 className="h-4 w-4 animate-spin" />} Create church account
              </button>
            </div>
            <div className="rounded-3xl border border-line p-5">
              <h2 className="font-bold">Joining your church’s team?</h2>
              <p className="mt-1 text-xs text-muted">Ask your church admin for the 6-letter invite code.</p>
              <div className="mt-4 flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="INVITE CODE"
                  className={`${input} mt-0 font-mono tracking-widest`}
                  maxLength={12}
                  aria-label="Invite code"
                />
                <button type="button" onClick={() => run('join')} disabled={busy !== null || code.trim().length < 4} className="btn-ink shrink-0 px-5">
                  {busy === 'join' && <Loader2 className="h-4 w-4 animate-spin" />} Join
                </button>
              </div>
            </div>
            {message && <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
