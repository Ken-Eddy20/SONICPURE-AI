/**
 * Backend API - Proxies audio processing to Audo AI
 * Keeps the API key server-side only
 */
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import util from 'util';
import fs from 'fs';
import { fileURLToPath } from 'url';
import admin, { adminAuth, adminDb } from '../lib/firebaseAdmin.js';
import { uploadAudio, saveProcessedAudio, saveExtractedAudio, deleteAudio } from '../lib/cloudinary.js';
import { extractAudioFromVideo } from '../lib/extractAudio.js';
import { parseBuffer } from 'music-metadata';
import { processAudioCleaning, getJobStatus, deleteCleanvoiceJob } from './lib/cleanvoice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
function diskLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(path.join(__dirname, 'server.log'), line);
  console.log(msg);
}

diskLog('[Startup] Cleanvoice Key Loaded: ' + (process.env.CLEANVOICE_API_KEY ? `Present (...${process.env.CLEANVOICE_API_KEY.slice(-4)})` : 'MISSING'));

function formatError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message && err.message !== '[object Object]') return err.message;
  return util.inspect(err, { depth: 2, colors: false });
}

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.webm'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload or processing attempts. Please wait and try again.' },
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please wait and try again.' },
});
app.use('/api', apiLimiter);
app.use((req, res, next) => {
  if (req.path === '/api/paystack/webhook') return next();
  express.json()(req, res, next);
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024 } }); // 60MB

function getQuotaDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

// ─── Exchange Rate Utils ──────────────────────────────────────────
let cachedRate = {
  rate: parseFloat(process.env.USD_GHS_CONVERSION_RATE || '12.1'),
  lastFetched: 0
};

async function getLiveGhsRate() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - cachedRate.lastFetched < ONE_HOUR) {
    return cachedRate.rate;
  }

  try {
    diskLog('[Currency] Fetching live USD/GHS rate...');
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    
    if (data.result === 'success' && data.rates && data.rates.GHS) {
      cachedRate = {
        rate: data.rates.GHS,
        lastFetched: Date.now()
      };
      diskLog(`[Currency] Live rate updated: 1 USD = ${cachedRate.rate} GHS`);
      return cachedRate.rate;
    }
  } catch (err) {
    diskLog('[Currency Error] Failed to fetch live rate, using fallback: ' + err.message);
  }
  
  return cachedRate.rate; // Returns cached version or fallback from env
}

app.get('/', (req, res) => {
  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (acceptsHtml) {
    res.send(`<!DOCTYPE html><html><head><title>SonicPure API</title></head><body style="font-family:sans-serif;padding:2rem">
      <h1>SonicPure API is running</h1>
      <p>Use the main app at <a href="http://localhost:3000">http://localhost:3000</a></p>
      <p><strong>Endpoints:</strong> POST /api/audio/process</p>
    </body></html>`);
  } else {
    res.json({ status: 'ok', message: 'SonicPure API is running', endpoints: ['POST /api/audio/process'] });
  }
});

app.get('/api', (req, res) => {
  res.json({ status: 'ok', message: 'SonicPure API', endpoints: { 'POST /api/audio/process': 'Process audio file using Quality Tiers' } });
});

// ─── Audio Upload (Cloudinary + Firestore) ───────────────────────

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const idToken = authHeader.split('Bearer ')[1];
  return adminAuth.verifyIdToken(idToken);
}

app.post('/api/audio/upload', uploadLimiter, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const decoded = await verifyAuth(req);
    const userId = decoded.uid;

    // ── Fetch user & plan from Firestore ──
    const userSnap = await adminDb.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userSnap.data();
    const planName = userData.plan || 'free';

    const planSnap = await adminDb.collection('creditPlans').doc(planName).get();
    if (!planSnap.exists) {
      return res.status(500).json({ error: 'Plan configuration not found' });
    }
    const planData = planSnap.data();

    // ── Determine file type by extension ──
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    let isVideo = VIDEO_EXTENSIONS.includes(ext);
    let isAudio = AUDIO_EXTENSIONS.includes(ext) || req.file.mimetype?.startsWith('audio/');
    
    // Recordings from microphone might be saved as .mp4 or .webm by certain browsers (like Safari)
    if (req.file.originalname?.startsWith('recording.')) {
      isVideo = false;
      isAudio = true;
    } else if (ext === '.webm' && req.file.mimetype?.startsWith('audio/')) {
      isVideo = false;
    }

    if (!isVideo && !isAudio) {
      return res.status(400).json({ error: 'Unsupported file type. Please upload an audio or video file.' });
    }

    // ── Video extraction gate ──
    if (isVideo && !planData.extractAudioFromVideo) {
      return res.status(403).json({
        error: 'Video uploads are not available on your plan. Upgrade to Pro or Unlimited.',
      });
    }

    const maxDaily = planData.maxDailyEnhances ?? -1;
    const todayKey = getQuotaDayKey();
    const dailyUsed = userData.dailyEnhancesDate === todayKey ? (userData.dailyEnhancesUsed || 0) : 0;
    if (maxDaily !== -1 && dailyUsed >= maxDaily) {
      return res.status(429).json({
        error: `You have reached your daily upload limit (${maxDaily}/day). Upgrade your plan for more enhancements.`,
      });
    }

    // ── Extract audio from video if needed ──
    let audioBuffer = req.file.buffer;
    let extractedAudioUrl = null;
    let extractedPublicId = null;
    const sourceType = isVideo ? 'video' : 'audio';

    if (isVideo) {
      audioBuffer = await extractAudioFromVideo(req.file.buffer, req.file.originalname);
      const extracted = await saveExtractedAudio(audioBuffer, userId);
      extractedAudioUrl = extracted.secure_url;
      extractedPublicId = extracted.public_id;
    }

    // ── Detect duration via music-metadata ──
    let durationSeconds = 0;
    try {
      const mm = await parseBuffer(audioBuffer, { mimeType: isVideo ? 'audio/mpeg' : req.file.mimetype });
      durationSeconds = mm.format.duration ?? 0;
    } catch {
      // If metadata parsing fails, fall back to client-provided value
      durationSeconds = parseFloat(req.body.durationSeconds || '0');
    }

    // ── Audio length limit ──
    const maxMins = planData.maxAudioLengthMins ?? -1;
    if (maxMins !== -1 && durationSeconds / 60 > maxMins) {
      return res.status(400).json({
        error: `Your audio exceeds the maximum length for your plan (${maxMins} min). Upgrade for longer audio.`,
      });
    }

    // ── Upload original to Cloudinary ──
    const { secure_url, public_id } = await uploadAudio(req.file.buffer, userId);

    // ── Create audioFiles document ──
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86400000);
    const feature = req.body.feature || 'noise_removal';

    const docRef = await adminDb.collection('audioFiles').add({
      userId,
      originalFileName: req.file.originalname || 'audio.wav',
      originalFileUrl: secure_url,
      originalPublicId: public_id,
      processedFileUrl: null,
      processedPublicId: null,
      extractedAudioUrl,
      extractedPublicId,
      sourceType,
      feature,
      fileSizeMB: parseFloat((req.file.size / (1024 * 1024)).toFixed(2)),
      durationSeconds,
      status: 'uploading',
      createdAt: now,
      expiresAt,
    });

    res.json({
      fileId: docRef.id,
      originalFileUrl: secure_url,
      extractedAudioUrl,
      sourceType,
    });
  } catch (err) {
    console.error('Audio upload error:', err);
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.delete('/api/audio/:fileId', async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const userId = decoded.uid;
    const { fileId } = req.params;

    const docRef = adminDb.collection('audioFiles').doc(fileId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    const data = docSnap.data();
    if (data.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (data.originalPublicId) await deleteAudio(data.originalPublicId);
    if (data.processedPublicId) await deleteAudio(data.processedPublicId);
    if (data.extractedPublicId) await deleteAudio(data.extractedPublicId);

    await docRef.delete();
    res.json({ success: true });
  } catch (err) {
    console.error('Audio delete error:', err);
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// ─── Polling Route ───────────────────────────────────────────────
app.get('/api/audio/status/:fileId', async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const userId = decoded.uid;
    const { fileId } = req.params;

    const docRef = adminDb.collection('audioFiles').doc(fileId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
       return res.status(404).json({ error: 'File not found' });
    }

    const data = docSnap.data();
    if (data.userId !== userId) {
       return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({
       fileId,
       status: data.status,
       processedFileUrl: data.processedFileUrl,
       qualityLevel: data.qualityLevel,
       creditsUsed: data.creditsUsed || 0,
       creditsRemaining: data.creditsRemaining || -1,
    });
  } catch (err) {
    console.error('Status check error:', err);
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Status check failed' });
  }
});

// ─── Processing Route ────────────────────────────────────────────
app.post('/api/audio/process', uploadLimiter, async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const userId = decoded.uid;
    const { fileId, feature } = req.body;
    diskLog(`[API] Received process request for fileId: ${fileId}, userId: ${userId}`);

    if (!fileId || !feature) {
      return res.status(400).json({ error: 'fileId and feature are required' });
    }

    const docRef = adminDb.collection('audioFiles').doc(fileId);
    const userRef = adminDb.collection('users').doc(userId);
    const reservation = await adminDb.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(docRef);
      if (!docSnap.exists) {
        throw httpError(404, 'Audio file not found');
      }

      const audioData = docSnap.data();
      if (audioData.userId !== userId) {
        throw httpError(403, 'Not authorized');
      }
      if (audioData.status !== 'uploading') {
        throw httpError(400, 'File is already processing or completed.');
      }

      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw httpError(404, 'User not found');
      }
      const userData = userSnap.data();
      const planName = (userData.plan || 'free').toLowerCase();
      const isUnlimited = planName === 'audio_master';

      const planRef = adminDb.collection('creditPlans').doc(planName);
      const planSnap = await transaction.get(planRef);
      const planData = planSnap.exists ? planSnap.data() : { maxDailyEnhances: 2 };

      const durationSeconds = audioData.durationSeconds || 60;
      const creditCostPerMinute = feature === 'audio_enhancement' ? 3 : 2;
      const creditsNeeded = Math.ceil(durationSeconds / 60) * creditCostPerMinute;

      if (!isUnlimited && (userData.credits || 0) < creditsNeeded) {
        throw httpError(402, 'Insufficient credits', {
          creditsNeeded,
          creditsAvailable: userData.credits || 0,
          upgrade: 'Top up or upgrade your plan.',
        });
      }

      const todayKey = getQuotaDayKey();
      const currentDailyUsed = userData.dailyEnhancesDate === todayKey ? (userData.dailyEnhancesUsed || 0) : 0;
      const maxDaily = planData.maxDailyEnhances ?? -1;
      if (maxDaily !== -1 && currentDailyUsed >= maxDaily) {
        throw httpError(429, 'Daily limit reached', {
          upgrade: 'Upgrade for more enhancements.',
        });
      }

      const qualityLevel = (planName === 'free' || planName === 'payg') ? 80 : 100;
      const creditsRemaining = isUnlimited ? -1 : Number(userData.credits || 0) - creditsNeeded;

      transaction.update(docRef, {
        status: 'processing',
        qualityLevel,
        creditsUsed: creditsNeeded,
        creditsRemaining,
      });

      const userUpdate = {
        dailyEnhancesDate: todayKey,
        dailyEnhancesUsed: currentDailyUsed + 1,
        dailyEnhancesResetAt: new Date(),
      };
      if (!isUnlimited) {
        userUpdate.credits = creditsRemaining;
        userUpdate.creditsUsedThisMonth = (userData.creditsUsedThisMonth || 0) + creditsNeeded;
      }
      transaction.update(userRef, userUpdate);

      return {
        audioData,
        planName,
        isUnlimited,
        durationSeconds,
        creditsNeeded,
        creditsRemaining,
        qualityLevel,
      };
    });

    const {
      audioData,
      planName,
      isUnlimited,
      durationSeconds,
      creditsNeeded,
      creditsRemaining,
      qualityLevel,
    } = reservation;

    // Fire & Forget Processing or Await here (We await due to Cloudinary save reqs inside Express)
    const targetUrl = audioData.extractedAudioUrl || audioData.originalFileUrl;
    
    // Respond immediately to prevent browser network timeout handling large files
    res.json({
        success: true,
        processing: true,
        message: 'Processing started in the background.'
    });

    (async () => {
      try {
        diskLog(`[Background] Starting processing for fileId: ${fileId}, targetUrl: ${targetUrl}`);
      // ── Verify URL Reachability ──
      try {
        const headResponse = await fetch(targetUrl.replace('http://', 'https://'), { method: 'HEAD' });
        if (!headResponse.ok) {
          throw new Error(`Audio file not reachable on Cloudinary (Status: ${headResponse.status}). Wait a few seconds or re-upload.`);
        }
        diskLog(`[Background] URL verified: ${targetUrl}`);
      } catch (err) {
        throw new Error(`Pre-processing reachability check failed: ${err.message}`);
      }

      // ── Start Cleanvoice Process ──
      const { processedUrl } = await processAudioCleaning(targetUrl, feature, planName);
        diskLog(`[Background] Cleanvoice success for fileId: ${fileId}, resultUrl: ${processedUrl}`);
        
        // Save output back to Cloudinary
        const bufferRes = await fetch(processedUrl);
        if (!bufferRes.ok) throw new Error("Failed fetching processed result from cleanvoice");
        const buffer = await bufferRes.arrayBuffer();
        
        const { secure_url, public_id } = await saveProcessedAudio(Buffer.from(buffer), userId);

        // Save success state
        await docRef.update({
            status: 'processed',
            processedFileUrl: secure_url,
            processedPublicId: public_id,
            creditsRemaining,
        });

        diskLog(`[Background] Firestore update complete for fileId: ${fileId}`);

        await adminDb.collection('usageLogs').add({
            userId,
            feature,
            fileName: audioData.originalFileName,
            fileDurationSeconds: durationSeconds,
            creditsUsed: creditsNeeded,
            qualityLevel,
            status: 'completed',
            createdAt: new Date()
        });

      } catch (backgroundErr) {
        diskLog(`[Background Error] [fileId: ${fileId}] ` + formatError(backgroundErr));
        console.error(`[fileId: ${fileId}] Background processing error:`, backgroundErr);
        const errMsg = formatError(backgroundErr);
        await docRef.update({ status: 'failed', error: errMsg });
        const refundUpdate = {
          dailyEnhancesUsed: admin.firestore.FieldValue.increment(-1),
        };
        if (!isUnlimited) {
          refundUpdate.credits = admin.firestore.FieldValue.increment(creditsNeeded);
          refundUpdate.creditsUsedThisMonth = admin.firestore.FieldValue.increment(-creditsNeeded);
        }
        await userRef.update(refundUpdate);
      }
    })();

  } catch (err) {
    console.error('Process handler error:', err);
    if (!err.status && req.body.fileId) {
       await adminDb.collection('audioFiles').doc(req.body.fileId).update({ status: 'failed' });
    }
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        creditsNeeded: err.creditsNeeded,
        creditsAvailable: err.creditsAvailable,
        upgrade: err.upgrade,
      });
    }
    res.status(500).json({ error: "Processing failed to start.", message: err.message });
  }
});


// ─── Paystack Integration ─────────────────────────────────────────

const PAYSTACK_BASE = 'https://api.paystack.co';

const PLAN_CREDIT_MAP = {
  payg:         { credits: 0, plan: 'payg' }, // Credits are now flexible and calculated dynamically
  pro:          { credits: 600, plan: 'pro' },
  audio_master: { credits: 2000, plan: 'audio_master' },
};

function getPaystackSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.includes('YOUR_SECRET_KEY_HERE')) {
    throw new Error('PAYSTACK_SECRET_KEY not configured in .env');
  }
  return key;
}

async function paystackRequest(endpoint, method = 'GET', body = null) {
  const secret = getPaystackSecretKey();
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${PAYSTACK_BASE}${endpoint}`, options);
  return res.json();
}

app.post('/api/paystack/initialize', paymentLimiter, async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const userId = decoded.uid;

    const { tier } = req.body;
    if (!tier || !PLAN_CREDIT_MAP[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const userSnap = await adminDb.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userSnap.data();

    const planSnap = await adminDb.collection('creditPlans').doc(tier).get();
    if (!planSnap.exists) {
      return res.status(400).json({ error: 'Plan not found' });
    }
    const planData = planSnap.data();
    
    let amountInCents = 0;
    let creditsToAdd = 0;

    if (tier === 'payg') {
      const customCredits = parseInt(req.body.customCredits || '0');
      if (isNaN(customCredits) || customCredits < 20) {
        return res.status(400).json({ error: 'Minimum 20 credits required for Pay As You Go.' });
      }
      creditsToAdd = customCredits;
      amountInCents = (customCredits / 20) * 100;
    } else {
      amountInCents = planData.price * 100;
      creditsToAdd = PLAN_CREDIT_MAP[tier].credits;
    }

    const liveRate = await getLiveGhsRate();
    const finalCurrency = process.env.PAYSTACK_CURRENCY || 'GHS';
    const finalAmountInSubunits = Math.round(amountInCents * liveRate);

    const reference = `sp_${tier}_${userId.slice(0, 8)}_${Date.now()}`;

    const txPayload = {
      email: userData.email,
      amount: finalAmountInSubunits,
      currency: finalCurrency,
      reference,
      channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
      metadata: {
        userId,
        tier,
        creditsToAdd,
        planToSet: PLAN_CREDIT_MAP[tier].plan,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: planData.name },
          { display_name: 'User', variable_name: 'user_email', value: userData.email },
        ],
      },
      callback_url: req.body.callbackUrl || undefined,
    };



    const result = await paystackRequest('/transaction/initialize', 'POST', txPayload);

    if (!result.status) {
      return res.status(400).json({ error: result.message || 'Failed to initialize payment' });
    }

    res.json({
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code,
      reference: result.data.reference,
    });
  } catch (err) {
    console.error('Paystack initialize error:', err);
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Payment initialization failed' });
  }
});

app.get('/api/paystack/verify/:reference', paymentLimiter, async (req, res) => {
  try {
    const decoded = await verifyAuth(req);
    const { reference } = req.params;

    const result = await paystackRequest(`/transaction/verify/${reference}`);

    if (!result.status || result.data.status !== 'success') {
      return res.status(400).json({
        error: 'Payment not successful',
        paystackStatus: result.data?.status,
      });
    }

    const txData = result.data;
    const meta = txData.metadata || {};
    const userId = meta.userId;
    const tier = meta.tier;

    if (userId !== decoded.uid) {
      return res.status(403).json({ error: 'Payment does not belong to this user' });
    }

    await applySuccessfulPayment(userId, tier, txData);

    res.json({ success: true, plan: tier, message: 'Payment verified and applied' });
  } catch (err) {
    console.error('Paystack verify error:', err);
    if (err.message?.includes('Authorization')) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Verification failed' });
  }
});

app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = getPaystackSecretKey();
    const sig = req.headers['x-paystack-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString();
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    if (hash !== sig) {
      console.warn('Paystack webhook: invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);
    console.log('Paystack webhook event:', event.event);

    if (event.event === 'charge.success') {
      const txData = event.data;
      const meta = txData.metadata || {};
      const userId = meta.userId;
      const tier = meta.tier;

      if (userId && tier) {
        const existingTx = await adminDb
          .collection('transactions')
          .where('paystackReference', '==', txData.reference)
          .limit(1)
          .get();

        if (existingTx.empty) {
          await applySuccessfulPayment(userId, tier, txData);
          console.log(`Webhook: applied payment for user ${userId}, tier ${tier}`);
        } else {
          console.log(`Webhook: payment ${txData.reference} already processed`);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook error:', err);
    res.sendStatus(200);
  }
});

async function applySuccessfulPayment(userId, tier, txData) {
  const mapping = PLAN_CREDIT_MAP[tier];
  if (!mapping) throw new Error(`Unknown tier: ${tier}`);

  const userRef = adminDb.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const currentCredits = userSnap.exists ? (userSnap.data()?.credits ?? 0) : 0;

  const isUnlimited = mapping.credits === -1;
  const newCredits = isUnlimited ? -1 : currentCredits + mapping.credits;

  const now = new Date();
  const renewDate = new Date(now);
  renewDate.setMonth(renewDate.getMonth() + 1);

  await userRef.update({
    plan: mapping.plan,
    credits: newCredits,
    creditsUsedThisMonth: 0,
    billingRenewDate: renewDate,
    paystackCustomerId: txData.customer?.customer_code || null,
  });

  await adminDb.collection('transactions').add({
    userId,
    paystackReference: txData.reference,
    amountPaid: txData.amount / 100,
    currency: txData.currency || 'USD',
    creditsAdded: mapping.credits,
    plan: tier,
    status: 'success',
    paystackTransactionId: txData.id,
    paystackChannel: txData.channel || null,
    createdAt: now,
  });
}

// ─── Server start ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`SonicPure API server on http://localhost:${PORT} (visit in browser to check)`);
  if (!process.env.CLEANVOICE_API_KEY) {
    console.warn('WARNING: CLEANVOICE_API_KEY not set in server/.env - audio processing will fail');
  }
  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('YOUR_SECRET_KEY')) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY not set - payments will not work');
  }
});
