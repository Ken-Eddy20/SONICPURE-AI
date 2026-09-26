import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { TIER_DETAILS, type SubscriptionTier } from '../constants/subscriptionPlans';
import { apiFetch, ApiError } from '../services/api';
import { HOSTING_ADDON_HOURS, HOSTING_ADDON_USD, paygPriceUsd, teamTopupPriceUsd } from '../shared/processing.js';
import Logo from './ui/Logo';

interface PaystackCallbacks {
  onSuccess?: (tx: { reference: string }) => void;
  onCancel?: () => void;
  onError?: (err: { message?: string }) => void;
}

declare global {
  interface Window {
    PaystackPop?: new () => { resumeTransaction: (accessCode: string, callbacks?: PaystackCallbacks) => void };
  }
}

interface PaymentPageProps {
  tier: SubscriptionTier;
  /** Pay As You Go only: how many credits to buy. */
  customCredits?: number;
  userEmail?: string | null;
  /** Set when returning from Paystack's hosted checkout. */
  resumeReference?: string | null;
  onBack: () => void;
}

function formatUsd(amount: number) {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export default function PaymentPage({ tier, customCredits, userEmail, resumeReference, onBack }: PaymentPageProps) {
  const details = TIER_DETAILS[tier];
  const isTeam = tier === 'team_topup';
  /** Extra podcast space: `customCredits` carries the number of 250-hour blocks. */
  const isSpace = tier === 'hosting_addon';
  /** Buyer chooses the amount (Pay As You Go credits, team top-up packs or space blocks). */
  const isPayg = tier === 'payg' || isTeam || isSpace;
  const usd = isSpace
    ? (customCredits || 1) * HOSTING_ADDON_USD
    : isTeam ? teamTopupPriceUsd(customCredits || 0) : isPayg ? paygPriceUsd(customCredits || 0) : details.priceAmount;
  const creditsLabel = isSpace
    ? `+${(customCredits || 1) * HOSTING_ADDON_HOURS} hours for 30 days`
    : isPayg ? `${(customCredits || 0).toLocaleString()} credits` : details.credits;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsAdded, setCreditsAdded] = useState<number | null>(null);
  const [rate, setRate] = useState<{ currency: string; rate: number } | null>(null);
  const verifiedRef = useRef(false);

  useEffect(() => {
    apiFetch<{ currency: string; rate: number }>('/api/paystack/rate').then(setRate).catch(() => setRate(null));
  }, []);

  const verify = async (reference: string) => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ creditsAdded: number }>(`/api/paystack/verify/${encodeURIComponent(reference)}`);
      setCreditsAdded(res.creditsAdded ?? 0);
    } catch (err) {
      verifiedRef.current = false;
      setError(
        `${err instanceof ApiError && err.status !== 0 ? err.message : 'Could not confirm the payment'}. ` +
          `If you were charged, email support@sonicpure.ai with reference ${reference}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (resumeReference) verify(resumeReference);
  }, [resumeReference]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams({ tier });
      if (isPayg && customCredits) params.set('credits', String(customCredits));
      const callbackUrl = `${window.location.origin}${window.location.pathname}?${params}`;
      const init = await apiFetch<{ access_code: string; authorization_url: string; reference: string }>('/api/paystack/initialize', {
        method: 'POST',
        body: JSON.stringify({ tier, customCredits: isPayg && !isSpace ? customCredits : undefined, blocks: isSpace ? customCredits || 1 : undefined, callbackUrl }),
      });

      if (window.PaystackPop) {
        new window.PaystackPop().resumeTransaction(init.access_code, {
          onSuccess: (tx) => verify(tx.reference || init.reference),
          onCancel: () => setBusy(false),
          onError: (e) => {
            setBusy(false);
            setError(e?.message || 'Paystack could not open. Try again.');
          },
        });
      } else {
        // Script blocked or still loading: use Paystack's hosted page; it redirects back with ?reference=.
        window.location.href = init.authorization_url;
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Try again.');
    }
  };

  if (creditsAdded !== null) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-8 text-center sm:p-10">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-accent-soft text-accent">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight">Payment confirmed</h1>
          <p className="mt-2 text-muted">
            {isSpace
              ? `Your podcast now has ${(customCredits || 1) * HOSTING_ADDON_HOURS} more hours of space for 30 days.`
              : <>{creditsAdded.toLocaleString()} credits are now in {isTeam ? "your team's shared pool" : 'your account'}{isPayg ? '.' : `, and you're on ${details.name}.`}</>}
          </p>
          <button type="button" onClick={onBack} className="btn-primary mt-8 w-full py-3.5">
            Back to the studio
          </button>
        </motion.div>
      </div>
    );
  }

  const local = rate && rate.currency !== 'USD' ? `${rate.currency} ${(usd * rate.rate).toFixed(2)}` : null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo onClick={onBack} />
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_400px]">
        <section className="card p-6 sm:p-8">
          <p className="eyebrow text-accent">Order summary</p>
          <div className="mt-4 flex items-start justify-between gap-4 border-b border-line pb-6">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{details.name}</h1>
              <p className="mt-1 text-sm text-muted">{creditsLabel}</p>
            </div>
            <p className="text-right">
              <span className="text-3xl font-extrabold">{formatUsd(usd)}</span>
              <span className="block text-xs text-muted">{isPayg ? 'one-time' : details.period}</span>
            </p>
          </div>
          <ul className="mt-6 space-y-2.5">
            {details.features.map((f) => (
              <li key={f} className="flex gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {f}
              </li>
            ))}
          </ul>
        </section>

        <section className="card h-fit p-6 sm:p-8">
          <h2 className="text-lg font-bold">Pay securely</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Account</dt>
              <dd className="truncate font-semibold">{userEmail}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">You get</dt>
              <dd className="font-semibold">{creditsLabel}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-base">
              <dt className="font-bold">Total</dt>
              <dd className="text-right">
                <span className="block font-extrabold">{local ? `≈ ${local}` : formatUsd(usd)}</span>
                {local && <span className="block text-xs text-muted">{formatUsd(usd)} at today's rate</span>}
              </dd>
            </div>
          </dl>

          {error && (
            <div className="mt-5 flex gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <button type="button" onClick={pay} disabled={busy || usd <= 0} className="btn-primary mt-6 w-full py-3.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {busy ? (resumeReference ? 'Confirming payment…' : 'Opening Paystack…') : `Pay ${local ? `≈ ${local}` : formatUsd(usd)}`}
          </button>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Charged in cedis at the live rate. MoMo, card, bank or USSD via Paystack.
          </p>
        </section>
      </main>
    </div>
  );
}
