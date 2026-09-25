/**
 * Khaya AI (GhanaNLP) client: speech-to-text in Ghanaian and African languages
 * and translation to/from English. https://translation.ghananlp.org
 *
 * ASR v3:  POST {base}/asr/v3/transcribe?language=twi&timestamps=segment  (raw audio body)
 * Translate v2: POST {base}/v2/translate  {"in": "...", "lang": "twi-eng"}  (max 1000 chars)
 */

const BASE_URL = process.env.KHAYA_BASE_URL || 'https://translation-api.ghananlp.org';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_TRANSLATE_CHARS = 1000;

export class KhayaError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function khayaConfigured() {
  return Boolean(process.env.KHAYA_API_KEY);
}

function apiKey() {
  const key = process.env.KHAYA_API_KEY;
  if (!key) throw new KhayaError('KHAYA_API_KEY is not set on the server. Add it to .env to enable transcripts.', 503, 'NO_KEY');
  return key;
}

async function parseError(res) {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text);
    const err = body.error || body;
    const detail = Array.isArray(err.details) && err.details[0];
    return new KhayaError(
      (detail && detail.message) || err.message || `Khaya API error ${res.status}`,
      res.status,
      (detail && detail.code) || err.code,
    );
  } catch {
    return new KhayaError(`Khaya API error ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`, res.status);
  }
}

async function khayaFetch(url, init, attempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'Ocp-Apim-Subscription-Key': apiKey(), 'Cache-Control': 'no-cache', ...init.headers },
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    } catch (err) {
      if (err instanceof KhayaError) throw err;
      lastErr = new KhayaError(`Could not reach Khaya AI: ${err.message}`, 0);
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.ok) return res;
    lastErr = await parseError(res);
    if (!RETRYABLE.has(res.status)) throw lastErr;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2 ** attempt * 1000);
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcribe one audio chunk. Returns segments with times relative to the chunk.
 * Falls back to a single untimed segment when the language has no timestamp support.
 * @param {Buffer} audio MP3 bytes
 * @param {string} language Khaya ASR code, e.g. "twi"
 * @param {number} chunkSeconds Length of the chunk, used for the fallback segment
 */
export async function transcribeChunk(audio, language, chunkSeconds) {
  const call = async (withTimestamps) => {
    const params = new URLSearchParams({ language });
    if (withTimestamps) params.set('timestamps', 'segment');
    const res = await khayaFetch(`${BASE_URL}/asr/v3/transcribe?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: audio,
    });
    const body = await res.json();
    return typeof body === 'string' ? { text: body } : body;
  };

  let body;
  try {
    body = await call(true);
  } catch (err) {
    if (err.code !== 'UNSUPPORTED_TIMESTAMPS') throw err;
    body = await call(false);
  }

  const segments = (body.timings?.segments || [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
    .filter((s) => s.text);
  if (segments.length) return segments;
  const text = String(body.text || '').trim();
  return text ? [{ start: 0, end: chunkSeconds, text }] : [];
}

function splitForTranslation(text) {
  if (text.length <= MAX_TRANSLATE_CHARS) return [text];
  const parts = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if ((current + ' ' + sentence).trim().length > MAX_TRANSLATE_CHARS) {
      if (current) parts.push(current);
      current = sentence.slice(0, MAX_TRANSLATE_CHARS);
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Translate text with a Khaya language pair such as "twi-eng".
 * @param {string} text
 * @param {string} pair
 */
export async function translateText(text, pair) {
  if (!text.trim()) return '';
  const out = [];
  for (const part of splitForTranslation(text)) {
    const res = await khayaFetch(`${BASE_URL}/v2/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ in: part, lang: pair }),
    });
    const body = await res.json();
    out.push(typeof body === 'string' ? body : String(body.translation || body.text || ''));
  }
  return out.join(' ').trim();
}

/** Run `fn` over items with limited concurrency, preserving order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
