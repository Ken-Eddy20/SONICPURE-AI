import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react';
import { TIER_DETAILS, type SubscriptionTier } from '../constants/subscriptionPlans';
import {
  HOSTING_ADDON_HOURS, HOSTING_ADDON_MAX_BLOCKS, HOSTING_ADDON_USD,
  PAYG_MAX_CREDITS, PAYG_MIN_CREDITS, TEAM_TOPUP_PACK_CREDITS, TEAM_TOPUP_MAX_PACKS, paygPriceUsd, teamTopupPriceUsd,
} from '../shared/processing.js';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  tier: SubscriptionTier;
  isAuthenticated: boolean;
  onSignIn?: () => void;
  onCheckout?: (tier: SubscriptionTier, customCredits?: number) => void;
}

const PAYG_PRESETS = [100, 200, 500, 1000];

function formatUsd(amount: number) {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export default function SubscriptionModal({ isOpen, onClose, tier, isAuthenticated, onSignIn, onCheckout }: SubscriptionModalProps) {
  const details = TIER_DETAILS[tier];
  const isPayg = tier === 'payg';
  const isTeam = tier === 'team_topup';
  const isSpace = tier === 'hosting_addon';
  const [blocks, setBlocks] = useState(1);
  const [packs, setPacks] = useState(1);
  const [credits, setCredits] = useState(200);
  const [raw, setRaw] = useState('200');

  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen, onClose]);

  const choose = (value: number) => {
    setCredits(value);
    setRaw(String(value));
  };
  const typed = parseInt(raw, 10);
  const validAmount = Number.isFinite(typed) && typed >= PAYG_MIN_CREDITS && typed <= PAYG_MAX_CREDITS;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="subscription"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
        >
          <div onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sub-title"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative max-h-[95vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border border-line bg-surface p-7 shadow-card sm:rounded-[2rem] sm:p-8"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="eyebrow text-accent">{isPayg || isTeam || isSpace ? 'Add' : 'Upgrade'}</p>
            <h2 id="sub-title" className="mt-2 text-2xl font-extrabold tracking-tight">{details.name}</h2>
            <p className="mt-1 text-sm text-muted">{details.description}</p>

            <div className="mt-6 rounded-2xl bg-sunken p-5">
              {isSpace ? (
                <>
                  <p className="text-xs font-semibold text-muted">How much extra space?</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {Array.from({ length: HOSTING_ADDON_MAX_BLOCKS }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setBlocks(n)}
                        aria-pressed={blocks === n}
                        className={`rounded-xl border py-2 text-sm font-bold transition-colors ${blocks === n ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface hover:border-line-strong'}`}
                      >
                        +{n * HOSTING_ADDON_HOURS}h
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-sm text-muted">+{blocks * HOSTING_ADDON_HOURS} hours for 30 days</span>
                    <span className="text-3xl font-extrabold tracking-tight">{formatUsd(blocks * HOSTING_ADDON_USD)}</span>
                  </div>
                </>
              ) : isTeam ? (
                <>
                  <p className="text-xs font-semibold text-muted">How many packs of {TEAM_TOPUP_PACK_CREDITS} credits?</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {[1, 2, 3, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPacks(n)}
                        aria-pressed={packs === n}
                        className={`rounded-xl border py-2 text-sm font-bold transition-colors ${packs === n ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface hover:border-line-strong'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-sm text-muted">{(packs * TEAM_TOPUP_PACK_CREDITS).toLocaleString()} credits</span>
                    <span className="text-3xl font-extrabold tracking-tight">{formatUsd(teamTopupPriceUsd(packs * TEAM_TOPUP_PACK_CREDITS))}</span>
                  </div>
                  <p className="mt-1 text-right text-xs text-muted">$10 per pack · up to {TEAM_TOPUP_MAX_PACKS} packs at once</p>
                </>
              ) : isPayg ? (
                <>
                  <p className="text-xs font-semibold text-muted">How many credits?</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {PAYG_PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => choose(p)}
                        aria-pressed={credits === p && raw === String(p)}
                        className={`rounded-xl border py-2 text-sm font-bold transition-colors ${
                          credits === p && raw === String(p) ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface hover:border-line-strong'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <label className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-accent">
                    <span className="text-xs font-semibold text-muted">Custom</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={PAYG_MIN_CREDITS}
                      max={PAYG_MAX_CREDITS}
                      step={20}
                      value={raw}
                      onChange={(e) => {
                        setRaw(e.target.value);
                        const v = parseInt(e.target.value, 10);
                        if (Number.isFinite(v)) setCredits(v);
                      }}
                      className="w-full bg-transparent text-right text-base font-bold outline-none"
                      aria-label="Custom credit amount"
                    />
                    <span className="text-xs text-muted">credits</span>
                  </label>
                  {!validAmount && (
                    <p className="mt-2 text-xs font-semibold text-danger">
                      Choose between {PAYG_MIN_CREDITS} and {PAYG_MAX_CREDITS.toLocaleString()} credits.
                    </p>
                  )}
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-sm text-muted">{validAmount ? `${credits.toLocaleString()} credits` : 'Total'}</span>
                    <span className="text-3xl font-extrabold tracking-tight">{validAmount ? formatUsd(paygPriceUsd(credits)) : '–'}</span>
                  </div>
                  <p className="mt-1 text-right text-xs text-muted">$1 per 20 credits · about {Math.floor((validAmount ? credits : 0) / 2)} min of noise removal</p>
                </>
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold tracking-tight">{details.price}</span>
                  <span className="text-sm text-muted">{details.period}</span>
                </div>
              )}
              <ul className="mt-4 space-y-2">
                {details.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {f}
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              disabled={isPayg && !validAmount}
              onClick={() => {
                onClose();
                if (isAuthenticated) onCheckout?.(tier, isSpace ? blocks : isTeam ? packs * TEAM_TOPUP_PACK_CREDITS : isPayg ? credits : undefined);
                else onSignIn?.();
              }}
              className="btn-primary mt-6 w-full py-3.5"
            >
              {isAuthenticated ? 'Continue to payment' : 'Create an account to continue'} <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Paid in cedis via Paystack: MoMo, card, bank or USSD
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
