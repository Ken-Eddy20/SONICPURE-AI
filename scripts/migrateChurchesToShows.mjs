/**
 * One-off migration: churches → shows (type "church"), sermons → episodes,
 * and churchId → showId on users, audioFiles, recordings, meetings, transcripts
 * and captionJobs. Safe to run more than once. Run: node scripts/migrateChurchesToShows.mjs
 */
import '../server/env.js';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../lib/firebaseAdmin.js';

const log = (...a) => console.log(...a);
let moved = 0;

for (const c of (await adminDb.collection('churches').get()).docs) {
  const data = c.data();
  const showRef = adminDb.collection('shows').doc(c.id);
  if (!(await showRef.get()).exists) {
    await showRef.set({ ...data, type: data.type || 'church' });
    for (const m of (await c.ref.collection('members').get()).docs) await showRef.collection('members').doc(m.id).set(m.data());
    log(`show ${c.id} created from church "${data.name}"`);
  }
  // Verify before deleting the original.
  const copiedMembers = (await showRef.collection('members').get()).size;
  const originalMembers = (await c.ref.collection('members').get()).size;
  if (copiedMembers !== originalMembers) throw new Error(`member copy mismatch for ${c.id}`);
  for (const m of (await c.ref.collection('members').get()).docs) await m.ref.delete();
  await c.ref.delete();
  moved++;
}

for (const s of (await adminDb.collection('sermons').get()).docs) {
  const d = s.data();
  await adminDb.collection('episodes').doc(s.id).set({
    showId: d.churchId, createdBy: d.createdBy, fileId: d.fileId, title: d.title, speaker: d.preacher || '', guests: '',
    series: d.series || '', reference: d.scripture || '', season: null, episode: null, date: d.date || '',
    description: d.description || '', status: d.status, createdAt: d.createdAt, publishedAt: d.publishedAt || null,
  });
  await s.ref.delete();
  log(`sermon ${s.id} → episode`);
}

for (const col of ['users', 'audioFiles', 'recordings', 'meetings', 'transcripts', 'captionJobs']) {
  const snap = await adminDb.collection(col).where('churchId', '!=', null).get();
  for (const d of snap.docs) {
    await d.ref.update({ showId: d.data().churchId, churchId: FieldValue.delete() });
    log(`${col}/${d.id}: churchId → showId`);
  }
  // Refund targets on unfinished jobs.
  if (col !== 'users') {
    const billed = await adminDb.collection(col).where('billedTo.kind', '==', 'church').get();
    for (const d of billed.docs) await d.ref.update({ 'billedTo.kind': 'show' });
  }
}

log(`\nDone. ${moved} church account(s) moved to shows.`);
process.exit(0);
