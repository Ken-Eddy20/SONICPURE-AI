/**
 * Shared processing catalogue: used by the React app (estimates, UI gating)
 * and by the Express server (authoritative pricing and Cleanvoice config).
 * Keep this file dependency-free so both runtimes can import it.
 */

export const PLAN_IDS = ['free', 'payg', 'pro', 'audio_master', 'podcast', 'church'];
export const PREMIUM_PLANS = ['pro', 'audio_master', 'podcast', 'church'];

export const PLAN_NAMES = {
  free: 'Free',
  payg: 'Pay As You Go',
  pro: 'Pro',
  audio_master: 'Audio Master',
  podcast: 'Podcast',
  church: 'Church',
};

// ─── Shows (podcasts and churches share one engine) ──────────────

/** Plans that belong to a show and bill its shared credit pool. */
export const SHOW_PLANS = ['podcast', 'church'];
export const isShowPlan = (plan) => SHOW_PLANS.includes(plan);

/** People who can share a show, by its plan ('none' = not paid yet). */
export const SHOW_MAX_MEMBERS = { none: 2, podcast: 5, church: 5 };
export const showMaxMembers = (plan) => SHOW_MAX_MEMBERS[plan] ?? SHOW_MAX_MEMBERS.none;

/**
 * Wording and defaults per kind of show. Features are identical; only labels,
 * the default podcast category and suggested plan differ.
 */
export const SHOW_TYPES = {
  church: {
    label: 'Church or ministry',
    hint: 'Sermons, teachings and services',
    item: 'Sermon',
    items: 'Sermons',
    speaker: 'Preacher',
    speakerPlaceholder: 'e.g. Rev. Mensah',
    guests: '',
    series: 'Series',
    reference: 'Scripture',
    referencePlaceholder: 'e.g. Hebrews 11:1-6',
    numbered: false,
    keepMusicLabel: 'Keep worship songs',
    team: 'Media team',
    category: 'Religion & Spirituality',
    subcategory: 'Christianity',
    plan: 'church',
  },
  podcast: {
    label: 'Podcast show',
    hint: 'Talk shows, interviews, storytelling',
    item: 'Episode',
    items: 'Episodes',
    speaker: 'Host',
    speakerPlaceholder: 'e.g. Ama Serwaa',
    guests: 'Guests',
    series: '',
    reference: '',
    referencePlaceholder: '',
    numbered: true,
    keepMusicLabel: 'Keep intro and outro music',
    team: 'Co-hosts and editors',
    category: 'Society & Culture',
    subcategory: '',
    plan: 'podcast',
  },
  organization: {
    label: 'School or organisation',
    hint: 'Lectures, trainings, briefings',
    item: 'Episode',
    items: 'Episodes',
    speaker: 'Speaker',
    speakerPlaceholder: 'e.g. Dr. Owusu',
    guests: 'Guests',
    series: 'Series',
    reference: '',
    referencePlaceholder: '',
    numbered: true,
    keepMusicLabel: 'Keep music',
    team: 'Team',
    category: 'Education',
    subcategory: '',
    plan: 'podcast',
  },
};
export const SHOW_TYPE_IDS = Object.keys(SHOW_TYPES);
export const showType = (type) => SHOW_TYPES[type] || SHOW_TYPES.podcast;

/** Apple Podcasts categories (the list Spotify also follows). */
export const PODCAST_CATEGORIES = {
  Arts: ['Books', 'Design', 'Fashion & Beauty', 'Food', 'Performing Arts', 'Visual Arts'],
  Business: ['Careers', 'Entrepreneurship', 'Investing', 'Management', 'Marketing', 'Non-Profit'],
  Comedy: ['Comedy Interviews', 'Improv', 'Stand-Up'],
  Education: ['Courses', 'How To', 'Language Learning', 'Self-Improvement'],
  Fiction: ['Comedy Fiction', 'Drama', 'Science Fiction'],
  Government: [],
  History: [],
  'Health & Fitness': ['Alternative Health', 'Fitness', 'Medicine', 'Mental Health', 'Nutrition', 'Sexuality'],
  'Kids & Family': ['Education for Kids', 'Parenting', 'Pets & Animals', 'Stories for Kids'],
  Leisure: ['Animation & Manga', 'Automotive', 'Aviation', 'Crafts', 'Games', 'Hobbies', 'Home & Garden', 'Video Games'],
  Music: ['Music Commentary', 'Music History', 'Music Interviews'],
  News: ['Business News', 'Daily News', 'Entertainment News', 'News Commentary', 'Politics', 'Sports News', 'Tech News'],
  'Religion & Spirituality': ['Buddhism', 'Christianity', 'Hinduism', 'Islam', 'Judaism', 'Religion', 'Spirituality'],
  Science: ['Astronomy', 'Chemistry', 'Earth Sciences', 'Life Sciences', 'Mathematics', 'Natural Sciences', 'Nature', 'Physics', 'Social Sciences'],
  'Society & Culture': ['Documentary', 'Personal Journals', 'Philosophy', 'Places & Travel', 'Relationships'],
  Sports: ['Baseball', 'Basketball', 'Cricket', 'Fantasy Sports', 'Football', 'Golf', 'Hockey', 'Running', 'Soccer', 'Wilderness', 'Wrestling'],
  Technology: [],
  'True Crime': [],
  'TV & Film': ['After Shows', 'Film History', 'Film Interviews', 'Film Reviews', 'TV Reviews'],
};

/** Pay As You Go pricing: $1 buys 20 credits, minimum 20 credits. */
export const PAYG_CREDITS_PER_USD = 20;
export const PAYG_MIN_CREDITS = 20;
export const PAYG_MAX_CREDITS = 10000;

/** Credits added each time a subscription plan is paid. */
export const PLAN_CREDITS = { pro: 600, audio_master: 2000, podcast: 1500, church: 1500 };

// ─── Transcripts, translation and captions (Khaya AI) ────────────

/** Spoken languages offered for transcription (Khaya ASR v3 codes, ISO 639-3). Ghana first. */
export const TRANSCRIBE_LANGUAGES = [
  { code: 'eng', name: 'English' },
  { code: 'twi', name: 'Twi (Asante)' },
  { code: 'atw', name: 'Twi (Akuapem)' },
  { code: 'fat', name: 'Fante' },
  { code: 'gaa', name: 'Ga' },
  { code: 'ewe', name: 'Ewe' },
  { code: 'dag', name: 'Dagbani' },
  { code: 'hau', name: 'Hausa' },
  { code: 'nzi', name: 'Nzema' },
  { code: 'ada', name: 'Dangme' },
  { code: 'gur', name: 'Gurene' },
  { code: 'kus', name: 'Kusaal' },
  { code: 'dga', name: 'Dagaare' },
  { code: 'gjn', name: 'Gonja' },
  { code: 'pcm', name: 'Pidgin' },
  { code: 'yor', name: 'Yoruba' },
  { code: 'fra', name: 'French' },
];

/** Languages Khaya can translate to and from English. */
export const TRANSLATE_LANGUAGES = ['eng', 'twi', 'fat', 'gaa', 'ewe', 'dag', 'gur', 'kus', 'yor'];

export const TRANSCRIBE_CREDITS_PER_MIN = 2;
export const TRANSLATE_CREDITS_PER_MIN = 1;
export const CAPTION_CREDITS_PER_MIN = 2;
/** Burning captions re-encodes the video on our server, so keep it to social-length videos. */
export const CAPTION_MAX_MINUTES = 20;

export const CAPTION_STYLES = {
  classic: { name: 'Classic', hint: 'White text, dark outline' },
  boxed: { name: 'Boxed', hint: 'White on a dark box' },
  social: { name: 'Social', hint: 'Big yellow text for TikTok and Reels' },
};
export const CAPTION_POSITIONS = ['bottom', 'middle', 'top'];
export const CAPTION_SIZES = ['small', 'medium', 'large'];

export function languageName(code) {
  return TRANSCRIBE_LANGUAGES.find((l) => l.code === code)?.name || code;
}

/**
 * Translation pairs go through English: eng→X or X→eng. Returns null when unsupported.
 * @param {string} from
 * @param {string} to
 */
export function translationPair(from, to) {
  if (!from || !to || from === to) return null;
  // Akuapem Twi transcripts translate with the Twi model.
  const src = from === 'atw' ? 'twi' : from;
  if (!TRANSLATE_LANGUAGES.includes(src) || !TRANSLATE_LANGUAGES.includes(to)) return null;
  if (src !== 'eng' && to !== 'eng') return null;
  return `${src}-${to}`;
}

export function estimateTranscriptCredits(durationSeconds, translate) {
  const minutes = Math.max(1, Math.ceil((durationSeconds || 60) / 60));
  return minutes * (TRANSCRIBE_CREDITS_PER_MIN + (translate ? TRANSLATE_CREDITS_PER_MIN : 0));
}

export function estimateCaptionCredits(durationSeconds) {
  return Math.max(1, Math.ceil((durationSeconds || 60) / 60)) * CAPTION_CREDITS_PER_MIN;
}


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
/**
 * Team top-up: extra credits for a podcast or church team's shared pool, bought in packs by
 * anyone on the team while the plan is active. 2.9¢ a credit, slightly above the plan's 2.3¢,
 * so the monthly plan stays the better deal.
 */
export const TEAM_TOPUP_PACK_CREDITS = 350;
export const TEAM_TOPUP_PACK_USD = 10;
export const TEAM_TOPUP_MAX_PACKS = 10;
export const teamTopupPriceUsd = (credits) => (credits / TEAM_TOPUP_PACK_CREDITS) * TEAM_TOPUP_PACK_USD;

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

/** Settings used for every episode or sermon: podcast loudness, MP3, music protected, notes on. */
export const EPISODE_FEATURE = 'voice_clarity';
export const EPISODE_OPTIONS = {
  exportFormat: 'mp3',
  loudness: 'podcast',
  keepMusic: true,
  aiNotes: true,
  returnVideo: false,
  custom: DEFAULT_CUSTOM,
};

// ─── Meetings ────────────────────────────────────────────────────

/** Longest meeting recording each plan can transcribe, in minutes. */
// ─── Storage: nothing is kept for long except published episodes ─────────

/**
 * Working files (uploads, cleaned results, Recorder saves, caption videos, meeting audio)
 * are deleted automatically this many days after they are finished. No backups.
 */
export const WORKING_FILE_DAYS = { free: 7, paid: 30 };
export const workingFileDays = (plan) => (!plan || plan === 'free' ? WORKING_FILE_DAYS.free : WORKING_FILE_DAYS.paid);

/** Uploads that are never cleaned or published, and failed uploads, go after this many days. */
export const UNUSED_UPLOAD_DAYS = 3;

/**
 * Working space: hours of audio an account can hold at once in uploads and cleaned files
 * (published episodes do not count). Stops unused uploads piling up, since they cost no credits.
 */
export const WORKING_SPACE_HOURS = { free: 2, paid: 10, team: 20 };

/** The uncleaned original is kept this long after cleaning, for the before/after comparison. */
export const ORIGINAL_KEEP_HOURS = 24;

/**
 * Published podcast episodes are the only files kept long-term: re-encoded to mono MP3 at
 * HOSTED_KBPS (about 29 MB per hour) and capped per plan in hours online.
 */
export const HOSTED_KBPS = 64;
export const HOSTING_HOURS = { podcast: 150, church: 150 };
export const hostingHours = (plan) => HOSTING_HOURS[plan] || 0;

/** Extra podcast space: blocks of 250 hours for $3 each, for 30 days (renewable). */
export const HOSTING_ADDON_HOURS = 250;
export const HOSTING_ADDON_USD = 3;
export const HOSTING_ADDON_DAYS = 30;
export const HOSTING_ADDON_MAX_BLOCKS = 4;

/** Extra hours a show has right now (0 once the add-on has run out). */
export function hostingAddonHours(show, now = Date.now()) {
  const a = show?.hostingAddon;
  const until = a?.until?.toMillis ? a.until.toMillis() : a?.until ? new Date(a.until).getTime() : 0;
  return a && until > now ? (Number(a.blocks) || 0) * HOSTING_ADDON_HOURS : 0;
}

/** Hours of published audio this show may have online: plan allowance plus any add-on. */
export const showHostingHours = (show, now = Date.now()) => (isShowPlan(show?.plan) ? hostingHours(show.plan) + hostingAddonHours(show, now) : 0);

export const MEETING_MAX_MINUTES = { free: 60, payg: 180, pro: 240, audio_master: 480, podcast: 240, church: 240 };
/** Largest meeting file accepted (audio or video). */
export const MEETING_MAX_BYTES = 3 * 1024 * 1024 * 1024;
/** Meeting minutes (summary, decisions, action items), per started hour of recording. */
export const MINUTES_CREDITS_PER_HOUR = 10;

export function meetingMaxMinutes(plan) {
  return MEETING_MAX_MINUTES[plan] ?? MEETING_MAX_MINUTES.free;
}

/**
 * @param {number} durationSeconds
 * @param {{ translate?: boolean, minutes?: boolean }} opts
 */
export function estimateMeetingCredits(durationSeconds, opts = {}) {
  const hours = Math.max(1, Math.ceil((durationSeconds || 60) / 3600));
  return estimateTranscriptCredits(durationSeconds, Boolean(opts.translate)) + (opts.minutes ? hours * MINUTES_CREDITS_PER_HOUR : 0);
}

// ─── Recorder ────────────────────────────────────────────────────

/** Recordings a free user can keep in their cloud library (download and share are unlimited). */
export const FREE_RECORDING_LIMIT = 10;
