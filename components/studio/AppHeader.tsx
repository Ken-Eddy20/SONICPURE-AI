import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Coins, LogOut, Sparkles } from 'lucide-react';
import type { User } from 'firebase/auth';
import Logo from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';
import type { Plan } from '../../services/api';
import { PLAN_NAMES } from '../../shared/processing.js';

export type StudioView = 'studio' | 'meetings' | 'podcast' | 'plans';

const VIEWS: [StudioView, string][] = [
  ['studio', 'Studio'],
  ['meetings', 'Meetings'],
  ['podcast', 'Podcast'],
  ['plans', 'Plans'],
];

const PLAN_LABEL = PLAN_NAMES as Record<Plan, string>;

interface AppHeaderProps {
  user: User;
  plan: Plan;
  credits: number | null;
  /** True when credits come from a podcast or church team's shared pool. */
  showBilling?: boolean;
  view: StudioView;
  onView: (view: StudioView) => void;
  onSignOut: () => void;
}

export default function AppHeader({ user, plan, credits, showBilling, view, onView, onSignOut }: AppHeaderProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const name = user.displayName || user.email?.split('@')[0] || 'You';
  const initial = name.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo onClick={() => onView('studio')} />

        <nav className="ml-2 hidden items-center gap-1 rounded-full border border-line bg-surface p-1 sm:flex">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${
                view === v ? 'bg-ink text-bg' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onView('plans')}
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold"
            title="Credits"
          >
            <Coins className="h-4 w-4 text-accent" />
            {credits === null ? '…' : Math.max(0, credits).toLocaleString()}
            <span className="hidden text-muted md:inline">{showBilling ? 'team credits' : 'credits'}</span>
          </button>
          <ThemeToggle />

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-sunken"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">{initial}</span>
              )}
              <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <div role="menu" className="card absolute right-0 mt-2 w-64 overflow-hidden p-1.5">
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-bold">{name}</p>
                  <p className="truncate text-xs text-muted">{user.email}</p>
                  <span className="chip mt-2 py-0.5 text-[11px]">{PLAN_LABEL[plan]} plan</span>
                </div>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<Sparkles className="h-4 w-4 text-accent" />} onClick={() => { setOpen(false); onView('plans'); }}>
                  Upgrade or buy credits
                </MenuItem>
                <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={() => { setOpen(false); onSignOut(); }}>
                  Sign out
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="flex gap-1 border-t border-line/70 px-4 py-2 sm:hidden">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            className={`flex-1 whitespace-nowrap rounded-full px-1 py-1.5 text-xs font-semibold ${view === v ? 'bg-ink text-bg' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-sunken">
      {icon}
      {children}
    </button>
  );
}
