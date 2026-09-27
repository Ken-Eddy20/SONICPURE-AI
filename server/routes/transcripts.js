/**
 * Local-language transcripts (Khaya ASR) with optional translation.
 * Jobs run in the background on this server; the client polls GET /:id.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { HttpError, route, verifyAuth, diskLog, formatError, iso } from '../lib/http.js';
import { assertFileInOpenAccount, chargeAndCreate, getAccessibleFile, refundJob } from '../lib/accounts.js';
import { transcribeChunk, translateText, mapLimit, khayaConfigured } from '../lib/khaya.js';
import { makeWorkDir, cleanupDir, downloadTo, speechChunks } from '../lib/media.js';
import {
  TRANSCRIBE_LANGUAGES,
  estimateTranscriptCredits,
  translationPair,
} from '../../shared/processing.js';

const CHUNK_SECONDS = 300;
const transcripts = () => adminDb.collection('transcripts');

/**
 * The audio a transcript is made from. For videos we keep the timeline of the video
 * we will caption (the cleaned video if one was returned, otherwise the original).
 */
export function timelineSource(file) {
  if (file.sourceType === 'video') {
    return file.processedIsVideo && file.processedFileUrl
      ? { url: file.processedFileUrl, timeline: 'processed' }
      : { url: file.extractedAudioUrl || file.originalFileUrl, timeline: 'original' };
  }
  return file.processedFileUrl
    ? { url: file.processedFileUrl, timeline: 'processed' }
    : { url: file.originalFileUrl, timeline: 'original' };
}

export function serializeTranscript(id, t, full = true) {
  const base = {
    id,
    fileId: t.fileId,
    language: t.language,
    translateTo: t.translateTo || null,
    status: t.status,
    stage: t.stage || null,
    percent: t.percent ?? null,
    timeline: t.timeline,
    creditsUsed: t.creditsUsed || 0,
    error: t.error || null,
    createdAt: iso(t.createdAt),
  };
  if (!full) return base;
  return { ...base, segments: t.segments || [], translation: t.translation || null };
}

async function runTranscript(ref) {
  const job = (await ref.get()).data();
  const file = (await adminDb.collection('audioFiles').doc(job.fileId).get()).data();
  const dir = makeWorkDir('asr');
  const update = (fields) => ref.update(fields).catch(() => {});
  try {
    await update({ status: 'processing', stage: 'Preparing audio', percent: 3 });
    const source = timelineSource(file);
    const input = await downloadTo(source.url, path.join(dir, 'source' + (path.extname(new URL(source.url).pathname) || '.mp3')));
    const chunks = await speechChunks(input, dir, CHUNK_SECONDS);
    if (!chunks.length) throw new Error('No audio found in this file.');

    let done = 0;
    const perChunk = await mapLimit(chunks, 2, async (chunk) => {
      const segs = await transcribeChunk(fs.readFileSync(chunk.path), job.language, CHUNK_SECONDS);
      done++;
      await update({ stage: `Transcribing (${done} of ${chunks.length})`, percent: 5 + Math.round((done / chunks.length) * (job.translateTo ? 60 : 90)) });
      return segs.map((s) => ({
        start: +(chunk.start + s.start).toFixed(2),
        end: +(chunk.start + Math.max(s.end, s.start + 0.5)).toFixed(2),
        text: s.text,
      }));
    });
    const segments = perChunk.flat();
    if (!segments.length) throw new Error('No speech was recognised. Check that the language matches the recording.');

    let translation = null;
    if (job.translateTo) {
      const pair = translationPair(job.language, job.translateTo);
      let translated = 0;
      const texts = await mapLimit(segments, 4, async (s) => {
        const t = await translateText(s.text, pair);
        translated++;
        if (translated % 10 === 0 || translated === segments.length) {
          await update({ stage: `Translating (${translated} of ${segments.length})`, percent: 65 + Math.round((translated / segments.length) * 30) });
        }
        return t;
      });
      translation = {
        language: job.translateTo,
        segments: segments.map((s, i) => ({ start: s.start, end: s.end, text: texts[i] || '' })),
      };
    }

    await ref.update({
      status: 'done',
      stage: 'Done',
      percent: 100,
      segments,
      translation,
      timeline: source.timeline,
      completedAt: new Date(),
    });
    diskLog(`[Transcript] ${ref.id} done: ${segments.length} segments (${job.language}${job.translateTo ? ` -> ${job.translateTo}` : ''})`);
  } catch (err) {
    diskLog(`[Transcript] ${ref.id} failed: ${formatError(err)}`);
    await refundJob(ref, formatError(err));
  } finally {
    cleanupDir(dir);
  }
}

export default function transcriptsRouter({ limiter }) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({ enabled: khayaConfigured() });
  });

  router.post('/', limiter, route('Could not start transcript', async (req, res) => {
    const { uid } = await verifyAuth(req);
    if (!khayaConfigured()) throw new HttpError(503, 'Local-language transcripts are not switched on yet. Add KHAYA_API_KEY on the server.');
    const { fileId, language, translateTo } = req.body || {};
    if (!TRANSCRIBE_LANGUAGES.some((l) => l.code === language)) throw new HttpError(400, 'Choose a supported language.');
    if (translateTo && !translationPair(language, translateTo)) {
      throw new HttpError(400, 'That translation is not available. Translate to or from English.');
    }
    const { data: file } = await getAccessibleFile(fileId, uid);
    await assertFileInOpenAccount(file, uid);
    if (['uploading', 'uploaded', 'processing', 'finalizing'].includes(file.status)) {
      throw new HttpError(409, 'Wait for this file to finish cleaning first.');
    }

    const cost = estimateTranscriptCredits(file.durationSeconds, Boolean(translateTo));
    const ref = transcripts().doc();
    await chargeAndCreate(uid, cost, ref, {
      userId: uid,
      fileId,
      language,
      translateTo: translateTo || null,
      status: 'queued',
      stage: 'Queued',
      percent: 1,
      timeline: timelineSource(file).timeline,
      durationSeconds: file.durationSeconds || 0,
      createdAt: new Date(),
    });
    runTranscript(ref);
    res.status(202).json({ id: ref.id, creditsUsed: cost });
  }));

  router.get('/', route('Could not load transcripts', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { fileId } = req.query;
    if (!fileId) throw new HttpError(400, 'fileId is required');
    await getAccessibleFile(String(fileId), uid);
    const snap = await transcripts().where('fileId', '==', String(fileId)).get();
    const items = snap.docs
      .map((d) => serializeTranscript(d.id, d.data(), false))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ transcripts: items });
  }));

  router.get('/:id', route('Could not load transcript', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const snap = await transcripts().doc(req.params.id).get();
    if (!snap.exists) throw new HttpError(404, 'Transcript not found');
    await getAccessibleFile(snap.data().fileId, uid);
    res.json(serializeTranscript(snap.id, snap.data()));
  }));

  return router;
}
