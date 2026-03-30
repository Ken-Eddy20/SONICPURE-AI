import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Lock, CheckCircle2, Shield, AlertCircle, Loader2 } from 'lucide-react';
import { type SubscriptionTier, TIER_DETAILS } from '../constants/subscriptionPlans';
import { auth } from '../firebase';

declare global {
  interface Window {
    PaystackPop: {
      setup(options: {
        key: string;
        email: string;
        amount: number;
        currency?: string;
        ref?: string;
        channels?: string[];
        metadata?: Record<string, unknown>;
        onClose: () => void;
        callback: (response: { reference: string }) => void;
      }): { openIframe: () => void };
    };
  }
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface PaymentPageProps {
  tier: SubscriptionTier;
  onBack: () => void;
  userEmail?: string | null;
  onPaymentSuccess?: () => void;
}

export default function PaymentPage({ tier, onBack, userEmail, onPaymentSuccess }: PaymentPageProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const details = TIER_DETAILS[tier];

  const handlePayWithPaystack = async () => {
    setError(null);
    setIsProcessing(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        setError('Please sign in to continue.');
        setIsProcessing(false);
        return;
      }

      const token = await user.getIdToken();

      const initRes = await fetch(`${API_BASE}/api/paystack/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier }),
      });

      const initData = await initRes.json();

      if (!initRes.ok) {
        setError(initData.error || 'Failed to initialize payment.');
        setIsProcessing(false);
        return;
      }

      const { access_code, reference } = initData;

      if (!window.PaystackPop) {
        setError('Paystack script not loaded. Please refresh the page.');
        setIsProcessing(false);
        return;
      }

      const handler = window.PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '',
        email: userEmail || user.email || '',
        amount: details.priceAmount * 100,
        currency: 'USD',
        ref: reference,
        channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
        metadata: { tier, userId: user.uid },
        callback: async (response) => {
          try {
            setIsProcessing(true);
            const verifyRes = await fetch(`${API_BASE}/api/paystack/verify/${response.reference}`, {
              headers: { Authorization: `Bearer ${token}` },
            });

            const verifyData = await verifyRes.json();

            if (verifyRes.ok && verifyData.success) {
              setSuccess(true);
              onPaymentSuccess?.();
            } else {
              setError(verifyData.error || 'Payment verification failed. Contact support if you were charged.');
            }
          } catch {
            setError('Could not verify payment. If you were charged, contact support.');
          } finally {
            setIsProcessing(false);
          }
        },
        onClose: () => {
          setIsProcessing(false);
        },
      });

      handler.openIframe();
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
      setIsProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full p-10 rounded-3xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 shadow-xl text-center"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Payment Successful!</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-2">
            You've been upgraded to <span className="font-semibold text-indigo-600 dark:text-indigo-400">{details.name}</span>.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-8">
            {tier === 'payg' ? '150 credits have been added to your account.' : 'Your new plan is now active.'}
          </p>
          <button
            onClick={onBack}
            className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors shadow-lg shadow-indigo-500/20"
          >
            Start Using SonicPure AI
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-12 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to plans
        </button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-12"
        >
          {/* Order Summary */}
          <div className="order-2 lg:order-1">
            <div className="p-8 rounded-3xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 shadow-xl">
              <h2 className="text-xl font-bold mb-6">Order Summary</h2>
              <div className="flex items-center justify-between mb-6 pb-6 border-b border-gray-200 dark:border-white/10">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{details.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-white/50">{details.period}</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                    {details.price}
                  </span>
                  {tier !== 'payg' && (
                    <span className="text-gray-500 dark:text-white/50 text-sm">/mo</span>
                  )}
                </div>
              </div>
              <ul className="space-y-3 mb-8">
                {details.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
                <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <p className="text-sm text-indigo-800 dark:text-indigo-200">
                  Secured by Paystack. Card, Bank Transfer & Mobile Money accepted.
                </p>
              </div>
            </div>
          </div>

          {/* Payment Panel */}
          <div className="order-1 lg:order-2">
            <div className="p-8 rounded-3xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 shadow-xl">
              <h2 className="text-xl font-bold mb-2">Complete Payment</h2>
              <p className="text-sm text-gray-500 dark:text-white/50 mb-8">
                You'll be redirected to Paystack's secure checkout to complete your payment via Card, Bank Transfer, or Mobile Money.
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Email</span>
                  <span className="text-sm font-medium">{userEmail || 'Not signed in'}</span>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Plan</span>
                  <span className="text-sm font-medium">{details.name}</span>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Total</span>
                  <span className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{details.price}</span>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-3 p-4 mb-6 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {error}
                </div>
              )}

              <button
                onClick={handlePayWithPaystack}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-semibold shadow-lg shadow-indigo-500/20 transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Lock className="w-5 h-5" />
                    Pay {details.price} with Paystack
                  </>
                )}
              </button>

              <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
                Secure payment powered by Paystack. All payment methods accepted.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
