import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, ArrowRight, CreditCard } from 'lucide-react';
import { type SubscriptionTier, TIER_DETAILS } from '../constants/subscriptionPlans';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  tier: SubscriptionTier;
  isAuthenticated: boolean;
  onSignIn?: () => void;
  onCheckout?: (tier: SubscriptionTier) => void;
}

export default function SubscriptionModal({
  isOpen,
  onClose,
  tier,
  isAuthenticated,
  onSignIn,
  onCheckout,
}: SubscriptionModalProps) {
  const details = TIER_DETAILS[tier];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="subscription-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-white dark:bg-[#151619] rounded-3xl shadow-2xl overflow-hidden border border-gray-200 dark:border-white/10"
          >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-gray-500 dark:text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="p-8">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold uppercase tracking-widest mb-4">
                Upgrade
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                {details.name}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">{details.description}</p>
            </div>

            <div className="mb-8 p-6 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl font-extrabold text-gray-900 dark:text-white">{details.price}</span>
                <span className="text-gray-500 dark:text-white/50">{details.period}</span>
              </div>
              <ul className="space-y-3">
                {details.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {isAuthenticated ? (
              <>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <CreditCard className="w-4 h-4" />
                    Secure checkout — connect your payment method
                  </div>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    onCheckout?.(tier);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold shadow-lg shadow-indigo-500/20 transition-all"
                >
                  Continue to Checkout
                  <ArrowRight className="w-5 h-5" />
                </button>
                <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
                  You will be redirected to our secure payment page.
                </p>
              </>
            ) : (
              <>
                <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
                  Sign in or create an account to proceed with your subscription.
                </p>
                <button
                  onClick={() => {
                    onClose();
                    onSignIn?.();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold shadow-lg shadow-indigo-500/20 transition-all"
                >
                  Sign In to Continue
                  <ArrowRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
