import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowRight, Loader2, X } from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';
import { LogoMark } from './ui/Logo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

function friendlyError(err: { code?: string; message?: string }) {
  switch (err.code) {
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email. Sign in instead.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for your password.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/account-exists-with-different-credential':
      return 'This email is already linked to another sign-in method. Try Google or email.';
    default:
      return err.message || 'Sign-in failed. Please try again.';
  }
}

export default function AuthModal({ isOpen, onClose, initialMode = 'signin' }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setInfo(null);
      setPassword('');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (!isOpen) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen, onClose]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(friendlyError(err as { code?: string; message?: string }));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() =>
      mode === 'signup' ? createUserWithEmailAndPassword(auth, email, password) : signInWithEmailAndPassword(auth, email, password),
    );
  };

  const resetPassword = async () => {
    if (!email) {
      setError('Enter your email first, then tap "Forgot password".');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setError(null);
      setInfo(`Reset link sent to ${email}.`);
    } catch (err) {
      setError(friendlyError(err as { code?: string; message?: string }));
    }
  };

  const inputClass =
    'mt-1.5 block w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="auth"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6"
        >
          <div onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
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

            <LogoMark className="h-10 w-10" />
            <h2 id="auth-title" className="mt-5 text-2xl font-extrabold tracking-tight">
              {mode === 'signin' ? 'Welcome back' : 'Start with 50 free credits'}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {mode === 'signin' ? 'Sign in to your studio.' : 'No card needed. Clean your first recording in minutes.'}
            </p>

            {error && (
              <div className="mt-5 flex gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            {info && <div className="mt-5 rounded-2xl bg-accent-soft px-4 py-3 text-sm text-accent">{info}</div>}

            <div className="mt-6 grid gap-2.5">
              <button type="button" disabled={busy} onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))} className="btn-ghost py-3">
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => signInWithPopup(auth, new FacebookAuthProvider()))} className="btn-ghost py-3">
                <svg className="h-4 w-4 text-[#1877F2]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Continue with Facebook
              </button>
            </div>

            <div className="my-6 flex items-center gap-3 text-xs font-semibold text-faint">
              <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-muted">Email</span>
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
              </label>
              <label className="block">
                <span className="flex items-center justify-between text-xs font-semibold text-muted">
                  Password
                  {mode === 'signin' && (
                    <button type="button" onClick={resetPassword} className="font-semibold text-accent">
                      Forgot password?
                    </button>
                  )}
                </span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 6 characters"
                />
              </label>
              <button type="submit" disabled={busy} className="btn-primary w-full py-3">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'signin' ? 'Sign in' : 'Create account'}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted">
              {mode === 'signin' ? 'New to SonicPure?' : 'Already have an account?'}{' '}
              <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="font-bold text-accent">
                {mode === 'signin' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
            {mode === 'signup' && (
              <p className="mt-3 text-center text-xs text-faint">
                By continuing you agree to the <a href="/terms.html" className="underline">Terms</a> and{' '}
                <a href="/privacy.html" className="underline">Privacy Policy</a>.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
