/**
 * Shared processing catalogue: used by the React app (estimates, UI gating)
 * and by the Express server (authoritative pricing and Cleanvoice config).
 * Keep this file dependency-free so both runtimes can import it.
 */

export const PLAN_IDS = ['free', 'payg', 'pro', 'audio_master'];
export const PREMIUM_PLANS = ['pro', 'audio_master'];

export const PLAN_NAMES = {
  free: 'Free',
  payg: 'Pay As You Go',
  pro: 'Pro',
  audio_master: 'Audio Master',
};

/** Pay As You Go pricing: $1 buys 20 credits, minimum 20 credits. */
export const PAYG_CREDITS_PER_USD = 20;
export const PAYG_MIN_CREDITS = 20;
export const PAYG_MAX_CREDITS = 10000;

/** Credits added each time a subscription plan is paid. */
export const PLAN_CREDITS = { pro: 600, audio_master: 2000 };

/** @param {string | null | undefined} plan */
export function isPremiumPlan(plan) {
  return PREMIUM_PLANS.includes(String(plan || 'free').toLowerCase());
}

export const PROFILES = {
  noise_removal: {
    id: 'noise_removal',
    name: 'Noise Removal',
    tagline: 'Strip hum, hiss, traffic, fans and room noise. Your voice stays untouched.',
    creditsPerMin: 2,
    premium: false,
  },
  audio_enhancement: {
    id: 'audio_enhancement',
    name: 'Studio Sound',
    tagline: 'Studio-grade tone: cleans, balances and levels your voice like a treated room.',
    creditsPerMin: 3,
    premium: false,
  },
  voice_clarity: {
    id: 'voice_clarity',
    name: 'Podcast Polish',
    tagline: 'Studio sound plus softer breaths. Pro also cuts ums, stutters, mouth clicks and dead air.',
    creditsPerMin: 2,
    premium: false,
  },
  custom: {
    id: 'custom',
    name: 'Custom Mix',
    tagline: 'Pick exactly which fixes to apply. Full control over every Cleanvoice module.',
    creditsPerMin: 3,
    premium: true,
  },
};

export const PROFILE_IDS = Object.keys(PROFILES);

/** Toggles available in the Custom Mix profile. */
export const CUSTOM_TOGGLES = [
  { key: 'remove_noise', label: 'Background noise', hint: 'Hum, hiss, fans, traffic' },
  { key: 'studio_sound', label: 'Studio sound', hint: 'Mastering-grade tone' },
  { key: 'autoeq', label: 'Auto EQ', hint: 'Balances bass and treble' },
  { key: 'fillers', label: 'Filler words', hint: 'Um, uh, like' },
  { key: 'stutters', label: 'Stutters', hint: 'Repeated syllables' },
  { key: 'hesitations', label: 'Hesitations', hint: 'Awkward pauses mid-word' },
  { key: 'mouth_sounds', label: 'Mouth sounds', hint: 'Clicks and lip smacks' },
  { key: 'breath', label: 'Breaths', hint: 'Softens loud breathing' },
  { key: 'long_silences', label: 'Long silences', hint: 'Trims dead air' },
  { key: 'keep_music', label: 'Protect music', hint: 'Keeps intro and outro music' },
];

export const DEFAULT_CUSTOM = {
  remove_noise: true,
  studio_sound: false,
  autoeq: true,
  fillers: true,
  stutters: false,
  hesitations: false,
  mouth_sounds: true,
  breath: false,
  long_silences: true,
  keep_music: false,
};

export const LOUDNESS_TARGETS = {
  podcast: { label: 'Podcast', detail: '-16 LUFS', lufs: -16 },
  youtube: { label: 'YouTube / Social', detail: '-14 LUFS', lufs: -14 },
  broadcast: { label: 'Broadcast', detail: '-23 LUFS', lufs: -23 },
  none: { label: 'Keep original', detail: 'No leveling', lufs: null },
};

export const EXPORT_FORMATS = ['mp3', 'wav', 'flac', 'm4a'];

/** Extra cost for transcript + summary + chapters + social posts. */
export const AI_NOTES_CREDITS_PER_MIN = 1;

export const DEFAULT_OPTIONS = {
  exportFormat: 'mp3',
  loudness: 'podcast',
  keepMusic: false,
  aiNotes: false,
  returnVideo: false,
  custom: DEFAULT_CUSTOM,
};

/**
 * Coerce untrusted client options into a known-good shape.
 * @param {any} raw
 */
export function normalizeOptions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const custom = { ...DEFAULT_CUSTOM };
  if (src.custom && typeof src.custom === 'object') {
    for (const { key } of CUSTOM_TOGGLES) {
      if (key in src.custom) custom[key] = Boolean(src.custom[key]);
    }
  }
  return {
    exportFormat: EXPORT_FORMATS.includes(src.exportFormat) ? src.exportFormat : DEFAULT_OPTIONS.exportFormat,
    loudness: src.loudness in LOUDNESS_TARGETS ? src.loudness : DEFAULT_OPTIONS.loudness,
    keepMusic: Boolean(src.keepMusic),
    aiNotes: Boolean(src.aiNotes),
    returnVideo: Boolean(src.returnVideo),
    custom,
  };
}

/**
 * Returns an error message if the plan cannot use the requested job, otherwise null.
 * @param {string} feature
 * @param {ReturnType<typeof normalizeOptions>} options
 * @param {string} plan
 */
export function planRestriction(feature, options, plan) {
  const premium = isPremiumPlan(plan);
  if (!PROFILES[feature]) return 'Unknown processing profile.';
  if (PROFILES[feature].premium && !premium) return `${PROFILES[feature].name} is available on Pro and Audio Master.`;
  if (options.aiNotes && !premium) return 'AI show notes are available on Pro and Audio Master.';
  if (options.returnVideo && !premium) return 'Video export is available on Pro and Audio Master.';
  return null;
}

/**
 * @param {string} feature
 * @param {number} durationSeconds
 * @param {{ aiNotes?: boolean }} [options]
 */
export function estimateCredits(feature, durationSeconds, options = {}) {
  const profile = PROFILES[feature] || PROFILES.noise_removal;
  const minutes = Math.max(1, Math.ceil((durationSeconds || 60) / 60));
  const perMin = profile.creditsPerMin + (options.aiNotes ? AI_NOTES_CREDITS_PER_MIN : 0);
  return minutes * perMin;
}

/** USD price for a Pay As You Go purchase. */
export function paygPriceUsd(credits) {
  return credits / PAYG_CREDITS_PER_USD;
}

/**
 * Build the exact Cleanvoice ProcessingConfig for a job.
 * @param {string} feature
 * @param {ReturnType<typeof normalizeOptions>} options
 * @param {string} plan
 */
export function buildCleanvoiceConfig(feature, options, plan) {
  const premium = isPremiumPlan(plan);
  const target = LOUDNESS_TARGETS[options.loudness];

  /** @type {Record<string, unknown>} */
  let config;
  switch (feature) {
    case 'audio_enhancement':
      config = premium ? { studio_sound: true, autoeq: true } : { studio_sound: true };
      break;
    case 'voice_clarity':
      config = premium
        ? {
            studio_sound: true, breath: true, fillers: true, long_silences: true,
            stutters: true, hesitations: true, mouth_sounds: true,
          }
        : { studio_sound: true, breath: true };
      break;
    case 'custom': {
      const c = options.custom;
      config = {
        remove_noise: c.remove_noise,
        studio_sound: c.studio_sound,
        autoeq: c.autoeq,
        fillers: c.fillers,
        stutters: c.stutters,
        hesitations: c.hesitations,
        mouth_sounds: c.mouth_sounds,
        breath: c.breath,
        long_silences: c.long_silences,
        keep_music: c.keep_music,
      };
      break;
    }
    case 'noise_removal':
    default:
      config = { remove_noise: true };
  }

  if (options.keepMusic) config.keep_music = true;

  if (target.lufs !== null) {
    config.normalize = true;
    config.target_lufs = target.lufs;
  } else {
    config.normalize = false;
  }

  if (options.aiNotes && premium) {
    config.transcription = true;
    config.summarize = true;
    config.social_content = true;
  }

  if (!options.returnVideo) config.export_format = options.exportFormat;

  return { config, qualityLevel: premium ? 100 : 80 };
}
