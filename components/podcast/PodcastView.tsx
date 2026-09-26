import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, AudioLines, Building2, Church as ChurchIcon, Loader2, Mic2, Plus, Podcast, Radio, Settings, Users } from 'lucide-react';
import {
  ApiError, createShow, getShow, joinShow, switchShow, type Plan, type Show, type ShowAccount, type ShowMember, type ShowType,
} from '../../services/api';
import type { SubscriptionTier } from '../../constants/subscriptionPlans';
import { SHOW_TYPES, showType } from '../../shared/processing.js';
import RecorderStudio from '../recorder/RecorderStudio';
import EpisodesTab from './EpisodesTab';
import TeamTab from './TeamTab';
import SettingsTab from './SettingsTab';

type Tab = 'recorder' | 'episodes' | 'team' | 'settings' | 'setup';

interface Props {
  plan: Plan;
  /** The user's show has an active Podcast or Church plan. */
  showActive: boolean;
  onChoosePlan: (tier: SubscriptionTier) => void;
}

export const TYPE_ICONS: Record<ShowType, typeof Podcast> = { church: ChurchIcon, podcast: Radio, organization: Building2 };

/** Podcasts and churches: one engine, labels follow the show type. */
export default function PodcastView({ plan, showActive, onChoosePlan }: Props) {
  const [show, setShow] = useState<Show | null | undefined>(undefined);
  const [members, setMembers] = useState<ShowMember[]>([]);
  const [accounts, setAccounts] = useState<ShowAccount[]>([]);
  /** The "Your accounts" page: create, join or open another account. */
  const [hub, setHub] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('recorder');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await getShow();
      setShow(res.show);
      setMembers(res.members || []);
      setAccounts(res.accounts || []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your account.');
      setShow(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openAccount = async (id: string) => {
    setSwitching(id);
    try {
      await switchShow(id);
      await reload();
      setHub(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that account.');
    } finally {
      setSwitching(null);
    }
  };

  if (show === undefined) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const t = show ? showType(show.type) : null;
  const planFor = (s: Show) => SHOW_TYPES[s.type]?.plan as SubscriptionTier;

  // The recorder is free and works without an account; the rest needs one.
  const tabs: [Tab, string, typeof Mic2][] = show
    ? [
        ['recorder', 'Record & edit', AudioLines],
        ['episodes', t!.items, Mic2],
        ['team', `Team (${show.memberCount}/${show.maxMembers})`, Users],
        ['settings', 'Podcast settings', Settings],
      ]
    : [
        ['recorder', 'Record & edit', AudioLines],
        ['setup', 'Publish a podcast', Podcast],
      ];
  const current = tabs.some(([id]) => id === tab) ? tab : 'recorder';
  const upgrade = (tier?: 'payg' | 'show') => {
    if (tier === 'show') return show ? onChoosePlan(planFor(show)) : setTab('setup');
    onChoosePlan(tier || 'payg');
  };

  const setup = (
    <ShowSetup
      accounts={accounts}
      currentId={show?.id || null}
      switching={switching}
      onOpen={openAccount}
      onBack={show && hub ? () => setHub(false) : undefined}
      backLabel={show?.name}
      onDone={async () => {
        await reload();
        setHub(false);
        setTab('recorder');
      }}
      error={error}
    />
  );

  if (show && hub) return setup;

  return (
    <div className="space-y-6">
      {show && (
        <AccountBar accounts={accounts} currentId={show.id} switching={switching} onOpen={openAccount} onAdd={() => setHub(true)} />
      )}
      {show && <ShowHeader show={show} onActivate={() => onChoosePlan(planFor(show))} />}

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

      {current === 'recorder' && (
        <RecorderStudio plan={plan} showActive={showActive} showType={show?.type || null} onUpgrade={upgrade} />
      )}
      {current === 'setup' && setup}
      {show && current === 'episodes' && <EpisodesTab show={show} onActivate={() => onChoosePlan(planFor(show))} onChanged={reload} />}
      {show && current === 'team' && <TeamTab show={show} members={members} onChanged={reload} />}
      {show && current === 'settings' && <SettingsTab show={show} onChanged={reload} />}
    </div>
  );
}

/** Quick switch between the user's accounts, plus the way back to the create/join page. */
function AccountBar({ accounts, currentId, switching, onOpen, onAdd }: {
  accounts: ShowAccount[];
  currentId: string;
  switching: string | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-muted">Your accounts:</span>
      {accounts.map((a) => {
        const Icon = TYPE_ICONS[a.type] || Radio;
        const current = a.id === currentId;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => !current && onOpen(a.id)}
            disabled={switching !== null}
            aria-current={current}
            className={`flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              current ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:border-accent hover:text-ink'
            }`}
          >
            {switching === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{a.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" /> New church or podcast account
      </button>
    </div>
  );
}

function ShowHeader({ show, onActivate }: { show: Show; onActivate: () => void }) {
  const Icon = TYPE_ICONS[show.type] || Radio;
  const t = showType(show.type);
  const planName = show.plan === 'church' ? 'Church plan' : show.plan === 'podcast' ? 'Podcast plan' : null;
  return (
    <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div className="flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-accent-soft text-accent">
          {show.podcast.artworkUrl ? <img src={show.podcast.artworkUrl} alt="" className="h-full w-full object-cover" /> : <Icon className="h-6 w-6" />}
        </span>
        <div>
          <p className="eyebrow text-accent">{t.label}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{show.name}</h1>
          <p className="mt-0.5 text-sm text-muted">{show.role === 'owner' ? 'You manage this account' : `You are on the ${t.team.toLowerCase()}`}</p>
        </div>
      </div>

      {show.active ? (
        <div className="flex gap-6 sm:text-right">
          <div>
            <p className="eyebrow">Shared credits</p>
            <p className="mt-1 text-2xl font-extrabold">{show.credits.toLocaleString()}</p>
            <p className="text-xs text-muted">{planName}</p>
          </div>
          <div>
            <p className="eyebrow">Renews</p>
            <p className="mt-1 text-sm font-semibold">
              {show.billingRenewDate ? new Date(show.billingRenewDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '–'}
            </p>
            {show.role === 'owner' && (
              <div className="mt-1 flex flex-col gap-0.5 text-xs font-bold text-accent sm:items-end">
                <button type="button" onClick={onActivate}>Renew / add credits</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-warn-soft p-4 text-sm sm:max-w-xs">
          <p className="font-bold text-warn">No plan active yet</p>
          <p className="mt-1 text-ink">
            {show.role === 'owner'
              ? `Recording and editing are free. Activate a plan to clean ${t.items.toLowerCase()} with AI and publish them to Spotify and Apple Podcasts.`
              : 'Ask the account owner to activate a plan.'}
          </p>
          {show.role === 'owner' && (
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={onActivate} className="btn-primary w-full py-2.5">
                Activate {SHOW_TYPES[show.type]?.plan === 'church' ? 'Church' : 'Podcast'} plan
              </button>
              <p className="text-center text-xs text-muted">$35/month · 1,500 shared credits · up to 5 people</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShowSetup({ accounts, currentId, switching, onOpen, onBack, backLabel, onDone, error }: {
  accounts: ShowAccount[];
  currentId: string | null;
  switching: string | null;
  onOpen: (id: string) => void;
  onBack?: () => void;
  backLabel?: string;
  onDone: () => void;
  error: string | null;
}) {
  const [type, setType] = useState<ShowType>('podcast');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [message, setMessage] = useState<string | null>(error);
  const t = showType(type);

  const run = async (kind: 'create' | 'join') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'create') await createShow(name, type);
      else await joinShow(code);
      onDone();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const input = 'mt-1.5 w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm outline-none focus:border-accent';

  return (
    <div className="space-y-5">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back to {backLabel || 'your account'}
        </button>
      )}

      {accounts.length > 0 && (
        <div className="card p-5 sm:p-6">
          <h2 className="text-lg font-bold">Your accounts</h2>
          <p className="mt-0.5 text-sm text-muted">Open one to work in it. Recordings, credits and the podcast feed are kept separate for each.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {accounts.map((a) => {
              const Icon = TYPE_ICONS[a.type] || Radio;
              const current = a.id === currentId;
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{a.name}</span>
                    <span className="block text-xs text-muted">
                      {SHOW_TYPES[a.type]?.label} · {a.role === 'owner' ? 'Owner' : 'Team member'} · {a.active ? 'Plan active' : 'No plan yet'}
                    </span>
                  </span>
                  {current ? (
                    <span className="chip shrink-0 border-accent/30 bg-accent-soft text-accent">Open now</span>
                  ) : (
                    <button type="button" onClick={() => onOpen(a.id)} disabled={switching !== null} className="btn-ghost shrink-0 px-4 py-2 text-xs">
                      {switching === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Open
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

    <div className="card overflow-hidden">
      <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="eyebrow text-accent">{accounts.length ? 'Add another account' : 'Podcasts & churches'}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Record it today, <span className="display italic">live on Spotify tomorrow.</span>
          </h1>
          <p className="mt-4 max-w-lg leading-relaxed text-muted">
            Record or upload, and SonicPure cleans the sound, writes the title, summary, chapters and social posts, and
            publishes it to your own podcast on Spotify and Apple Podcasts.
          </p>
          <ol className="mt-6 space-y-3 text-sm">
            {[
              'Create your account (free).',
              'Activate the plan: $35/month, 1,500 shared credits, up to 5 people.',
              'Invite your team with a code.',
              'Upload or record, then publish with one click.',
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
            <h2 className="font-bold">What are you publishing?</h2>
            <div className="mt-3 grid gap-2">
              {(Object.keys(SHOW_TYPES) as ShowType[]).map((id) => {
                const Icon = TYPE_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setType(id)}
                    aria-pressed={type === id}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${type === id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-accent" />
                    <span>
                      <span className="block text-sm font-bold">{SHOW_TYPES[id].label}</span>
                      <span className="block text-xs text-muted">{SHOW_TYPES[id].hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="mt-4 block text-xs font-semibold text-muted">
              {type === 'church' ? 'Church name' : type === 'organization' ? 'Organisation name' : 'Show name'}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'church' ? 'e.g. Grace Chapel, Kumasi' : type === 'organization' ? 'e.g. KNUST Business School' : 'e.g. The Accra Money Talk'}
                className={input}
                maxLength={80}
              />
            </label>
            <button type="button" onClick={() => run('create')} disabled={busy !== null || name.trim().length < 2} className="btn-primary mt-4 w-full py-3">
              {busy === 'create' && <Loader2 className="h-4 w-4 animate-spin" />} Create {t.label.toLowerCase()} account
            </button>
          </div>
          <div className="rounded-3xl border border-line p-5">
            <h2 className="font-bold">Joining a team?</h2>
            <p className="mt-1 text-xs text-muted">Ask the account owner for the 6-letter invite code.</p>
            <div className="mt-4 flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="INVITE CODE" className={`${input} mt-0 font-mono tracking-widest`} maxLength={12} aria-label="Invite code" />
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
