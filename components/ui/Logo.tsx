export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <g className="fill-accent-ink">
        <rect x="7" y="12" width="3" height="8" rx="1.5" />
        <rect x="12" y="7" width="3" height="18" rx="1.5" />
        <rect x="17" y="10" width="3" height="12" rx="1.5" />
        <rect x="22" y="14" width="3" height="4" rx="1.5" />
      </g>
    </svg>
  );
}

export default function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-lg" aria-label="SonicPure AI home">
      <LogoMark />
      <span className="text-[17px] font-extrabold tracking-tight text-ink">
        SonicPure<span className="ml-1 font-semibold text-muted">AI</span>
      </span>
    </button>
  );
}
