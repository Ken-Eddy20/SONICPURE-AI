import { Cleanvoice } from '@cleanvoice/cleanvoice-sdk';

let client = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.CLEANVOICE_API_KEY;
  if (!apiKey) throw new Error('CLEANVOICE_API_KEY not set in server/.env');
  client = new Cleanvoice({ apiKey });
  return client;
}

/**
 * Submit a job to Cleanvoice and return its edit id immediately.
 * The SDK detects video from the URL extension and returns a video when it sees one.
 * @param {string} fileUrl Public URL (Cloudinary secure_url)
 * @param {Record<string, unknown>} config Cleanvoice ProcessingConfig
 */
export async function startCleanvoiceJob(fileUrl, config) {
  console.log('Cleanvoice createEdit:', JSON.stringify(config));
  return getClient().createEdit(fileUrl, config);
}

const STAGE_LABELS = {
  PENDING: 'Queued',
  QUEUED: 'Queued',
  RETRY: 'Queued',
  STARTED: 'Starting up',
  PREPROCESSING: 'Analyzing your audio',
  CLASSIFICATION: 'Detecting noise and filler words',
  EDITING: 'Cleaning and editing',
  PROCESSING: 'Cleaning and editing',
  POSTPROCESSING: 'Mastering and leveling',
  EXPORT: 'Exporting your file',
  SUCCESS: 'Finishing up',
};

// Rough position of each stage in the pipeline, used when Cleanvoice gives no done/total.
const STAGE_FLOOR = {
  PENDING: 3, QUEUED: 3, RETRY: 3, STARTED: 8, PREPROCESSING: 15, CLASSIFICATION: 30,
  EDITING: 50, PROCESSING: 50, POSTPROCESSING: 75, EXPORT: 90, SUCCESS: 98,
};

/**
 * Poll Cleanvoice once and normalise the answer.
 * @param {string} editId
 * @returns {Promise<
 *   | { state: 'running', stage: string, percent: number }
 *   | { state: 'failed', message: string }
 *   | { state: 'done', result: any }
 * >}
 */
export async function checkCleanvoiceJob(editId) {
  const res = await getClient().getEdit(editId);
  const status = res.status;

  if (status === 'FAILURE') {
    const detail = res.result && typeof res.result === 'object'
      ? res.result.error || res.result.message || res.result.exc_message
      : null;
    return { state: 'failed', message: detail ? String(detail) : 'Cleanvoice could not process this file.' };
  }

  const result = res.result;
  if (status === 'SUCCESS' && result && typeof result === 'object' && 'download_url' in result) {
    return { state: 'done', result };
  }

  let percent = STAGE_FLOOR[status] ?? 5;
  if (result && typeof result === 'object' && 'done' in result && 'total' in result && result.total > 0) {
    percent = Math.max(percent, Math.round((result.done / result.total) * 95));
  }
  return { state: 'running', stage: STAGE_LABELS[status] || 'Processing', percent: Math.min(percent, 97) };
}

const MAX_TRANSCRIPT_CHARS = 250_000;

/**
 * Pull the parts of a Cleanvoice result worth keeping in Firestore (doc limit is 1 MB).
 * @param {any} result Cleanvoice EditResult
 */
export function extractInsights(result) {
  const stats = result.statistics || {};
  const statistics = {
    fillers: stats.FILLER_SOUND || 0,
    stutters: stats.STUTTERING || 0,
    mouthSounds: stats.MOUTH_SOUND || 0,
    breaths: stats.BREATH || 0,
    deadAir: stats.DEADAIR || 0,
  };

  let transcript = null;
  const t = result.transcription;
  if (t && !Array.isArray(t) && Array.isArray(t.paragraphs)) {
    let used = 0;
    const paragraphs = [];
    for (const p of t.paragraphs) {
      const text = String(p.text || '');
      if (used + text.length > MAX_TRANSCRIPT_CHARS) break;
      used += text.length;
      paragraphs.push({ start: p.start ?? 0, end: p.end ?? 0, text });
    }
    transcript = { paragraphs, truncated: paragraphs.length < t.paragraphs.length };
  }

  let summary = null;
  const s = result.summarization;
  if (s && !Array.isArray(s)) {
    summary = {
      title: s.title || '',
      summary: s.summary || '',
      episodeDescription: s.episode_description || '',
      keyLearnings: s.key_learnings || '',
      chapters: Array.isArray(s.chapters) ? s.chapters.map((c) => ({ start: c.start ?? 0, title: c.title || '' })) : [],
    };
  }

  let social = null;
  const sc = result.social_content;
  if (sc && !Array.isArray(sc)) {
    social = {
      twitterThread: sc.twitter_thread || '',
      linkedin: sc.linkedin || '',
      newsletter: sc.newsletter || '',
    };
  }

  return { statistics, transcript, summary, social, isVideo: Boolean(result.video) };
}
