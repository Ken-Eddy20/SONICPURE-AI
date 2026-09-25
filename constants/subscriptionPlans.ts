export type SubscriptionTier = 'payg' | 'pro' | 'audio_master';

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
    price: 'Flexible',
    priceAmount: 0, // Dynamic
    period: '$1 per 20 credits',
    description: 'Buy exactly the credits you need. Minimum $1.',
    features: [
      'Custom credit amount',
      'Never expire',
      '4 highlights enhancements per day',
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
      '600 credits / month',
      'Extract audio from video',
      '50 mins max audio length',
      'Advanced noise profiles',
      'Auto balance of volume',
      'Auto gain',
    ],
    cta: 'Subscribe Now',
  },
  audio_master: {
    name: 'Audio Master Studio',
    price: '$60',
    priceAmount: 60,
    period: '/month',
    description: 'The ultimate package for studios and heavy users.',
    features: [
      '2000 Credits / month',
      'Multiple Uploads',
      'Highest Tier Enhancement',
      'Auto balance of volume',
      'Auto gain',
      'Audio dereverberation',
      'Audio restoration',
      'Priority support',
    ],
    cta: 'Get Audio Master',
  },
};
