/**
 * Burned-in video captions. Uses a finished transcript (original or translated text),
 * renders it onto the video with ffmpeg and stores the result in Cloudinary.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { uploadVideoFile } from '../../lib/cloudinary.js';
import { HttpError, route, verifyAuth, diskLog, formatError, iso } from '../lib/http.js';
import { chargeAndCreate, getAccessibleFile, refundJob } from '../lib/accounts.js';
import { makeWorkDir, cleanupDir, downloadTo, probe, burnCaptions } from '../lib/media.js';
import { buildAss } from '../lib/captions.js';
import {
  CAPTION_MAX_MINUTES,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  CAPTION_STYLES,
  estimateCaptionCredits,
} from '../../shared/processing.js';

const captionJobs = () => adminDb.collection('captionJobs');

/** The video whose timeline matches transcripts of this file (see transcripts.timelineSource). */
function videoFor(file, timeline) {
  if (timeline === 'processed') return file.processedIsVideo ? file.processedFileUrl : null;
  return file.originalFileUrl;
}

export function serializeCaptionJob(id, j) {
  return {
    id,
    fileId: j.fileId,
    transcriptId: j.transcriptId,
    useTranslation: Boolean(j.useTranslation),
    style: j.style,
    position: j.position,
    size: j.size,
    status: j.status,
    stage: j.stage || null,
    percent: j.percent ?? null,
    outputUrl: j.outputUrl || null,
    creditsUsed: j.creditsUsed || 0,
    error: j.error || null,
    createdAt: iso(j.createdAt),
  };
}

async function runCaptions(ref) {
  const job = (await ref.get()).data();
  const file = (await adminDb.collection('audioFiles').doc(job.fileId).get()).data();
  const transcript = (await adminDb.collection('transcripts').doc(job.transcriptId).get()).data();
  const dir = makeWorkDir('cap');
  const update = (fields) => ref.update(fields).catch(() => {});
  try {
    await update({ status: 'processing', stage: 'Downloading video', percent: 3 });
    const videoUrl = videoFor(file, transcript.timeline);
    const ext = path.extname(new URL(videoUrl).pathname) || '.mp4';
    await downloadTo(videoUrl, path.join(dir, `in${ext}`));
    const info = await probe(path.join(dir, `in${ext}`));
    if (!info.width) throw new Error('Could not read the video. Try re-uploading it as MP4.');

    const segments = job.useTranslation ? transcript.translation?.segments : transcript.segments;
    if (!segments?.length) throw new Error('This transcript has no text to caption.');
    fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss(segments, info, job));

    await update({ stage: 'Adding captions', percent: 8 });
    let lastReport = 0;
    const out = await burnCaptions(dir, `in${ext}`, (seconds) => {
      const now = Date.now();
      if (info.duration && now - lastReport > 4000) {
        lastReport = now;
        update({ percent: Math.min(90, 8 + Math.round((seconds / info.duration) * 82)) });
      }
    });

    await update({ stage: 'Saving video', percent: 93 });
    const saved = await uploadVideoFile(out, file.userId);
    await ref.update({
      status: 'done',
      stage: 'Done',
      percent: 100,
      outputUrl: saved.secure_url,
      outputPublicId: saved.public_id,
      completedAt: new Date(),
    });
    diskLog(`[Captions] ${ref.id} done`);
  } catch (err) {
    diskLog(`[Captions] ${ref.id} failed: ${formatError(err)}`);
    await refundJob(ref, formatError(err));
  } finally {
    cleanupDir(dir);
  }
}

export default function captionsRouter({ limiter }) {
  const router = express.Router();

  router.post('/', limiter, route('Could not start captions', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { transcriptId, useTranslation, style, position, size } = req.body || {};
    if (!CAPTION_STYLES[style] || !CAPTION_POSITIONS.includes(position) || !CAPTION_SIZES.includes(size)) {
      throw new HttpError(400, 'Choose a caption style, position and size.');
    }
    const tSnap = await adminDb.collection('transcripts').doc(String(transcriptId || '-')).get();
    if (!tSnap.exists) throw new HttpError(404, 'Transcript not found');
    const transcript = tSnap.data();
    if (transcript.status !== 'done') throw new HttpError(409, 'Wait for the transcript to finish first.');
    if (useTranslation && !transcript.translation) throw new HttpError(400, 'This transcript has no translation.');

    const { data: file } = await getAccessibleFile(transcript.fileId, uid);
    if (file.sourceType !== 'video') throw new HttpError(400, 'Captions can only be added to video files.');
    if (!videoFor(file, transcript.timeline)) {
      throw new HttpError(400, 'This transcript was made from the cleaned audio. Make a new transcript for this video.');
    }
    if ((file.durationSeconds || 0) / 60 > CAPTION_MAX_MINUTES) {
      throw new HttpError(400, `Captions work on videos up to ${CAPTION_MAX_MINUTES} minutes.`);
    }

    const cost = estimateCaptionCredits(file.durationSeconds);
    const ref = captionJobs().doc();
    await chargeAndCreate(uid, cost, ref, {
      userId: uid,
      fileId: transcript.fileId,
      transcriptId: tSnap.id,
      useTranslation: Boolean(useTranslation),
      style,
      position,
      size,
      status: 'queued',
      stage: 'Queued',
      percent: 1,
      createdAt: new Date(),
    });
    runCaptions(ref);
    res.status(202).json({ id: ref.id, creditsUsed: cost });
  }));

  router.get('/', route('Could not load captions', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { fileId } = req.query;
    if (!fileId) throw new HttpError(400, 'fileId is required');
    await getAccessibleFile(String(fileId), uid);
    const snap = await captionJobs().where('fileId', '==', String(fileId)).get();
    const items = snap.docs
      .map((d) => serializeCaptionJob(d.id, d.data()))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ captions: items });
  }));

  router.get('/:id', route('Could not load caption job', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const snap = await captionJobs().doc(req.params.id).get();
    if (!snap.exists) throw new HttpError(404, 'Caption job not found');
    await getAccessibleFile(snap.data().fileId, uid);
    res.json(serializeCaptionJob(snap.id, snap.data()));
  }));

  return router;
}
