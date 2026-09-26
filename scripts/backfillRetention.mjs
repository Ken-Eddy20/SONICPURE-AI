/**
 * Give files created before automatic deletion existed a delete date, so they stop being
 * stored forever. Nothing is deleted by this script: it only sets dates (7 days on free,
 * 30 on paid, counted from today; originals of cleaned files in 24 hours). The server's
 * retention sweeper deletes them when the dates pass.
 *
 *   node scripts/backfillRetention.mjs           # preview counts only
 *   node scripts/backfillRetention.mjs --apply   # write the dates
 */
import '../server/env.js';
import { adminDb } from '../lib/firebaseAdmin.js';
import { originalDeleteAt, workingDeleteAt } from '../server/lib/retention.js';
import { resolveAccount } from '../server/lib/accounts.js';

const apply = process.argv.includes('--apply');
const planCache = new Map();
const planOf = async (uid) => {
  if (!uid) return 'free';
  if (!planCache.has(uid)) planCache.set(uid, await resolveAccount(uid).then((a) => a.plan).catch(() => 'free'));
  return planCache.get(uid);
};

const counts = { audioFiles: 0, originals: 0, recordings: 0, captionJobs: 0, meetings: 0 };
let batch = adminDb.batch();
let pending = 0;
const write = async (ref, data) => {
  if (!apply) return;
  batch.update(ref, data);
  if (++pending >= 400) {
    await batch.commit();
    batch = adminDb.batch();
    pending = 0;
  }
};

for (const d of (await adminDb.collection('audioFiles').get()).docs) {
  const f = d.data();
  if (f.deleteAt || f.status === 'expired' || ['uploading', 'processing', 'finalizing'].includes(f.status)) continue;
  const data = { deleteAt: workingDeleteAt(await planOf(f.userId)) };
  if (f.status === 'processed' && f.originalPublicId && !f.originalRemoved) {
    data.originalDeleteAt = originalDeleteAt();
    counts.originals++;
  }
  counts.audioFiles++;
  await write(d.ref, data);
}
for (const d of (await adminDb.collection('recordings').get()).docs) {
  if (d.data().deleteAt) continue;
  counts.recordings++;
  await write(d.ref, { deleteAt: workingDeleteAt(await planOf(d.data().userId)) });
}
for (const d of (await adminDb.collection('captionJobs').where('status', '==', 'done').get()).docs) {
  if (d.data().deleteAt || !d.data().outputPublicId) continue;
  counts.captionJobs++;
  await write(d.ref, { deleteAt: workingDeleteAt(await planOf(d.data().userId)) });
}
for (const d of (await adminDb.collection('meetings').where('status', '==', 'done').get()).docs) {
  if (d.data().audioDeleteAt || !d.data().audioPublicId) continue;
  counts.meetings++;
  await write(d.ref, { audioDeleteAt: workingDeleteAt(await planOf(d.data().userId)) });
}
if (apply && pending) await batch.commit();

console.log(`${apply ? 'Scheduled' : 'Would schedule'} for deletion:`, counts);
if (!apply) console.log('Nothing was changed. Run with --apply to write the dates.');
process.exit(0);
