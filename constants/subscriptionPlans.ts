export type SubscriptionTier = 'payg' | 'pro' | 'unlimited';

export const TIER_DETAILS: Record<SubscriptionTier, {
  name: string;
  price: string;
  priceAmount: number; // For payment integration
  period: string;
  description: string;
  features: string[];
  cta: string;
}> = {
  payg: {
    name: 'Pay As You Go',
    price: '$5',
    priceAmount: 5,
    period: '150 credits (never expire)',
    description: 'For occasional creators who need flexibility.',
    features: [
      '150 credits (never expire)',
      'Unlimited daily enhances',
      '30 mins max audio length',
      'High priority processing',
    ],
    cta: 'Buy Credits',
  },
  pro: {
    name: 'Pro',
    price: '$20',
    priceAmount: 20,
    period: '/month',
    description: 'For professional workflows.',
    features: [
      '2500 credits / month',
      'Extract audio from video',
      '50 mins max audio length',
      'Advanced noise profiles',
      'Auto balance of volume',
      'Auto gain',
    ],
    cta: 'Subscribe Now',
  },
  unlimited: {
    name: 'Unlimited Studio',
    price: '$60',
    priceAmount: 60,
    period: '/month',
    description: 'The ultimate package for studios and heavy users.',
    features: [
      'Unlimited Credits',
      'Multiple Uploads',
      'Highest Tier Enhancement',
      'Auto balance of volume',
      'Auto gain',
      'Audio dereverberation',
      'Audio restoration',
      'Priority support',
    ],
    cta: 'Get Unlimited',
  },
};
