/**
 * SonicPure API: uploads to Cloudinary, cleans audio with Cleanvoice, local-language
 * transcripts and captions with Khaya AI + ffmpeg, podcast/church shows with a podcast
 * feed, credits in Firestore and payments through Paystack (in GHS).
 * All secrets stay server-side.
 */
import './env.js';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';
import { uploadAudio, saveProcessedAudio, saveExtractedAudio, deleteAudio, transcodedUrl } from '../lib/cloudinary.js';
import { extractAudioFromVideo } from '../lib/extractAudio.js';
import { parseBuffer } from 'music-metadata';
import { startCleanvoiceJob, checkCleanvoiceJob, extractInsights, cleanvoiceCredits } from './lib/cleanvoice.js';
import { HttpError, verifyAuth, sendError, diskLog, formatError, getQuotaDayKey, toDate, iso } from './lib/http.js';
import { resolveAccount, billedTo, billingRefFor, getAccessibleFile, refundJob } from './lib/accounts.js';
import { khayaConfigured } from './lib/khaya.js';
import transcriptsRouter from './routes/transcripts.js';
import captionsRouter from './routes/captions.js';
import showsRouter, { recoverPublishing } from './routes/shows.js';
import meetingsRouter from './routes/meetings.js';
import recordingsRouter from './routes/recordings.js';
import { minutesConfigured } from './lib/claude.js';
import { assertWorkingSpace, deleteAtFor, originalDeleteAt, startRetentionSweeper, unusedDeleteAt } from './lib/retention.js';
import { r2Configured } from './lib/hosting.js';
import {
  isShowPlan,
  TEAM_TOPUP_PACK_CREDITS,
  HOSTING_ADDON_HOURS,
  HOSTING_ADDON_USD,
  HOSTING_ADDON_DAYS,
  HOSTING_ADDON_MAX_BLOCKS,
  TEAM_TOPUP_MAX_PACKS,
  teamTopupPriceUsd,
  PROFILES,
  PLAN_CREDITS,
  PAYG_CREDITS_PER_USD,
  PAYG_MIN_CREDITS,
  PAYG_MAX_CREDITS,
  normalizeOptions,
  planRestriction,
  estimateCredits,
  buildCleanvoiceConfig,
} from '../shared/processing.js';

diskLog('[Startup] Cleanvoice key: ' + (process.env.CLEANVOICE_API_KEY ? `present (...${process.env.CLEANVOICE_API_KEY.slice(-4)})` : 'MISSING'));

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.webm', '.opus', '.aiff'];
// Extensions Cleanvoice accepts as audio. Anything else is transcoded to WAV by Cloudinary first.
const CLEANVOICE_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aiff', '.aac', '.opus'];
const FINALIZE_STALE_MS = 5 * 60 * 1000;
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Podcast feeds are public and read by Apple/Spotify servers, so they skip CORS.
const showRoutes = showsRouter({
  publicBaseUrl: process.env.PUBLIC_API_URL,
  siteUrl: process.env.PUBLIC_SITE_URL,
  serializeFile,
});
app.get('/feeds/show/:id', showRoutes.feed);
// Feed links created before podcasts and churches were merged keep working.
app.get('/feeds/church/:id', showRoutes.feed);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
  }),
);

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    ...(message ? { message: { error: message } } : {}),
  });
// Status polling runs every few seconds per active job, so the general limit is generous.
const apiLimiter = limiter(1500);
const uploadLimiter = limiter(40, 'Too many upload or processing attempts. Please wait and try again.');
const paymentLimiter = limiter(30, 'Too many payment attempts. Please wait and try again.');
app.use('/api', apiLimiter);
app.use((req, res, next) => {
  if (req.path === '/api/paystack/webhook') return next();
  express.json()(req, res, next);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } });

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'SonicPure API is running', transcripts: khayaConfigured() });
});

app.use('/api/transcripts', transcriptsRouter({ limiter: uploadLimiter }));
app.use('/api/captions', captionsRouter({ limiter: uploadLimiter }));
app.use('/api/shows', showRoutes.router);
app.use('/api/meetings', meetingsRouter({ limiter: uploadLimiter }));
app.use('/api/recordings', recordingsRouter({ limiter: uploadLimiter }));

// ─── Helpers ─────────────────────────────────────────────────────

function enhancesUsedToday(user) {
  return user.dailyEnhancesDate === getQuotaDayKey() ? user.dailyEnhancesUsed || 0 : 0;
}

async function loadPlan(planName) {
  const snap = await adminDb.collection('creditPlans').doc(planName).get();
  return snap.exists ? snap.data() : { maxDailyEnhances: 2, maxAudioLengthMins: 20, extractAudioFromVideo: false };
}

/** Public shape of an audioFiles doc. `full` adds transcript and AI notes. */
function serializeFile(id, d, full = true) {
  const base = {
    fileId: id,
    status: d.status === 'uploading' ? 'uploaded' : d.status === 'finalizing' ? 'processing' : d.status,
    stage: d.stage || null,
    percent: d.percent ?? null,
    feature: d.feature || null,
    options: d.options || null,
    originalFileName: d.originalFileName,
    sourceType: d.sourceType,
    originalFileUrl: d.extractedAudioUrl || d.originalFileUrl,
    originalVideoUrl: d.sourceType === 'video' ? d.originalFileUrl : null,
    processedFileUrl: d.processedFileUrl || null,
    processedIsVideo: Boolean(d.processedIsVideo),
    durationSeconds: d.durationSeconds || 0,
    fileSizeMB: d.fileSizeMB || 0,
    creditsUsed: d.creditsUsed || 0,
    qualityLevel: d.qualityLevel || null,
    statistics: d.statistics || null,
    hasNotes: Boolean(d.transcript || d.summary),
    showId: d.showId || null,
    error: d.error || null,
    createdAt: iso(d.createdAt),
    expiresAt: iso(d.deleteAt),
    originalDeleteAt: iso(d.originalDeleteAt),
    originalRemoved: Boolean(d.originalRemoved),
  };
  if (!full) return base;
  return { ...base, transcript: d.transcript || null, summary: d.summary || null, social: d.social || null };
}

// ─── Upload ──────────────────────────────────────────────────────

app.post('/api/audio/upload', uploadLimiter, upload.single('audio'), async (req, res) => {
  try {
    const { uid: userId } = await verifyAuth(req);
    if (!req.file) throw new HttpError(400, 'No file provided');

    const account = await resolveAccount(userId);
    const planData = await loadPlan(account.plan);

    // Mime type wins over extension: a browser recording is audio/webm, not a video.
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const mime = req.file.mimetype || '';
    const isRecording = (req.file.originalname || '').startsWith('recording');
    const isAudio =
      isRecording || mime.startsWith('audio/') || (!mime.startsWith('video/') && AUDIO_EXTENSIONS.includes(ext) && ext !== '.webm');
    const isVideo = !isAudio && (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext));
    if (!isVideo && !isAudio) {
      throw new HttpError(400, 'Unsupported file type. Please upload an audio or video file.');
    }
    if (isVideo && !planData.extractAudioFromVideo) {
      throw new HttpError(403, 'Video uploads are available on Pro, Audio Master, Podcast and Church.', { upgrade: true });
    }

    // Fail fast before spending bandwidth on a job that will be rejected.
    const maxDaily = planData.maxDailyEnhances ?? -1;
    if (maxDaily !== -1 && enhancesUsedToday(account.user) >= maxDaily) {
      throw new HttpError(429, `You have used all ${maxDaily} enhancements for today. Upgrade for more.`, { upgrade: true });
    }

    let audioBuffer = req.file.buffer;
    let extractedAudioUrl = null;
    let extractedPublicId = null;
    if (isVideo) {
      audioBuffer = await extractAudioFromVideo(req.file.buffer, req.file.originalname);
      const extracted = await saveExtractedAudio(audioBuffer, userId);
      extractedAudioUrl = extracted.secure_url;
      extractedPublicId = extracted.public_id;
    }

    let durationSeconds = 0;
    try {
      const mm = await parseBuffer(audioBuffer, { mimeType: isVideo ? 'audio/mpeg' : mime });
      durationSeconds = mm.format.duration ?? 0;
    } catch {
      durationSeconds = 0;
    }
    if (!durationSeconds) durationSeconds = parseFloat(req.body.durationSeconds || '0') || 0;

    const maxMins = planData.maxAudioLengthMins ?? -1;
    if (maxMins !== -1 && durationSeconds / 60 > maxMins) {
      if (extractedPublicId) await deleteAudio(extractedPublicId).catch(() => {});
      throw new HttpError(400, `This file is ${Math.ceil(durationSeconds / 60)} min. Your plan allows up to ${maxMins} min.`, { upgrade: true });
    }

    await assertWorkingSpace(account, durationSeconds).catch(async (err) => {
      if (extractedPublicId) await deleteAudio(extractedPublicId).catch(() => {});
      throw err;
    });

    const { secure_url, public_id } = await uploadAudio(req.file.buffer, userId);

    const now = new Date();
    const docRef = await adminDb.collection('audioFiles').add({
      userId,
      showId: account.kind === 'show' ? account.showId : null,
      originalFileName: req.file.originalname || 'audio',
      originalFileUrl: secure_url,
      originalPublicId: public_id,
      originalExt: ext,
      processedFileUrl: null,
      processedPublicId: null,
      extractedAudioUrl,
      extractedPublicId,
      sourceType: isVideo ? 'video' : 'audio',
      feature: null,
      fileSizeMB: parseFloat((req.file.size / (1024 * 1024)).toFixed(2)),
      durationSeconds,
      status: 'uploaded',
      createdAt: now,
      // Deleted after a few days if it is never cleaned or published (no backups).
      deleteAt: unusedDeleteAt(now),
    });

    res.json({
      fileId: docRef.id,
      originalFileUrl: extractedAudioUrl || secure_url,
      sourceType: isVideo ? 'video' : 'audio',
      durationSeconds,
    });
  } catch (err) {
    sendError(res, err, 'Upload failed');
  }
});

// ─── Process (starts an async Cleanvoice job) ────────────────────

app.post('/api/audio/process', uploadLimiter, async (req, res) => {
  const { fileId, feature } = req.body || {};
  let charged = false;
  try {
    const { uid: userId } = await verifyAuth(req);
    if (!fileId || !PROFILES[feature]) throw new HttpError(400, 'fileId and a valid feature are required');
    const options = normalizeOptions(req.body.options);

    const { ref: fileRef } = await getAccessibleFile(fileId, userId);

    const job = await adminDb.runTransaction(async (tx) => {
      const account = await resolveAccount(userId, tx);
      const fileSnap = await tx.get(fileRef);
      const file = fileSnap.data();
      if (!['uploaded', 'uploading'].includes(file.status)) {
        throw new HttpError(409, 'This file is already processing or finished.');
      }
      const planSnap = await tx.get(adminDb.collection('creditPlans').doc(account.plan));
      const planData = planSnap.exists ? planSnap.data() : { maxDailyEnhances: 2 };

      if (file.sourceType !== 'video') options.returnVideo = false;
      const restriction = planRestriction(feature, options, account.plan);
      if (restriction) throw new HttpError(403, restriction, { upgrade: true });

      const usedToday = enhancesUsedToday(account.user);
      const maxDaily = planData.maxDailyEnhances ?? -1;
      if (maxDaily !== -1 && usedToday >= maxDaily) {
        throw new HttpError(429, `You have used all ${maxDaily} enhancements for today. Upgrade for more.`, { upgrade: true });
      }

      const cost = estimateCredits(feature, file.durationSeconds, options);
      if (account.credits < cost) {
        throw new HttpError(402, `This job needs ${cost} credits. You have ${account.credits}.`, {
          creditsNeeded: cost,
          creditsAvailable: account.credits,
          upgrade: true,
        });
      }

      const { config, qualityLevel } = buildCleanvoiceConfig(feature, options, account.plan);
      const now = new Date();

      tx.update(account.billingRef, {
        credits: account.credits - cost,
        creditsUsedThisMonth: FieldValue.increment(cost),
      });
      tx.update(account.userRef, {
        dailyEnhancesDate: getQuotaDayKey(),
        dailyEnhancesUsed: usedToday + 1,
        dailyEnhancesResetAt: now,
      });
      tx.update(fileRef, {
        status: 'processing',
        feature,
        options,
        creditsUsed: cost,
        billedTo: billedTo(account),
        qualityLevel,
        stage: 'Queued',
        percent: 2,
        startedAt: now,
        error: null,
      });

      let targetUrl = file.originalFileUrl;
      if (file.sourceType === 'video' && !options.returnVideo) {
        targetUrl = file.extractedAudioUrl;
      } else if (
        file.sourceType === 'audio' &&
        !CLEANVOICE_AUDIO_EXTENSIONS.includes(file.originalExt || path.extname(new URL(file.originalFileUrl).pathname))
      ) {
        targetUrl = transcodedUrl(file.originalPublicId, 'wav');
      }

      return { cost, config, targetUrl: targetUrl.replace('http://', 'https://'), creditsRemaining: account.credits - cost };
    });
    charged = true;

    const editId = await startCleanvoiceJob(job.targetUrl, job.config);
    await fileRef.update({ editId });
    diskLog(`[Process] Started Cleanvoice edit ${editId} for file ${fileId}`);

    res.status(202).json({
      fileId,
      status: 'processing',
      creditsUsed: job.cost,
      creditsRemaining: job.creditsRemaining,
    });
  } catch (err) {
    if (charged && fileId) {
      diskLog(`[Process Error] [${fileId}] ${formatError(err)}`);
      await failAudioJob(adminDb.collection('audioFiles').doc(fileId), formatError(err)).catch((e) =>
        diskLog(`[Refund Error] [${fileId}] ${formatError(e)}`),
      );
      return res.status(502).json({ error: 'Cleanvoice could not start this job. Your credits were refunded.', message: formatError(err) });
    }
    sendError(res, err, 'Processing failed');
  }
});

/** Mark a cleaning job failed and give back its credits and daily slot. Idempotent. */
async function failAudioJob(fileRef, reason) {
  let file = null;
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(fileRef);
    file = snap.data();
    if (!file || file.status === 'failed' || file.status === 'processed') {
      file = null;
      return;
    }
    const userRef = adminDb.collection('users').doc(file.userId);
    const user = (await tx.get(userRef)).data() || {};
    // Older jobs have no billedTo; they were billed to the uploader.
    const billing = file.billedTo || { kind: 'user', id: file.userId };
    if (file.creditsUsed > 0) {
      tx.update(billingRefFor(billing), {
        credits: FieldValue.increment(file.creditsUsed),
        creditsUsedThisMonth: FieldValue.increment(-file.creditsUsed),
      });
    }
    if (enhancesUsedToday(user) > 0) tx.update(userRef, { dailyEnhancesUsed: user.dailyEnhancesUsed - 1 });
    tx.update(fileRef, { status: 'failed', error: reason, creditsRefunded: file.creditsUsed || 0, creditsUsed: 0, deleteAt: unusedDeleteAt() });
  });
  if (file) {
    diskLog(`[Job Failed] [${fileRef.id}] ${reason}`);
    await adminDb.collection('usageLogs').add({
      userId: file.userId,
      feature: file.feature,
      fileName: file.originalFileName,
      fileDurationSeconds: file.durationSeconds || 0,
      creditsUsed: 0,
      status: 'failed',
      createdAt: new Date(),
    });
  }
}

/** Copy a finished Cleanvoice result into Cloudinary + Firestore. Only one caller wins the claim. */
async function finalizeJob(fileRef, result) {
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(fileRef);
    const d = snap.data();
    const stale = d.status === 'finalizing' && Date.now() - (toDate(d.finalizingAt)?.getTime() || 0) > FINALIZE_STALE_MS;
    if (d.status !== 'processing' && !stale) return null;
    tx.update(fileRef, { status: 'finalizing', finalizingAt: new Date(), stage: 'Saving your file', percent: 98 });
    return d;
  });
  if (!claimed) return;

  try {
    const download = await fetch(result.download_url);
    if (!download.ok) throw new Error(`Download from Cleanvoice failed (${download.status})`);
    const buffer = Buffer.from(await download.arrayBuffer());
    const saved = await saveProcessedAudio(buffer, claimed.userId);
    const insights = extractInsights(result);
    let processedDurationSeconds = null;
    try {
      processedDurationSeconds = (await parseBuffer(buffer)).format.duration ?? null;
    } catch {
      processedDurationSeconds = null;
    }

    await fileRef.update({
      status: 'processed',
      stage: 'Done',
      percent: 100,
      processedFileUrl: saved.secure_url,
      processedPublicId: saved.public_id,
      processedBytes: saved.bytes || buffer.length,
      processedDurationSeconds,
      processedIsVideo: insights.isVideo,
      statistics: insights.statistics,
      transcript: insights.transcript,
      summary: insights.summary,
      social: insights.social,
      completedAt: new Date(),
      // Keep the original briefly for before/after, the cleaned file for the plan's window.
      originalDeleteAt: originalDeleteAt(),
      deleteAt: await deleteAtFor(claimed.userId),
    });
    await adminDb.collection('usageLogs').add({
      userId: claimed.userId,
      feature: claimed.feature,
      fileName: claimed.originalFileName,
      fileDurationSeconds: claimed.durationSeconds || 0,
      creditsUsed: claimed.creditsUsed || 0,
      qualityLevel: claimed.qualityLevel || null,
      status: 'completed',
      createdAt: new Date(),
    });
    diskLog(`[Job Done] [${fileRef.id}] saved to Cloudinary`);
  } catch (err) {
    // Release the claim so the next poll retries the copy.
    await fileRef.update({ status: 'processing', stage: 'Retrying save', percent: 97 });
    throw err;
  }
}

// ─── Status (client polls this; it advances the job) ─────────────

app.get('/api/audio/status/:fileId', async (req, res) => {
  try {
    const { uid } = await verifyAuth(req);
    const { ref, data } = await getAccessibleFile(req.params.fileId, uid);

    if (data.status === 'processing' && data.editId) {
      const check = await checkCleanvoiceJob(data.editId);
      if (check.state === 'running') {
        if (check.stage !== data.stage || check.percent !== data.percent) {
          await ref.update({ stage: check.stage, percent: check.percent });
        }
      } else if (check.state === 'failed') {
        await failAudioJob(ref, check.message);
      } else {
        await finalizeJob(ref, check.result);
      }
    }

    const fresh = await ref.get();
    res.json(serializeFile(fresh.id, fresh.data()));
  } catch (err) {
    sendError(res, err, 'Status check failed');
  }
});

// ─── History ─────────────────────────────────────────────────────

app.get('/api/audio/history', async (req, res) => {
  try {
    const { uid } = await verifyAuth(req);
    // Equality-only query: works without a composite index. Sorted in memory.
    const snap = await adminDb.collection('audioFiles').where('userId', '==', uid).get();
    const files = snap.docs
      .map((doc) => serializeFile(doc.id, doc.data(), false))
      .filter((f) => f.status !== 'uploaded')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 30);
    res.json({ files });
  } catch (err) {
    sendError(res, err, 'Could not load history');
  }
});

app.delete('/api/audio/:fileId', async (req, res) => {
  try {
    const { uid } = await verifyAuth(req);
    const { ref, data } = await getAccessibleFile(req.params.fileId, uid);
    if (data.userId !== uid) throw new HttpError(403, 'Only the person who uploaded this file can delete it.');
    if (data.status === 'processing' || data.status === 'finalizing') {
      throw new HttpError(409, 'Wait for this file to finish processing before deleting it.');
    }
    const episodeSnap = await adminDb.collection('episodes').where('fileId', '==', ref.id).limit(1).get();
    if (!episodeSnap.empty) throw new HttpError(409, 'This file is a podcast episode. Delete it in the Podcast tab first.');
    for (const id of [data.originalPublicId, data.processedPublicId, data.extractedPublicId]) {
      if (id) await deleteAudio(id).catch((e) => diskLog(`[Cloudinary] delete failed ${id}: ${e.message}`));
    }
    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'Delete failed');
  }
});

// ─── Exchange rate (USD prices, charged in GHS) ──────────────────

let cachedRate = {
  rate: parseFloat(process.env.USD_GHS_CONVERSION_RATE || '12.1'),
  lastFetched: 0,
};

async function getLiveGhsRate() {
  if (Date.now() - cachedRate.lastFetched < 60 * 60 * 1000) return cachedRate.rate;
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    if (data.result === 'success' && data.rates?.GHS) {
      cachedRate = { rate: data.rates.GHS, lastFetched: Date.now() };
      diskLog(`[Currency] 1 USD = ${cachedRate.rate} GHS`);
    }
  } catch (err) {
    diskLog('[Currency] Live rate fetch failed, using cached/fallback: ' + err.message);
  }
  return cachedRate.rate;
}

/** Lets the UI show the approximate cedi amount before checkout. */
app.get('/api/paystack/rate', async (req, res) => {
  const currency = process.env.PAYSTACK_CURRENCY || 'GHS';
  res.json({ currency, rate: currency === 'USD' ? 1 : await getLiveGhsRate() });
});

// ─── Paystack ────────────────────────────────────────────────────

const PAYSTACK_BASE = 'https://api.paystack.co';
const PAID_TIERS = ['payg', 'pro', 'audio_master', 'podcast', 'church', 'team_topup', 'hosting_addon'];
/** Purchases for a team's shared account that any member may make (not plans). */
const TEAM_EXTRAS = ['team_topup', 'hosting_addon'];
const SHOW_TIERS = ['podcast', 'church'];

function getPaystackSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.includes('YOUR_SECRET_KEY_HERE')) {
    throw new Error('PAYSTACK_SECRET_KEY not configured in .env');
  }
  return key;
}

async function paystackRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { Authorization: `Bearer ${getPaystackSecretKey()}`, 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${PAYSTACK_BASE}${endpoint}`, options);
  return res.json();
}

app.post('/api/paystack/initialize', paymentLimiter, async (req, res) => {
  try {
    const { uid: userId } = await verifyAuth(req);
    const { tier } = req.body;
    if (!PAID_TIERS.includes(tier)) throw new HttpError(400, 'Invalid tier');

    const userSnap = await adminDb.collection('users').doc(userId).get();
    if (!userSnap.exists) throw new HttpError(404, 'User not found');
    const userData = userSnap.data();

    let planData = { name: tier === 'hosting_addon' ? 'Extra podcast space' : 'Team top-up' };
    if (!TEAM_EXTRAS.includes(tier)) {
      const planSnap = await adminDb.collection('creditPlans').doc(tier).get();
      if (!planSnap.exists) throw new HttpError(400, 'Plan not found');
      planData = planSnap.data();
    }

    // The team whose pool this user spends from right now (active Podcast or Church plan).
    const activeShow = userData.showId ? (await adminDb.collection('shows').doc(userData.showId).get()).data() : null;
    const onActiveTeam = Boolean(activeShow && isShowPlan(activeShow.plan) && (activeShow.memberIds || []).includes(userId));

    let showId = null;
    if (tier === 'payg' && onActiveTeam) {
      // Personal credits are not spent while the team plan is active, so they would sit unused.
      throw new HttpError(409, 'You are on a team plan, so your work uses the team\'s shared credits. Buy a team top-up instead.', { code: 'USE_TEAM_TOPUP' });
    }
    if (TEAM_EXTRAS.includes(tier)) {
      if (!onActiveTeam) throw new HttpError(400, 'This is for podcast or church teams with an active plan.');
      showId = userData.showId;
    }
    if (SHOW_TIERS.includes(tier)) {
      if (!userData.showId) throw new HttpError(400, 'Create your podcast or church account in the Podcast tab first.');
      const show = (await adminDb.collection('shows').doc(userData.showId).get()).data();
      if (show?.ownerId !== userId) throw new HttpError(403, 'Only the account owner can pay for this plan.');
      showId = userData.showId;
    }

    let usdAmount;
    let creditsToAdd;
    let hostingBlocks = null;
    if (tier === 'payg') {
      const customCredits = parseInt(req.body.customCredits, 10);
      if (!Number.isFinite(customCredits) || customCredits < PAYG_MIN_CREDITS || customCredits > PAYG_MAX_CREDITS) {
        throw new HttpError(400, `Choose between ${PAYG_MIN_CREDITS} and ${PAYG_MAX_CREDITS} credits.`);
      }
      creditsToAdd = customCredits;
      usdAmount = customCredits / PAYG_CREDITS_PER_USD;
    } else if (tier === 'team_topup') {
      const credits = parseInt(req.body.customCredits, 10);
      const packs = credits / TEAM_TOPUP_PACK_CREDITS;
      if (!Number.isInteger(packs) || packs < 1 || packs > TEAM_TOPUP_MAX_PACKS) {
        throw new HttpError(400, `Choose 1 to ${TEAM_TOPUP_MAX_PACKS} packs of ${TEAM_TOPUP_PACK_CREDITS} credits.`);
      }
      creditsToAdd = credits;
      usdAmount = teamTopupPriceUsd(credits);
    } else if (tier === 'hosting_addon') {
      hostingBlocks = parseInt(req.body.blocks, 10);
      if (!Number.isInteger(hostingBlocks) || hostingBlocks < 1 || hostingBlocks > HOSTING_ADDON_MAX_BLOCKS) {
        throw new HttpError(400, `Choose 1 to ${HOSTING_ADDON_MAX_BLOCKS} blocks of ${HOSTING_ADDON_HOURS} hours.`);
      }
      creditsToAdd = 0;
      usdAmount = hostingBlocks * HOSTING_ADDON_USD;
    } else {
      creditsToAdd = PLAN_CREDITS[tier];
      usdAmount = planData.price;
    }

    const currency = process.env.PAYSTACK_CURRENCY || 'GHS';
    const rate = currency === 'USD' ? 1 : await getLiveGhsRate();
    const amountInSubunits = Math.round(usdAmount * 100 * rate);

    const reference = `sp_${tier}_${userId.slice(0, 8)}_${Date.now()}`;
    const txPayload = {
      email: userData.email,
      amount: amountInSubunits,
      currency,
      reference,
      channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
      metadata: {
        userId,
        tier,
        showId,
        creditsToAdd,
        usdAmount,
        hostingBlocks,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: planData.name },
          { display_name: 'Credits', variable_name: 'credits', value: String(creditsToAdd) },
          { display_name: 'User', variable_name: 'user_email', value: userData.email },
        ],
      },
      callback_url: req.body.callbackUrl || undefined,
    };
    if (process.env.PAYSTACK_SUBACCOUNT_CODE) txPayload.subaccount = process.env.PAYSTACK_SUBACCOUNT_CODE;

    const result = await paystackRequest('/transaction/initialize', 'POST', txPayload);
    if (!result.status) throw new HttpError(400, result.message || 'Failed to initialize payment');

    res.json({
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code,
      reference: result.data.reference,
      amount: amountInSubunits / 100,
      currency,
    });
  } catch (err) {
    sendError(res, err, 'Payment initialization failed');
  }
});

app.get('/api/paystack/verify/:reference', paymentLimiter, async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const result = await paystackRequest(`/transaction/verify/${encodeURIComponent(req.params.reference)}`);
    if (!result.status || result.data.status !== 'success') {
      throw new HttpError(400, 'Payment not successful', { paystackStatus: result.data?.status });
    }
    const txData = result.data;
    const meta = txData.metadata || {};
    if (meta.userId !== decoded.uid) throw new HttpError(403, 'Payment does not belong to this user');

    const applied = await applyPaymentOnce(meta.userId, meta.tier, txData);
    res.json({ success: true, plan: meta.tier, creditsAdded: applied.creditsAdded });
  } catch (err) {
    sendError(res, err, 'Verification failed');
  }
});

app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString();
    const hash = crypto.createHmac('sha512', getPaystackSecretKey()).update(rawBody).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) {
      diskLog('[Paystack] webhook with invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(rawBody);
    if (event.event === 'charge.success') {
      const meta = event.data.metadata || {};
      if (meta.userId && meta.tier) await applyPaymentOnce(meta.userId, meta.tier, event.data);
    }
    res.sendStatus(200);
  } catch (err) {
    diskLog('[Paystack] webhook error: ' + formatError(err));
    res.sendStatus(200);
  }
});

/**
 * Apply a successful payment exactly once. The transaction doc id is the Paystack
 * reference, so the verify call and the webhook can't both add credits.
 */
async function applyPaymentOnce(userId, tier, txData) {
  if (!PAID_TIERS.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
  const meta = txData.metadata || {};
  const creditsAdded = tier === 'hosting_addon' ? 0 : tier === 'payg' || tier === 'team_topup' ? Number(meta.creditsToAdd) || 0 : PLAN_CREDITS[tier];

  const txRef = adminDb.collection('transactions').doc(String(txData.reference));
  const userRef = adminDb.collection('users').doc(userId);
  const showRef = (SHOW_TIERS.includes(tier) || TEAM_EXTRAS.includes(tier)) && meta.showId ? adminDb.collection('shows').doc(meta.showId) : null;

  await adminDb.runTransaction(async (tx) => {
    const reads = [tx.get(txRef), tx.get(userRef)];
    if (showRef) reads.push(tx.get(showRef));
    const [existing, userSnap, showSnap] = await Promise.all(reads);
    if (existing.exists) return;

    const now = new Date();
    const renewDate = new Date(now);
    renewDate.setMonth(renewDate.getMonth() + 1);

    if (showRef) {
      const show = showSnap?.exists ? showSnap.data() : null;
      if (!show) throw new Error(`Show ${meta.showId} not found for payment ${txData.reference}`);
      if (tier === 'team_topup') {
        // Extra credits only: the plan and renewal date stay as they are.
        tx.update(showRef, { credits: Math.max(0, Number(show.credits || 0)) + creditsAdded });
      } else if (tier === 'hosting_addon') {
        // 30 more days of extra space; renewing early adds to the time left. The block count is what was just bought.
        const current = show.hostingAddon?.until?.toDate?.() || null;
        const from = current && current > now ? current : now;
        tx.update(showRef, {
          hostingAddon: { blocks: Number(meta.hostingBlocks) || 1, until: new Date(from.getTime() + HOSTING_ADDON_DAYS * 864e5) },
        });
      } else tx.update(showRef, {
        plan: tier,
        credits: Math.max(0, Number(show.credits || 0)) + creditsAdded,
        creditsUsedThisMonth: 0,
        billingRenewDate: renewDate,
        paystackCustomerId: txData.customer?.customer_code || show.paystackCustomerId || null,
      });
    } else {
      const user = userSnap.exists ? userSnap.data() : {};
      const updates = {
        credits: Math.max(0, Number(user.credits ?? 0)) + creditsAdded,
        paystackCustomerId: txData.customer?.customer_code || user.paystackCustomerId || null,
      };
      if (tier === 'payg') {
        // A top-up must not downgrade a Pro or Audio Master subscriber.
        if ((user.plan || 'free') === 'free') updates.plan = 'payg';
      } else {
        updates.plan = tier;
        updates.creditsUsedThisMonth = 0;
        updates.billingRenewDate = renewDate;
      }
      tx.update(userRef, updates);
    }

    tx.set(txRef, {
      userId,
      showId: showRef ? showRef.id : null,
      paystackReference: txData.reference,
      amountPaid: txData.amount / 100,
      currency: txData.currency || 'GHS',
      usdAmount: meta.usdAmount ?? null,
      creditsAdded,
      hostingBlocks: meta.hostingBlocks ?? null,
      plan: tier,
      status: 'success',
      paystackTransactionId: txData.id,
      paystackChannel: txData.channel || null,
      createdAt: now,
    });
  });
  diskLog(`[Paystack] applied ${tier} (+${creditsAdded} credits) for ${showRef ? `show ${showRef.id}` : userId}, ref ${txData.reference}`);
  return { creditsAdded };
}

// ─── Recovery ────────────────────────────────────────────────────

/** Transcript, caption and meeting jobs run in this process; any left running by a restart are refunded. */
async function recoverInterruptedJobs() {
  for (const collection of ['transcripts', 'captionJobs', 'meetings']) {
    const snap = await adminDb.collection(collection).where('status', 'in', ['queued', 'processing', 'uploading']).get();
    for (const doc of snap.docs) {
      await refundJob(doc.ref, 'The server restarted while this was running. Your credits were refunded; please try again.');
    }
    if (snap.size) diskLog(`[Recovery] refunded ${snap.size} interrupted ${collection}`);
  }
}

// ─── Server start ────────────────────────────────────────────────

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  diskLog(`SonicPure API server on http://localhost:${PORT}`);
  if (!process.env.CLEANVOICE_API_KEY) diskLog('WARNING: CLEANVOICE_API_KEY not set - audio processing will fail');
  if (!khayaConfigured()) diskLog('WARNING: KHAYA_API_KEY not set - local-language transcripts and captions are disabled');
  if (!minutesConfigured()) diskLog('WARNING: ANTHROPIC_API_KEY not set - meeting minutes are disabled');
  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('YOUR_SECRET_KEY')) {
    diskLog('WARNING: PAYSTACK_SECRET_KEY not set - payments will not work');
  }
  recoverInterruptedJobs().catch((err) => diskLog('[Recovery] failed: ' + formatError(err)));
  startRetentionSweeper();
  recoverPublishing().then((n) => n && diskLog(`[Recovery] ${n} episodes were mid-publish and went back to draft`)).catch(() => {});
  diskLog(r2Configured() ? '[Startup] Published episodes are hosted on Cloudflare R2' : 'WARNING: R2 not configured - published episodes are hosted on Cloudinary (listeners use Cloudinary bandwidth)');
  if (process.env.CLEANVOICE_API_KEY) {
    cleanvoiceCredits().then((credits) => {
      if (credits === null) diskLog('WARNING: could not check the Cleanvoice account balance');
      else if (credits <= 0) diskLog('WARNING: Cleanvoice account has 0 credits - audio cleaning and English meeting transcripts will fail until you top up at app.cleanvoice.ai');
      else diskLog(`[Startup] Cleanvoice credits remaining: ${credits}`);
    });
  }
});
