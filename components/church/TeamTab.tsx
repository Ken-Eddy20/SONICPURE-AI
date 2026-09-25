import { useState } from 'react';
import { Check, Copy, Loader2, MessageCircle, RefreshCw, UserMinus } from 'lucide-react';
import { ApiError, leaveChurch, regenerateInvite, removeChurchMember, type Church, type ChurchMember } from '../../services/api';

interface Props {
  church: Church;
  members: ChurchMember[];
  onChanged: () => void;
}

export default function TeamTab({ church, members, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = church.role === 'owner';
  const full = church.memberCount >= church.maxMembers;

  const inviteText = `Join ${church.name} on SonicPure AI to help with our sermon recordings. Sign up at ${window.location.origin}, open the Church tab and enter this code: ${church.inviteCode}`;

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <div className="card p-6">
        <h2 className="text-lg font-bold">Invite your media team</h2>
        <p className="mt-1 text-sm text-muted">
          Up to {church.maxMembers} people share the church credits. Everyone can upload and publish sermons.
        </p>
        <div className="mt-5 rounded-2xl bg-sunken p-5 text-center">
          <p className="eyebrow">Invite code</p>
          <p className="mt-2 font-mono text-3xl font-extrabold tracking-[0.25em]">{church.inviteCode}</p>
        </div>
        {full ? (
          <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">The team is full. Remove someone to invite a new member.</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary py-2.5"
            >
              <MessageCircle className="h-4 w-4" /> Share on WhatsApp
            </a>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(inviteText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              className="btn-ghost py-2.5"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy invite'}
            </button>
          </div>
        )}
        {owner && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act('regen', regenerateInvite)}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            {busy === 'regen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Make a new code (the old one stops working)
          </button>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-bold">Team members</h2>
        <ul className="mt-4 divide-y divide-line">
          {members.map((m) => (
            <li key={m.uid} className="flex items-center gap-3 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.displayName || m.email}</p>
                <p className="truncate text-xs text-muted">{m.email}</p>
              </div>
              <span className="chip py-0.5 text-[11px]">{m.role === 'owner' ? 'Admin' : 'Media team'}</span>
              {owner && m.role !== 'owner' && (
                <button
                  type="button"
                  aria-label={`Remove ${m.email}`}
                  disabled={busy !== null}
                  onClick={() => window.confirm(`Remove ${m.displayName || m.email} from the team?`) && act(m.uid, () => removeChurchMember(m.uid))}
                  className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-danger-soft hover:text-danger"
                >
                  {busy === m.uid ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
        {!owner && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => window.confirm(`Leave ${church.name}? You will go back to your own plan and credits.`) && act('leave', leaveChurch)}
            className="btn-ghost mt-4 py-2 text-danger"
          >
            Leave this church team
          </button>
        )}
        {error && <p className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
