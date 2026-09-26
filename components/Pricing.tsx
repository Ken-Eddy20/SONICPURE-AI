import { Check, Church, Radio } from 'lucide-react';
import { FREE_PLAN, TIER_DETAILS, type SubscriptionTier } from '../constants/subscriptionPlans';
import type { Plan } from '../services/api';

interface PricingProps {
  currentPlan?: Plan | null;
  onChoose: (tier: SubscriptionTier) => void;
  onStartFree?: () => void;
}

const ORDER: SubscriptionTier[] = ['payg', 'pro', 'audio_master'];

export default function Pricing({ currentPlan, onChoose, onStartFree }: PricingProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <PlanCard
        name={FREE_PLAN.name}
        price={FREE_PLAN.price}
        period=""
        credits={FREE_PLAN.credits}
        description={FREE_PLAN.description}
        features={FREE_PLAN.features}
        current={currentPlan === 'free'}
        cta={currentPlan ? 'Your starting plan' : 'Start free'}
        onClick={currentPlan ? undefined : onStartFree}
      />
      {ORDER.map((tier) => {
        const t = TIER_DETAILS[tier];
        return (
          <PlanCard
            key={tier}
            name={t.name}
            price={t.price}
            period={t.period}
            credits={t.credits}
            description={t.description}
            features={t.features}
            featured={tier === 'pro'}
            current={currentPlan === tier}
            cta={currentPlan === tier && tier !== 'payg' ? 'Current plan' : t.cta}
            onClick={currentPlan === tier && tier !== 'payg' ? undefined : () => onChoose(tier)}
          />
        );
      })}
      <TeamPlans currentPlan={currentPlan} onChoose={onChoose} />
    </div>
  );
}

const TEAM_PLANS: { tier: 'podcast' | 'church'; icon: typeof Radio; topUp: string }[] = [
  { tier: 'podcast', icon: Radio, topUp: 'Renew plan (+1,500 credits)' },
  { tier: 'church', icon: Church, topUp: 'Renew plan (+1,500 credits)' },
];

/** Podcast and Church plans: shared credits for a team plus a podcast feed. */
function TeamPlans({ currentPlan, onChoose }: { currentPlan?: Plan | null; onChoose: (tier: SubscriptionTier) => void }) {
  return (
    <div className="rounded-3xl border border-line bg-ink p-5 text-bg sm:p-7 md:col-span-2 xl:col-span-4">
      <p className="eyebrow text-accent">For podcasters and churches</p>
      <h3 className="mt-1 text-2xl font-extrabold tracking-tight">Record, clean and publish to Spotify and Apple Podcasts</h3>
      <p className="mt-1 text-sm opacity-70">Same package, same price. Recording and editing in the Podcast tab are free on every plan; these add AI cleaning, 1,500 shared credits for up to 5 people and your own podcast feed. Shorter episodes mean your credits go further. Run out early? Anyone on the team can top up 350 credits for $10.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {TEAM_PLANS.map(({ tier, icon: Icon, topUp }) => {
          const t = TIER_DETAILS[tier];
          const current = currentPlan === tier;
          return (
            <div key={tier} className="flex flex-col rounded-2xl border border-bg/15 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-accent" />
                <h4 className="text-lg font-bold">{t.name} plan</h4>
                {current && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-ink">Current</span>}
              </div>
              <p className="mt-1 text-sm opacity-70">{t.description}</p>
              <p className="mt-4">
                <span className="text-4xl font-extrabold tracking-tight">{t.price}</span>
                <span className="opacity-60">{t.period}</span>
              </p>
              <p className="mt-1 text-sm font-semibold text-accent">{t.credits}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span className="opacity-90">{f}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => onChoose(tier)} className="btn-primary mt-6 w-full py-3">
                {current ? topUp : t.cta}
              </button>
              {current && (
                <button type="button" onClick={() => onChoose('team_topup')} className="mt-2 text-sm font-semibold text-accent hover:underline">
                  Need less? Top up 350 credits for $10
                </button>
              )}
              {current && (
                <button type="button" onClick={() => onChoose('hosting_addon')} className="mt-1 text-sm font-semibold text-accent hover:underline">
                  More podcast space: +250 hours for $3/month
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  credits: string;
  description: string;
  features: string[];
  cta: string;
  featured?: boolean;
  current?: boolean;
  onClick?: () => void;
}

function PlanCard({ name, price, period, credits, description, features, cta, featured, current, onClick }: PlanCardProps) {
  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-6 ${
        featured ? 'border-accent bg-surface shadow-card ring-1 ring-accent' : 'border-line bg-surface'
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-accent-ink">
          Best value
        </span>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">{name}</h3>
        {current && <span className="chip py-0.5 text-[11px]">Current</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight">{price}</span>
        {period && <span className="text-sm text-muted">{period}</span>}
      </div>
      <p className="mt-1 text-sm font-semibold text-accent">{credits}</p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex gap-2.5 text-sm text-ink">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className={`mt-8 w-full ${featured ? 'btn-primary' : 'btn-ghost'} py-3`}
      >
        {cta}
      </button>
    </div>
  );
}
