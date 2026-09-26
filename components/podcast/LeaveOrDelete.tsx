import { useState } from 'react';
import { Loader2, LogOut, Trash2 } from 'lucide-react';
import { ApiError, deleteShow, leaveShow, type Show } from '../../services/api';
import { showType } from '../../shared/processing.js';

interface Props {
  show: Show;
  onChanged: () => void;
}

/** Members leave the team; the owner deletes the whole account. */
export default function LeaveOrDelete({ show, onChanged }: Props) {
  const t = showType(show.type);
  const owner = show.role === 'owner';
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      setBusy(false);
    }
  };

  if (!owner) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold">Leave {show.name}</h2>
        <p className="mt-1 text-sm text-muted">You go back to your own plan and credits. Files you uploaded stay in your library.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => window.confirm(`Leave ${show.name}?`) && run(leaveShow)}
          className="btn-ghost mt-4 py-2.5 text-danger"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} Leave this team
        </button>
        {error && <p className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const matches = typed.trim().toLowerCase() === show.name.trim().toLowerCase();

  return (
    <div className="card border-danger/30 p-6">
      <h2 className="text-lg font-bold">Delete this account</h2>
      <p className="mt-1 text-sm text-muted">
        Closes {show.name} for everyone. Want to start a different {show.type === 'church' ? 'church or podcast' : 'show'} account? Delete this one first.
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost mt-4 py-2.5 text-danger">
          <Trash2 className="h-4 w-4" /> Delete account
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-2xl bg-danger-soft p-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-ink">
            <li>All {show.memberCount} team member{show.memberCount === 1 ? '' : 's'} are removed.</li>
            <li>All {t.items.toLowerCase()} are removed and the podcast feed stops working. Spotify and Apple will drop the show.</li>
            {show.credits > 0 && <li className="font-semibold text-danger">{show.credits.toLocaleString()} shared credits are lost. They are not refunded.</li>}
            <li>Audio files stay in each uploader’s own library.</li>
          </ul>
          <label className="block text-xs font-semibold text-muted">
            Type <span className="font-bold text-ink">{show.name}</span> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-danger"
              autoFocus
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!matches || busy}
              onClick={() => run(() => deleteShow(typed))}
              className="btn-primary bg-danger py-2.5 text-white hover:bg-danger disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Delete permanently
            </button>
            <button type="button" onClick={() => { setOpen(false); setTyped(''); }} className="btn-ghost py-2.5">Cancel</button>
          </div>
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
