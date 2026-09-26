/**
 * Meetings: long recordings (hours of audio or video) turned into a transcript,
 * optional English translation and AI minutes.
 *
 * Upload is chunked straight to this server's disk (8 MB pieces, retried individually),
 * so multi-GB videos never sit in memory. Only a compact speech-only MP3 is kept.
 */
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { cloudinary, deleteAudio } from '../../lib/cloudinary.js';
import { HttpError, route, verifyAuth, diskLog, formatError, iso } from '../lib/http.js';
import { billingRefFor, chargeExisting, refundJob, resolveAccount } from '../lib/accounts.js';
import { startCleanvoiceJob, checkCleanvoiceJob, speakerSegments } from '../lib/cleanvoice.js';
import { transcribeChunk, translateText, mapLimit, khayaConfigured } from '../lib/khaya.js';
import { generateMinutes, minutesConfigured } from '../lib/claude.js';
import { probe, extractSpeechAudio, speechChunks, cleanupDir } from '../lib/media.js';
import { deleteAtFor } from '../lib/retention.js';
import {
  TRANSCRIBE_LANGUAGES,
  MEETING_MAX_BYTES,
  MINUTES_CREDITS_PER_HOUR,
  estimateMeetingCredits,
  meetingMaxMinutes,
  translationPair,
  languageName,
} from '../../shared/processing.js';

export const CHUNK_SIZE = 8 * 1024 * 1024;
const PART_SIZE = 400;
const CHUNK_SECONDS = 300;
const CLEANVOICE_POLL_MS = 15000;
const CLEANVOICE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const UPLOAD_ROOT = path.join(os.tmpdir(), 'sonicpure_meetings');

const meetings = () => adminDb.collection('meetings');
const workDir = (id) => path.join(UPLOAD_ROOT, id);
const sourcePath = (id, ext) => path.join(workDir(id), `source${ext}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanvoiceReady = () => Boolean(process.env.CLEANVOICE_API_KEY);
/** English uses Cleanvoice (speaker labels) when available, otherwise Khaya's African English model. */
const engineFor = (language) => (language === 'eng' && cleanvoiceReady() ? 'cleanvoice' : 'khaya');

// Chunks received per upload. Also mirrored to disk so a retry after a hiccup is idempotent.
const received = new Map();

function receivedSet(id) {
  if (!received.has(id)) {
    const file = path.join(workDir(id), 'received.json');
    received.set(id, new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []));
  }
  return received.get(id);
}

function languageSupported(code) {
  return TRANSCRIBE_LANGUAGES.some((l) => l.code === code);
}

function ownMeeting(snap, uid) {
  if (!snap.exists) throw new HttpError(404, 'Meeting not found');
  const m = snap.data();
  if (m.userId !== uid) throw new HttpError(403, 'Not authorized');
  return m;
}

function serializeMeeting(id, m) {
  return {
    id,
    title: m.title,
    date: m.date || '',
    language: m.language,
    translate: Boolean(m.translate),
    wantMinutes: Boolean(m.wantMinutes),
    engine: m.engine,
    status: m.status,
    stage: m.stage || null,
    percent: m.percent ?? null,
    fileName: m.fileName,
    fileSize: m.fileSize || 0,
    sourceType: m.sourceType,
    durationSeconds: m.durationSeconds || 0,
    audioUrl: m.audioUrl || null,
    speakerNames: m.speakerNames || {},
    minutes: m.minutes || null,
    minutesError: m.minutesError || null,
    creditsUsed: m.creditsUsed || 0,
    error: m.error || null,
    createdAt: iso(m.createdAt),
    completedAt: iso(m.completedAt),
  };
}

async function saveParts(ref, kind, segments) {
  const old = await ref.collection('parts').where('kind', '==', kind).get();
  const batch = adminDb.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  for (let i = 0; i * PART_SIZE < segments.length; i++) {
    batch.set(ref.collection('parts').doc(`${kind}_${String(i).padStart(4, '0')}`), {
      kind,
      index: i,
      segments: segments.slice(i * PART_SIZE, (i + 1) * PART_SIZE),
    });
  }
  await batch.commit();
}

async function loadParts(ref) {
  const snap = await ref.collection('parts').get();
  const out = { original: [], translation: [] };
  snap.docs
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((d) => out[d.data().kind]?.push(...d.data().segments));
  return out;
}

function applySpeakerNames(segments, names) {
  if (!names || !Object.keys(names).length) return segments;
  return segments.map((s) => (s.speaker && names[s.speaker] ? { ...s, speaker: names[s.speaker] } : s));
}

async function uploadMeetingAudio(filePath, userId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(
      filePath,
      { resource_type: 'video', folder: `sonicpure/users/${userId}/meetings`, chunk_size: 20 * 1024 * 1024 },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error('Cloudinary did not return a URL for the meeting audio.'));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );
  });
}

// ─── Background pipeline ─────────────────────────────────────────

async function processMeeting(ref) {
  const id = ref.id;
  const update = (fields) => ref.update(fields).catch(() => {});
  let meeting = (await ref.get()).data();
  const dir = workDir(id);
  try {
    await update({ status: 'processing', stage: 'Checking the recording', percent: 2 });
    const source = sourcePath(id, meeting.ext);
    const info = await probe(source);
    if (!info.duration) throw new Error('Could not read this recording. Try exporting it as MP4, MP3 or M4A.');

    const translate = Boolean(meeting.translate);
    const cost = estimateMeetingCredits(info.duration, { translate, minutes: meeting.wantMinutes });
    await chargeExisting(
      meeting.userId,
      cost,
      ref,
      { durationSeconds: info.duration, stage: 'Extracting the speech', percent: 5 },
      (account) => {
        const max = meetingMaxMinutes(account.plan);
        if (info.duration / 60 > max) {
          throw new HttpError(400, `This recording is ${Math.ceil(info.duration / 60)} min. Your plan allows meetings up to ${max} min.`);
        }
      },
    );

    let lastReport = 0;
    const speech = await extractSpeechAudio(source, dir, (t) => {
      if (Date.now() - lastReport > 5000) {
        lastReport = Date.now();
        update({ percent: 5 + Math.round((t / info.duration) * 12) });
      }
    });
    fs.rmSync(source, { force: true });

    await update({ stage: 'Saving the audio', percent: 18 });
    const saved = await uploadMeetingAudio(speech, meeting.userId);
    await update({ audioUrl: saved.secure_url, audioPublicId: saved.public_id, stage: 'Transcribing', percent: 22 });

    // ── Transcribe ──
    let segments;
    let engine = meeting.engine;
    let editId = null;
    if (engine === 'cleanvoice') {
      try {
        editId = await startCleanvoiceJob(saved.secure_url, {
          transcription: true,
          remove_noise: false,
          normalize: false,
          export_format: 'mp3',
        });
      } catch (err) {
        if (!String(err.code || '').startsWith('CLEANVOICE_') || !khayaConfigured()) throw err;
        diskLog(`[Meeting] ${id}: Cleanvoice unavailable (${err.code}), using Khaya English instead`);
        engine = 'khaya';
        await update({ engine });
      }
    }
    if (engine === 'cleanvoice') {
      await update({ editId, stage: 'Transcribing and identifying speakers' });
      const started = Date.now();
      for (;;) {
        await sleep(CLEANVOICE_POLL_MS);
        const check = await checkCleanvoiceJob(editId);
        if (check.state === 'failed') throw new Error(check.message);
        if (check.state === 'done') {
          segments = speakerSegments(check.result);
          break;
        }
        await update({ percent: 22 + Math.round((check.percent / 100) * 50) });
        if (Date.now() - started > CLEANVOICE_TIMEOUT_MS) throw new Error('Transcription took too long. Please try again.');
      }
    } else {
      const chunks = await speechChunks(speech, dir, CHUNK_SECONDS);
      let done = 0;
      const perChunk = await mapLimit(chunks, 2, async (chunk) => {
        const segs = await transcribeChunk(fs.readFileSync(chunk.path), meeting.language, CHUNK_SECONDS);
        done++;
        await update({ stage: `Transcribing (${done} of ${chunks.length})`, percent: 22 + Math.round((done / chunks.length) * 50) });
        return segs.map((s) => ({
          start: +(chunk.start + s.start).toFixed(2),
          end: +(chunk.start + Math.max(s.end, s.start + 0.5)).toFixed(2),
          text: s.text,
        }));
      });
      segments = perChunk.flat();
    }
    if (!segments?.length) throw new Error('No speech was recognised. Check that the language matches the recording.');
    await saveParts(ref, 'original', segments);

    // ── Translate to English ──
    let english = meeting.language === 'eng' ? segments : null;
    if (translate) {
      const pair = translationPair(meeting.language, 'eng');
      let n = 0;
      const texts = await mapLimit(segments, 4, async (s) => {
        const t = await translateText(s.text, pair);
        n++;
        if (n % 20 === 0 || n === segments.length) {
          await update({ stage: `Translating to English (${n} of ${segments.length})`, percent: 72 + Math.round((n / segments.length) * 15) });
        }
        return t;
      });
      english = segments.map((s, i) => ({ start: s.start, end: s.end, text: texts[i] || '', ...(s.speaker ? { speaker: s.speaker } : {}) }));
      await saveParts(ref, 'translation', english);
    }

    // ── Minutes ──
    let minutes = null;
    let minutesError = null;
    if (meeting.wantMinutes && english) {
      await update({ stage: 'Writing the minutes', percent: 90 });
      try {
        minutes = await generateMinutes(english, {
          title: meeting.title,
          date: meeting.date,
          language: meeting.language,
          note: meeting.language !== 'eng' ? `The meeting was held in ${languageName(meeting.language)}; this is a machine translation.` : '',
        });
      } catch (err) {
        // The transcript is still worth delivering; refund just the minutes part.
        minutesError = formatError(err);
        const hours = Math.max(1, Math.ceil(info.duration / 3600));
        await refundPart(ref, hours * MINUTES_CREDITS_PER_HOUR);
      }
    }

    await ref.update({
      status: 'done',
      stage: 'Done',
      percent: 100,
      segmentCount: segments.length,
      minutes,
      minutesError,
      completedAt: new Date(),
      // The audio goes after the plan window; the transcript and minutes stay.
      audioDeleteAt: await deleteAtFor(meeting.userId),
    });
    diskLog(`[Meeting] ${id} done: ${segments.length} segments, ${Math.round(info.duration / 60)} min`);
  } catch (err) {
    diskLog(`[Meeting] ${id} failed: ${formatError(err)}`);
    await refundJob(ref, err instanceof HttpError ? err.message : formatError(err));
  } finally {
    received.delete(id);
    cleanupDir(dir);
  }
}

/** Refund part of a meeting's charge (e.g. minutes failed but the transcript succeeded). */
async function refundPart(ref, credits) {
  await adminDb.runTransaction(async (tx) => {
    const m = (await tx.get(ref)).data();
    if (!m?.billedTo || !credits) return;
    tx.update(billingRefFor(m.billedTo), { credits: FieldValue.increment(credits), creditsUsedThisMonth: FieldValue.increment(-credits) });
    tx.update(ref, { creditsUsed: Math.max(0, (m.creditsUsed || 0) - credits) });
  });
}

// ─── Routes ──────────────────────────────────────────────────────

export default function meetingsRouter({ limiter }) {
  const router = express.Router();

  router.get('/config', route('Could not load settings', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const account = await resolveAccount(uid);
    res.json({
      englishSpeakers: cleanvoiceReady(),
      localLanguages: khayaConfigured(),
      minutes: minutesConfigured(),
      maxMinutes: meetingMaxMinutes(account.plan),
      maxBytes: MEETING_MAX_BYTES,
      chunkSize: CHUNK_SIZE,
    });
  }));

  router.get('/', route('Could not load meetings', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const snap = await meetings().where('userId', '==', uid).get();
    const list = snap.docs
      .map((d) => serializeMeeting(d.id, d.data()))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ meetings: list });
  }));

  router.post('/', limiter, route('Could not start the upload', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 150);
    if (!title) throw new HttpError(400, 'Give the meeting a title.');
    if (!languageSupported(b.language)) throw new HttpError(400, 'Choose the language spoken in the meeting.');
    const size = Number(b.fileSize);
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Choose a recording to upload.');
    if (size > MEETING_MAX_BYTES) throw new HttpError(400, 'This file is larger than 3 GB. Export the recording at a lower quality, or as audio only.');
    const mime = String(b.mimeType || '');
    const ext = (path.extname(String(b.fileName || '')).toLowerCase() || '.bin').replace(/[^.a-z0-9]/g, '').slice(0, 6);
    if (!/^(audio|video)\//.test(mime) && !['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext)) {
      throw new HttpError(400, 'Upload an audio or video recording.');
    }

    const engine = engineFor(b.language);
    if (engine === 'khaya' && !khayaConfigured()) {
      throw new HttpError(503, `${languageName(b.language)} transcription is not switched on yet on this server.`);
    }
    const wantMinutes = Boolean(b.minutes) && minutesConfigured();
    // Minutes are written from English, so non-English meetings with minutes are translated too.
    const translate = b.language !== 'eng' && (Boolean(b.translate) || wantMinutes) && Boolean(translationPair(b.language, 'eng'));
    if (wantMinutes && b.language !== 'eng' && !translate) {
      throw new HttpError(400, `Minutes need an English translation, which is not available for ${languageName(b.language)} yet.`);
    }

    const account = await resolveAccount(uid);
    const ref = meetings().doc();
    await ref.set({
      userId: uid,
      showId: account.showId || null,
      title,
      date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10),
      language: b.language,
      translate,
      wantMinutes,
      engine,
      status: 'uploading',
      stage: 'Uploading',
      percent: 0,
      fileName: String(b.fileName || 'recording').slice(0, 200),
      fileSize: size,
      ext,
      sourceType: mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext) ? 'video' : 'audio',
      totalChunks: Math.ceil(size / CHUNK_SIZE),
      speakerNames: {},
      creditsUsed: 0,
      createdAt: new Date(),
    });
    fs.mkdirSync(workDir(ref.id), { recursive: true });
    fs.writeFileSync(sourcePath(ref.id, ext), '');
    received.set(ref.id, new Set());
    res.status(201).json({ id: ref.id, chunkSize: CHUNK_SIZE, totalChunks: Math.ceil(size / CHUNK_SIZE) });
  }));

  router.put('/:id/chunks/:index', express.raw({ type: () => true, limit: CHUNK_SIZE + 1024 }), route('Upload failed', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = meetings().doc(req.params.id);
    const m = ownMeeting(await ref.get(), uid);
    if (m.status !== 'uploading') throw new HttpError(409, 'This upload is already finished.');
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= m.totalChunks) throw new HttpError(400, 'Invalid chunk');
    const expected = index === m.totalChunks - 1 ? m.fileSize - index * CHUNK_SIZE : CHUNK_SIZE;
    if (!Buffer.isBuffer(req.body) || req.body.length !== expected) throw new HttpError(400, 'Chunk size mismatch');
    const file = sourcePath(ref.id, m.ext);
    if (!fs.existsSync(file)) throw new HttpError(410, 'This upload expired. Please start again.');

    const handle = await fs.promises.open(file, 'r+');
    try {
      await handle.write(req.body, 0, req.body.length, index * CHUNK_SIZE);
    } finally {
      await handle.close();
    }
    const set = receivedSet(ref.id);
    set.add(index);
    fs.writeFileSync(path.join(workDir(ref.id), 'received.json'), JSON.stringify([...set]));
    res.json({ received: set.size, total: m.totalChunks });
  }));

  router.post('/:id/complete', limiter, route('Could not finish the upload', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = meetings().doc(req.params.id);
    const m = ownMeeting(await ref.get(), uid);
    if (m.status !== 'uploading') throw new HttpError(409, 'This meeting is already processing.');
    const set = receivedSet(ref.id);
    const missing = [];
    for (let i = 0; i < m.totalChunks; i++) if (!set.has(i)) missing.push(i);
    if (missing.length) throw new HttpError(409, `Upload incomplete: ${missing.length} parts missing.`, { missing: missing.slice(0, 50) });
    const size = fs.statSync(sourcePath(ref.id, m.ext)).size;
    if (size !== m.fileSize) throw new HttpError(409, 'The uploaded file is incomplete. Please try again.');
    await ref.update({ status: 'processing', stage: 'Queued', percent: 1 });
    processMeeting(ref);
    res.status(202).json({ id: ref.id });
  }));

  router.get('/:id', route('Could not load meeting', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = meetings().doc(req.params.id);
    const m = ownMeeting(await ref.get(), uid);
    const parts = m.status === 'done' ? await loadParts(ref) : { original: [], translation: [] };
    res.json({ meeting: serializeMeeting(ref.id, m), transcript: parts.original, translation: parts.translation });
  }));

  router.patch('/:id', route('Could not save', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = meetings().doc(req.params.id);
    ownMeeting(await ref.get(), uid);
    const b = req.body || {};
    const updates = {};
    if (b.title !== undefined) {
      const title = String(b.title).trim().slice(0, 150);
      if (!title) throw new HttpError(400, 'Give the meeting a title.');
      updates.title = title;
    }
    if (b.speakerNames && typeof b.speakerNames === 'object') {
      updates.speakerNames = Object.fromEntries(
        Object.entries(b.speakerNames)
          .filter(([k, v]) => /^Speaker [A-Z]$/.test(k) && typeof v === 'string')
          .map(([k, v]) => [k, v.trim().slice(0, 60)])
          .filter(([, v]) => v),
      );
    }
    await ref.update(updates);
    res.json({ success: true });
  }));

  /** (Re)write the minutes, e.g. after renaming speakers. Charged per started hour. */
  router.post('/:id/minutes', limiter, route('Could not write the minutes', async (req, res) => {
    const { uid } = await verifyAuth(req);
    if (!minutesConfigured()) throw new HttpError(503, 'Meeting minutes are not switched on yet on this server.');
    const ref = meetings().doc(req.params.id);
    const m = ownMeeting(await ref.get(), uid);
    if (m.status !== 'done') throw new HttpError(409, 'Wait for the transcript to finish first.');
    const parts = await loadParts(ref);
    const english = m.language === 'eng' ? parts.original : parts.translation;
    if (!english.length) throw new HttpError(400, 'Minutes need an English transcript or translation.');

    const cost = Math.max(1, Math.ceil((m.durationSeconds || 60) / 3600)) * MINUTES_CREDITS_PER_HOUR;
    const account = await resolveAccount(uid);
    if (account.credits < cost) throw new HttpError(402, `This needs ${cost} credits. You have ${account.credits}.`, { upgrade: true });

    const minutes = await generateMinutes(applySpeakerNames(english, m.speakerNames), {
      title: m.title,
      date: m.date,
      language: m.language,
      note: m.language !== 'eng' ? `The meeting was held in ${languageName(m.language)}; this is a machine translation.` : '',
    });
    // Charge only after the minutes were written successfully.
    await adminDb.runTransaction(async (tx) => {
      const acc = await resolveAccount(uid, tx);
      tx.update(acc.billingRef, { credits: Math.max(0, acc.credits - cost), creditsUsedThisMonth: FieldValue.increment(cost) });
      tx.update(ref, { minutes, minutesError: null, wantMinutes: true, creditsUsed: (m.creditsUsed || 0) + cost });
    });
    res.json({ minutes: { ...minutes, generatedAt: iso(minutes.generatedAt) }, creditsUsed: cost });
  }));

  router.delete('/:id', route('Could not delete', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = meetings().doc(req.params.id);
    const m = ownMeeting(await ref.get(), uid);
    if (m.status === 'processing') throw new HttpError(409, 'Wait for this meeting to finish processing before deleting it.');
    if (m.audioPublicId) await deleteAudio(m.audioPublicId).catch(() => {});
    const parts = await ref.collection('parts').get();
    const batch = adminDb.batch();
    parts.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
    received.delete(ref.id);
    cleanupDir(workDir(ref.id));
    res.json({ success: true });
  }));

  return router;
}
