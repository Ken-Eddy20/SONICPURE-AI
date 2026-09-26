/**
 * Recorder library: finished recordings (edited and tagged in the browser) saved to the
 * cloud so they can be shared by link, and handed to the paid AI cleaning / sermon flow.
 */
import express from 'express';
import multer from 'multer';
import { parseBuffer } from 'music-metadata';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { cloudinary } from '../../lib/cloudinary.js';
import { HttpError, route, verifyAuth, iso, diskLog } from '../lib/http.js';
import { resolveAccount } from '../lib/accounts.js';
import { FREE_RECORDING_LIMIT } from '../../shared/processing.js';

const recordings = () => adminDb.collection('recordings');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 150 * 1024 * 1024, files: 2 } });

const META_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'composer', 'genre', 'year', 'track', 'comment'];

function cleanMeta(raw) {
  let src = {};
  try {
    src = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } catch {
    src = {};
  }
  return Object.fromEntries(META_FIELDS.map((k) => [k, String(src[k] ?? '').trim().slice(0, k === 'comment' ? 1000 : 150)]));
}

function uploadStream(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => (err ? reject(err) : resolve(result)));
    stream.end(buffer);
  });
}

function serialize(id, r) {
  return {
    id,
    title: r.meta?.title || 'Untitled recording',
    meta: r.meta || {},
    audioUrl: r.audioUrl,
    coverUrl: r.coverUrl || null,
    bytes: r.bytes || 0,
    durationSeconds: r.durationSeconds || 0,
    createdAt: iso(r.createdAt),
  };
}

/** Free users (no paid plan, no active podcast or church plan) keep a limited library. */
const isFreeTier = (account) => account.plan === 'free';

export default function recordingsRouter({ limiter }) {
  const router = express.Router();

  router.get('/', route('Could not load recordings', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const account = await resolveAccount(uid);
    const snap = await recordings().where('userId', '==', uid).get();
    const list = snap.docs.map((d) => serialize(d.id, d.data())).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ recordings: list, limit: isFreeTier(account) ? FREE_RECORDING_LIMIT : null });
  }));

  router.post(
    '/',
    limiter,
    upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
    route('Could not save the recording', async (req, res) => {
      const { uid } = await verifyAuth(req);
      const audio = req.files?.audio?.[0];
      const cover = req.files?.cover?.[0];
      if (!audio) throw new HttpError(400, 'No audio received.');
      if (!/mpeg|mp3/.test(audio.mimetype)) throw new HttpError(400, 'Recordings are saved as MP3.');
      if (cover && !/^image\/(jpeg|png|webp)$/.test(cover.mimetype)) throw new HttpError(400, 'Cover art must be a JPG, PNG or WebP image.');

      const account = await resolveAccount(uid);
      if (isFreeTier(account)) {
        const count = (await recordings().where('userId', '==', uid).count().get()).data().count;
        if (count >= FREE_RECORDING_LIMIT) {
          throw new HttpError(403, `The free plan keeps ${FREE_RECORDING_LIMIT} recordings in your library. Delete one, download it instead, or upgrade.`, { upgrade: true });
        }
      }

      let durationSeconds = 0;
      try {
        durationSeconds = (await parseBuffer(audio.buffer, { mimeType: 'audio/mpeg' })).format.duration || 0;
      } catch {
        durationSeconds = 0;
      }
      const meta = cleanMeta(req.body.meta);
      const folder = `sonicpure/users/${uid}/recordings`;
      const saved = await uploadStream(audio.buffer, { resource_type: 'video', folder, format: 'mp3' });
      let coverSaved = null;
      if (cover) {
        coverSaved = await uploadStream(cover.buffer, {
          resource_type: 'image',
          folder,
          format: 'jpg',
          transformation: [{ width: 1400, height: 1400, crop: 'fill', gravity: 'auto' }],
        });
      }

      const ref = recordings().doc();
      await ref.set({
        userId: uid,
        showId: account.showId || null,
        meta,
        audioUrl: saved.secure_url,
        publicId: saved.public_id,
        coverUrl: coverSaved?.secure_url || null,
        coverPublicId: coverSaved?.public_id || null,
        bytes: audio.size,
        durationSeconds,
        createdAt: new Date(),
      });
      diskLog(`[Recorder] saved ${ref.id} (${Math.round(durationSeconds)}s) for ${uid}`);
      res.status(201).json(serialize(ref.id, (await ref.get()).data()));
    }),
  );

  router.patch('/:id', route('Could not update', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = recordings().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== uid) throw new HttpError(404, 'Recording not found');
    await ref.update({ meta: cleanMeta({ ...snap.data().meta, ...(req.body?.meta || {}) }) });
    res.json({ success: true });
  }));

  router.delete('/:id', route('Could not delete', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const ref = recordings().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== uid) throw new HttpError(404, 'Recording not found');
    const r = snap.data();
    if (r.publicId) await cloudinary.uploader.destroy(r.publicId, { resource_type: 'video', invalidate: true }).catch(() => {});
    if (r.coverPublicId) await cloudinary.uploader.destroy(r.coverPublicId, { resource_type: 'image', invalidate: true }).catch(() => {});
    await ref.delete();
    res.json({ success: true });
  }));

  /**
   * Paid: hand a saved recording to AI cleaning (Studio) or the Sermon Studio without
   * re-uploading. Creates an audioFiles entry pointing at the same stored MP3.
   */
  router.post('/:id/studio', limiter, route('Could not send to cleaning', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const snap = await recordings().doc(req.params.id).get();
    if (!snap.exists || snap.data().userId !== uid) throw new HttpError(404, 'Recording not found');
    const account = await resolveAccount(uid);
    if (isFreeTier(account)) {
      throw new HttpError(403, 'AI cleaning is a paid feature. Buy credits or upgrade to use it.', { upgrade: true });
    }
    const r = snap.data();
    const now = new Date();
    const fileRef = await adminDb.collection('audioFiles').add({
      userId: uid,
      showId: account.kind === 'show' ? account.showId : null,
      originalFileName: `${r.meta?.title || 'Recording'}.mp3`,
      originalFileUrl: r.audioUrl,
      // Owned by the recording; deleting the studio copy must not delete the library file.
      originalPublicId: null,
      originalExt: '.mp3',
      processedFileUrl: null,
      processedPublicId: null,
      extractedAudioUrl: null,
      extractedPublicId: null,
      sourceType: 'audio',
      feature: null,
      fileSizeMB: parseFloat(((r.bytes || 0) / (1024 * 1024)).toFixed(2)),
      durationSeconds: r.durationSeconds || 0,
      recordingId: snap.id,
      status: 'uploaded',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    });
    res.status(201).json({ fileId: fileRef.id, durationSeconds: r.durationSeconds || 0 });
  }));

  return router;
}
