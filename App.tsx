import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Landing from './components/landing/Landing';
import Studio, { type UserSnapshot } from './components/studio/Studio';
import AuthModal from './components/AuthModal';
import SubscriptionModal from './components/SubscriptionModal';
import PaymentPage from './components/PaymentPage';
import { LogoMark } from './components/ui/Logo';
import type { SubscriptionTier } from './constants/subscriptionPlans';
import type { Plan } from './services/api';
import { PLAN_IDS } from './shared/processing.js';

const TIERS: SubscriptionTier[] = ['payg', 'pro', 'audio_master', 'church'];

interface Checkout {
  tier: SubscriptionTier;
  credits?: number;
}

/** Paystack's redirect flow returns with ?reference=... on the URL. */
function readPaymentReturn(): (Checkout & { reference: string }) | null {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  const tier = params.get('tier') as SubscriptionTier | null;
  if (!reference || !tier || !TIERS.includes(tier)) return null;
  const credits = parseInt(params.get('credits') || '', 10);
  return { reference, tier, credits: Number.isFinite(credits) ? credits : undefined };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [account, setAccount] = useState<(Omit<UserSnapshot, 'churchBilling'> & { churchId: string | null }) | null>(null);
  const [church, setChurch] = useState<{ id: string; plan: string; credits: number; creditsUsedThisMonth: number } | null>(null);

  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  const [upgradeTier, setUpgradeTier] = useState<SubscriptionTier | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [paymentReturn] = useState(readPaymentReturn);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );

  useEffect(() => {
    if (!user) {
      setAccount(null);
      return;
    }
    const ref = doc(db, 'users', user.uid);

    // Starter profile. Field list must match the `create` rule in firestore.rules.
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) return;
        return setDoc(ref, {
          email: user.email || '',
          displayName: user.displayName || user.email?.split('@')[0] || 'Creator',
          plan: 'free',
          credits: 50,
          creditsUsedThisMonth: 0,
          dailyEnhancesUsed: 0,
          dailyEnhancesDate: '',
          dailyEnhancesResetAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          billingRenewDate: serverTimestamp(),
          paystackCustomerId: null,
          isActive: true,
        });
      })
      .catch((err) => console.error('Could not create user profile:', err));

    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const plan = PLAN_IDS.includes(d.plan) ? (d.plan as Plan) : 'free';
        setAccount({
          plan,
          credits: typeof d.credits === 'number' ? d.credits : 0,
          creditsUsedThisMonth: d.creditsUsedThisMonth || 0,
          dailyEnhancesUsed: d.dailyEnhancesUsed || 0,
          dailyEnhancesDate: d.dailyEnhancesDate || '',
          churchId: d.churchId || null,
        });
      },
      (err) => console.error('Firestore error:', err),
    );
  }, [user]);

  // Church members on an active Church plan use the church's shared credits.
  const churchId = account?.churchId || null;
  useEffect(() => {
    if (!churchId) {
      setChurch(null);
      return;
    }
    return onSnapshot(
      doc(db, 'churches', churchId),
      (snap) => {
        const d = snap.data();
        setChurch(d ? { id: snap.id, plan: d.plan, credits: Number(d.credits || 0), creditsUsedThisMonth: Number(d.creditsUsedThisMonth || 0) } : null);
      },
      () => setChurch(null),
    );
  }, [churchId]);

  const effective = useMemo<UserSnapshot | null>(() => {
    if (!account) return null;
    const { churchId: _ignored, ...base } = account;
    if (church?.plan === 'church') {
      return { ...base, plan: 'church', credits: church.credits, creditsUsedThisMonth: church.creditsUsedThisMonth, churchBilling: true };
    }
    return { ...base, churchBilling: false };
  }, [account, church]);

  // Resume a redirect-based Paystack payment once auth is known.
  useEffect(() => {
    if (paymentReturn && user) setCheckout({ tier: paymentReturn.tier, credits: paymentReturn.credits });
  }, [paymentReturn, user]);

  if (!authReady) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  if (checkout && user) {
    return (
      <PaymentPage
        tier={checkout.tier}
        customCredits={checkout.credits}
        userEmail={user.email}
        resumeReference={paymentReturn?.tier === checkout.tier ? paymentReturn.reference : null}
        onBack={() => {
          setCheckout(null);
          if (paymentReturn) window.history.replaceState(null, '', window.location.pathname);
        }}
      />
    );
  }

  return (
    <>
      {user && effective ? (
        <Studio user={user} account={effective} onChoosePlan={setUpgradeTier} onSignOut={() => signOut(auth)} />
      ) : user ? (
        <div className="grid min-h-screen place-items-center">
          <LogoMark className="h-10 w-10 animate-pulse" />
        </div>
      ) : (
        <Landing onSignIn={() => setAuthMode('signin')} onSignUp={() => setAuthMode('signup')} onChoosePlan={setUpgradeTier} />
      )}

      <AuthModal isOpen={authMode !== null} initialMode={authMode || 'signin'} onClose={() => setAuthMode(null)} />

      <SubscriptionModal
        isOpen={upgradeTier !== null}
        tier={upgradeTier || 'payg'}
        isAuthenticated={Boolean(user)}
        onClose={() => setUpgradeTier(null)}
        onSignIn={() => setAuthMode('signup')}
        onCheckout={(tier, credits) => setCheckout({ tier, credits })}
      />
    </>
  );
}
