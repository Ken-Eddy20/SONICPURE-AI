export type SubscriptionTier = 'payg' | 'pro' | 'audio_master' | 'podcast' | 'church';

export interface TierDetails {
  name: string;
  price: string;
  priceAmount: number;
  period: string;
  description: string;
  features: string[];
  cta: string;
  credits: string;
}

export const TIER_DETAILS: Record<SubscriptionTier, TierDetails> = {
  payg: {
    name: 'Pay As You Go',
    price: 'From $1',
    priceAmount: 0, // Chosen by the buyer: $1 per 20 credits
    period: '$1 per 20 credits',
    credits: 'Buy exactly what you need',
    description: 'Top up any amount from 20 credits. Credits never expire.',
    features: [
      'Credits never expire',
      '4 enhancements per day',
      'Files up to 30 minutes',
      'Noise Removal, Studio Sound, Podcast Polish',
      'Loudness targets and MP3 / WAV / FLAC / M4A export',
    ],
    cta: 'Buy credits',
  },
  pro: {
    name: 'Pro',
    price: '$20',
    priceAmount: 20,
    period: '/month',
    credits: '600 credits',
    description: 'Full studio quality for weekly creators.',
    features: [
      '600 credits',
      'Unlimited daily enhancements',
      'Podcast Polish at full strength: fillers, stutters, mouth clicks, dead air',
      'Custom Mix: choose every fix yourself',
      'AI show notes: transcript, summary, chapters, social posts',
      'Upload video and get cleaned video back',
      'Files up to 50 minutes',
    ],
    cta: 'Go Pro',
  },
  audio_master: {
    name: 'Audio Master',
    price: '$60',
    priceAmount: 60,
    period: '/month',
    credits: '2,000 credits',
    description: 'For studios and teams processing every day.',
    features: [
      '2,000 credits',
      'Everything in Pro',
      'Batch upload: queue several files at once',
      'No file length limit',
      'Priority support',
    ],
    cta: 'Get Audio Master',
  },
  podcast: {
    name: 'Podcast',
    price: '$15',
    priceAmount: 15,
    period: '/month',
    credits: '600 shared credits',
    description: 'Your own show on Spotify and Apple Podcasts, from record to publish.',
    features: [
      '600 credits shared by you and a co-host (2 people)',
      'Episode Studio: clean audio, intro music kept, title, summary, chapters, social posts',
      'Your own podcast feed on Spotify and Apple Podcasts, one-click publish',
      'Seasons, episode numbers, guests and any Apple category',
      'Transcripts in English, Twi, Ga, Ewe and more',
      'Episodes up to 4 hours, video uploads',
    ],
    cta: 'Get the Podcast plan',
  },
  church: {
    name: 'Church',
    price: '$35',
    priceAmount: 35,
    period: '/month',
    credits: '1,500 shared credits',
    description: 'Sermon studio and podcast for your church media team.',
    features: [
      '1,500 credits shared by up to 5 team members',
      'Sermon Studio: clean audio, worship songs kept, title, summary, chapters, social posts',
      'Your own church podcast on Spotify and Apple Podcasts',
      'Transcripts in Twi, Fante, Ga, Ewe, Dagbani, Hausa and more, with English translation',
      'Captions on sermon clips for WhatsApp, TikTok and Reels',
      'Services up to 2.5 hours, video uploads, everything in Pro',
    ],
    cta: 'Get the Church plan',
  },
};

export const FREE_PLAN = {
  name: 'Free',
  price: '$0',
  credits: '50 credits on signup',
  description: 'Try it on a real recording.',
  features: [
    '50 free credits',
    '2 enhancements per day',
    'Files up to 20 minutes',
    'Noise Removal, Studio Sound, Podcast Polish',
    'Loudness targets and all export formats',
  ],
};
