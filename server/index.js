/**
 * Backend API - Proxies audio processing to Audo AI
 * Keeps the API key server-side only
 */
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminAuth, adminDb } from '../lib/firebaseAdmin.js';
import { uploadAudio, saveProcessedAudio, saveExtractedAudio, deleteAudio } from '../lib/cloudinary.js';
import { extractAudioFromVideo } from '../lib/extractAudio.js';
import { parseBuffer } from 'music-metadata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const AUDO_API_BASE = 'https://api.audo.ai/v1';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.webm'];

const app = express();
app.use(cors({ origin: true }));
app.use((req, res, next) => {
  if (req.path === '/api/paystack/webhook') return next();
  express.json()(req, res, next);
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 60 * 1024 * 1024 } }); // 60MB

function getApiKey() {
  const key = process.env.AUDO_API_KEY;
  if (!key) {
    throw new Error('AUDO_API_KEY not set in server/.env');
  }
  return key;
}

async function pollUntilSucceeded(jobId) {
  const apiKey = getApiKey();
  const maxAttempts = 120;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const res = await fetch(`${AUDO_API_BASE}/remove-noise/${jobId}/status`, {
      headers: { 'x-api-key': apiKey },
    });
    const data = await res.json();

    if (data.state === 'succeeded' && data.downloadPath) {
      return data.downloadPath;
    }
    if (data.state === 'failed') {
      throw new Error(data.reason || 'Audo AI processing failed. Check your API key in server/.env');
    }

    await new Promise((r) => setTimeout(r, 1000));
    attempts++;
  }
  throw new Error('Processing timed out');
}

app.get('/', (req, res) => {
  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (acceptsHtml) {
    res.send(`<!DOCTYPE html><html><head><title>SonicPure API</title></head><body style="font-family:sans-serif;padding:2rem">
      <h1>SonicPure API is running</h1>
      <p>Use the main app at <a href="http://localhost:3000">http://localhost:3000</a></p>
      <p><strong>Endpoints:</strong> POST /api/process-audio</p>
    </body></html>`);
  } else {
    res.json({ status: 'ok', message: 'SonicPure API is running', endpoints: ['POST /api/process-audio'] });
  }
});

app.get('/api', (req, res) => {
  res.json({ status: 'ok', message: 'SonicPure API', endpoints: { 'POST /api/process-audio': 'Process audio for noise removal' } });
});

app.post('/api/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const apiKey = getApiKey();
    const options = req.body.options ? JSON.parse(req.body.options) : {};
    const intensity = Math.min(100, Math.max(0, options.intensity ?? 50));
    const noiseReductionAmount = String(Math.round(intensity));

    // 1. Upload to Audo
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' });
    formData.append('file', blob, req.file.originalname || 'audio.wav');

    const uploadRes = await fetch(`${AUDO_API_BASE}/upload`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: formData,
    });

    const uploadText = await uploadRes.text();
    if (!uploadRes.ok) {
      let msg = uploadRes.statusText;
      try {
        const parsed = JSON.parse(uploadText);
        msg = parsed.detail || parsed.message || parsed.error || uploadText;
      } catch {
        msg = uploadText || uploadRes.statusText;
      }
      throw new Error(msg);
    }
    let uploadData;
    try {
      uploadData = JSON.parse(uploadText);
    } catch {
      throw new Error('Invalid response from Audo upload');
    }
    const { fileId } = uploadData;
    if (!fileId) throw new Error('No fileId from Audo');

    // 2. Submit remove-noise
    const body = {
      input: fileId,
      outputExtension: 'wav',
      noiseReductionAmount,
    };
    if (options.autoBalance) body.autoBalance = true;
    if (options.autoGain) body.autoGain = true;
    if (options.dereverberation) body.dereverberation = true;
    if (options.audioRestoration) body.audioRestoration = true;

    const removeRes = await fetch(`${AUDO_API_BASE}/remove-noise`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const removeText = await removeRes.text();
    if (!removeRes.ok) {
      let msg = removeRes.statusText;
      try {
        const parsed = JSON.parse(removeText);
        msg = parsed.detail || parsed.message || parsed.error || removeText;
      } catch {
        msg = removeText || removeRes.statusText;
      }
      throw new Error(msg);
    }
    let removeData;
    try {
      removeData = JSON.parse(removeText);
    } catch {
      throw new Error('Invalid response from Audo remove-noise');
    }
    const { jobId } = removeData;
    if (!jobId) throw new Error('No jobId from Audo');

    // 3. Poll until done
    const downloadPath = await pollUntilSucceeded(jobId);

    // 4. Download from Audo
    const downloadRes = await fetch(`${AUDO_API_BASE}/${downloadPath}`, {
      headers: { 'x-api-key': apiKey },
    });

    if (!downloadRes.ok) {
      throw new Error(`Download failed: ${downloadRes.statusText}`);
    }

    const buffer = await downloadRes.arrayBuffer();

    res.setHeader('Content-Type', 'audio/wav');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Process audio error:', err);
    res.status(500).json({ error: err.message || 'Processing failed' });
  }
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

app.post('/api/audio/upload', upload.single('audio'), async (req, res) => {
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
    const isVideo = VIDEO_EXTENSIONS.includes(ext);
    const isAudio = AUDIO_EXTENSIONS.includes(ext) || req.file.mimetype?.startsWith('audio/');
    if (!isVideo && !isAudio) {
      return res.status(400).json({ error: 'Unsupported file type. Please upload an audio or video file.' });
    }

    // ── Video extraction gate ──
    if (isVideo && !planData.extractAudioFromVideo) {
      return res.status(403).json({
        error: 'Video uploads are not available on your plan. Upgrade to Pro or Unlimited.',
      });
    }

    // ── Daily limit check (query usageLogs for today) ──
    const maxDaily = planData.maxDailyEnhances ?? -1;
    if (maxDaily !== -1) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const logsSnap = await adminDb
        .collection('usageLogs')
        .where('userId', '==', userId)
        .where('createdAt', '>=', todayStart)
        .get();

      if (logsSnap.size >= maxDaily) {
        return res.status(429).json({
          error: `You have reached your daily upload limit (${maxDaily}/day). Upgrade your plan for unlimited uploads.`,
        });
      }
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

    // ── Create usageLogs entry ──
    await adminDb.collection('usageLogs').add({
      userId,
      feature,
      fileName: req.file.originalname || 'audio.wav',
      fileDurationSeconds: durationSeconds,
      creditsUsed: 0,
      status: 'processing',
      createdAt: now,
    });

    // ── Increment daily counter on user doc ──
    await adminDb.collection('users').doc(userId).update({
      dailyEnhancesUsed: (userData.dailyEnhancesUsed || 0) + 1,
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

// ─── Paystack Integration ─────────────────────────────────────────

const PAYSTACK_BASE = 'https://api.paystack.co';

const PLAN_CREDIT_MAP = {
  payg:      { credits: 150, plan: 'payg' },
  pro:       { credits: 2500, plan: 'pro' },
  unlimited: { credits: -1, plan: 'unlimited' },
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

app.post('/api/paystack/initialize', async (req, res) => {
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
    const amountInCents = planData.price * 100;

    const reference = `sp_${tier}_${userId.slice(0, 8)}_${Date.now()}`;

    const txPayload = {
      email: userData.email,
      amount: amountInCents,
      currency: 'USD',
      reference,
      channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
      metadata: {
        userId,
        tier,
        creditsToAdd: PLAN_CREDIT_MAP[tier].credits,
        planToSet: PLAN_CREDIT_MAP[tier].plan,
        custom_fields: [
          { display_name: 'Plan', variable_name: 'plan', value: planData.name },
          { display_name: 'User', variable_name: 'user_email', value: userData.email },
        ],
      },
      callback_url: req.body.callbackUrl || undefined,
    };

    if (process.env.PAYSTACK_SUBACCOUNT_CODE) {
      txPayload.subaccount = process.env.PAYSTACK_SUBACCOUNT_CODE;
    }

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

app.get('/api/paystack/verify/:reference', async (req, res) => {
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
  if (!process.env.AUDO_API_KEY) {
    console.warn('WARNING: AUDO_API_KEY not set in server/.env - audio processing will fail');
  }
  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('YOUR_SECRET_KEY')) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY not set - payments will not work');
  }
});
