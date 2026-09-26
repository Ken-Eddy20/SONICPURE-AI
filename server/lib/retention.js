/**
 * Deletes working files once their time is up. Nothing here is backed up.
 *
 * - audioFiles.originalDeleteAt: the uncleaned upload (kept briefly for before/after).
 * - audioFiles.deleteAt: every copy of the file. Text (transcript, AI notes) stays.
 * - recordings.deleteAt: Recorder saves (the doc is removed too).
 * - captionJobs.deleteAt: the captioned video.
 * - meetings.audioDeleteAt: the meeting's speech audio; the transcript and minutes stay.
 *
 * Only these new fields are used. The legacy `expiresAt` on older docs is ignored on purpose,
 * because it was always set to 24 hours and never enforced.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { cloudinary } from '../../lib/cloudinary.js';
import { ORIGINAL_KEEP_HOURS, UNUSED_UPLOAD_DAYS, WORKING_SPACE_HOURS, workingFileDays } from '../../shared/processing.js';
import { HttpError, diskLog, formatError } from './http.js';
import { resolveAccount } from './accounts.js';

const HOUR = 3600 * 1000;
const BATCH = 100;
const RUNNING = ['uploading', 'processing', 'finalizing'];

export const workingDeleteAt = (plan, from = new Date()) => new Date(from.getTime() + workingFileDays(plan) * 24 * HOUR);
/** When a finished working file of this user should go (their plan decides 7 or 30 days). */
export async function deleteAtFor(userId, from = new Date()) {
  const plan = await resolveAccount(userId).then((a) => a.plan).catch(() => 'free');
  return workingDeleteAt(plan, from);
}

/** Uploads that are never cleaned or published, and failed uploads, go sooner. */
export const unusedDeleteAt = (from = new Date()) => new Date(from.getTime() + UNUSED_UPLOAD_DAYS * 24 * HOUR);

const spaceLimitHours = (account) =>
  account.kind === 'show' ? WORKING_SPACE_HOURS.team : account.plan === 'free' ? WORKING_SPACE_HOURS.free : WORKING_SPACE_HOURS.paid;

/**
 * Refuse a new upload when the account already holds its working-space limit of audio
 * (uploads and cleaned files still stored; published episodes do not count).
 */
export async function assertWorkingSpace(account, addSeconds) {
  const limitHours = spaceLimitHours(account);
  const q = account.kind === 'show'
    ? adminDb.collection('audioFiles').where('showId', '==', account.showId)
    : adminDb.collection('audioFiles').where('userId', '==', account.userRef.id);
  const snap = await q.get();
  const usedSeconds = snap.docs.reduce((sum, d) => {
    const f = d.data();
    if (f.status === 'expired' || (account.kind !== 'show' && f.showId)) return sum;
    return sum + Number(f.processedDurationSeconds || f.durationSeconds || 0);
  }, 0);
  if (usedSeconds + Number(addSeconds || 0) > limitHours * 3600) {
    const used = usedSeconds / 3600;
    throw new HttpError(
      409,
      `Your working space is full: ${used < 10 ? used.toFixed(1) : Math.round(used)} of ${limitHours} hours of files are waiting. Download, publish or delete finished files to make room.`,
      { code: 'WORKING_SPACE_FULL' },
    );
  }
}

export const originalDeleteAt = (from = new Date()) => new Date(from.getTime() + ORIGINAL_KEEP_HOURS * HOUR);

async function destroy(publicId, resourceType = 'video') {
  if (!publicId) return;
  const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  if (res?.result !== 'ok' && res?.result !== 'not found') throw new Error(`Cloudinary could not delete ${publicId}: ${res?.result}`);
}

const due = (collection, field, now) => adminDb.collection(collection).where(field, '<=', now).limit(BATCH).get();

export async function sweepExpired(now = new Date()) {
  const counts = { originals: 0, files: 0, recordings: 0, captions: 0, meetings: 0 };

  // 1. Originals: only once cleaning is finished (Cleanvoice reads the original while it works).
  for (const doc of (await due('audioFiles', 'originalDeleteAt', now)).docs) {
    const d = doc.data();
    if (RUNNING.includes(d.status)) continue;
    await destroy(d.originalPublicId);
    await destroy(d.extractedPublicId);
    await doc.ref.update({
      originalFileUrl: null, originalPublicId: null, extractedAudioUrl: null, extractedPublicId: null,
      originalRemoved: true, originalDeleteAt: FieldValue.delete(),
    });
    counts.originals++;
  }

  // 2. Whole working files.
  for (const doc of (await due('audioFiles', 'deleteAt', now)).docs) {
    const d = doc.data();
    if (RUNNING.includes(d.status)) continue;
    for (const id of [d.originalPublicId, d.extractedPublicId, d.processedPublicId]) await destroy(id);
    await doc.ref.update({
      status: 'expired', stage: null,
      originalFileUrl: null, originalPublicId: null, extractedAudioUrl: null, extractedPublicId: null,
      processedFileUrl: null, processedPublicId: null,
      originalRemoved: true, deletedAt: now,
      deleteAt: FieldValue.delete(), originalDeleteAt: FieldValue.delete(),
    });
    counts.files++;
  }

  // 3. Recorder saves.
  for (const doc of (await due('recordings', 'deleteAt', now)).docs) {
    const d = doc.data();
    await destroy(d.publicId);
    await destroy(d.coverPublicId, 'image');
    await doc.ref.delete();
    counts.recordings++;
  }

  // 4. Captioned videos.
  for (const doc of (await due('captionJobs', 'deleteAt', now)).docs) {
    const d = doc.data();
    if (RUNNING.includes(d.status) || d.status === 'queued') continue;
    await destroy(d.outputPublicId);
    await doc.ref.update({ status: 'expired', outputUrl: null, outputPublicId: null, deleteAt: FieldValue.delete() });
    counts.captions++;
  }

  // 5. Meeting audio (the text stays).
  for (const doc of (await due('meetings', 'audioDeleteAt', now)).docs) {
    const d = doc.data();
    if (RUNNING.includes(d.status)) continue;
    await destroy(d.audioPublicId);
    await doc.ref.update({ audioUrl: null, audioPublicId: null, audioDeleteAt: FieldValue.delete() });
    counts.meetings++;
  }

  return counts;
}

/** Run now and then every 30 minutes. */
export function startRetentionSweeper() {
  const run = () =>
    sweepExpired()
      .then((c) => {
        const total = Object.values(c).reduce((a, b) => a + b, 0);
        if (total) diskLog(`[Retention] deleted ${JSON.stringify(c)}`);
      })
      .catch((err) => diskLog('[Retention] failed: ' + formatError(err)));
  run();
  return setInterval(run, 30 * 60 * 1000);
}
