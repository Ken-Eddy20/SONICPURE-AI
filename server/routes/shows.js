/**
 * Shows: one engine for podcasts and churches. A show has a shared credit pool, a small
 * team, episodes (sermons for churches: cleaned audio + AI notes) and a public podcast feed.
 * The show's `type` only changes wording and defaults in the app.
 */
import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { uploadArtwork } from '../../lib/cloudinary.js';
import { HttpError, route, verifyAuth, iso } from '../lib/http.js';
import { getAccessibleFile } from '../lib/accounts.js';
import { buildPodcastFeed } from '../lib/podcast.js';
import { PODCAST_CATEGORIES, SHOW_TYPE_IDS, isShowPlan, showMaxMembers, showType } from '../../shared/processing.js';

const shows = () => adminDb.collection('shows');
const episodes = () => adminDb.collection('episodes');
const users = () => adminDb.collection('users');

const artworkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const newInviteCode = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');
const PODCAST_LANGUAGES = ['en', 'tw', 'ak', 'ee', 'gaa', 'ha', 'fr'];
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 10000 ? Number(v) : null);

/** Load the caller's show and their role in it. */
async function myShow(uid, { requireOwner = false } = {}) {
  const user = (await users().doc(uid).get()).data();
  if (!user?.showId) throw new HttpError(404, 'You are not part of a podcast or church account yet.');
  const ref = shows().doc(user.showId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Show not found.');
  const show = snap.data();
  const role = show.ownerId === uid ? 'owner' : 'editor';
  if (requireOwner && role !== 'owner') throw new HttpError(403, 'Only the account owner can do this.');
  return { ref, show, role, user };
}

function serializeShow(id, s, role, feedUrl) {
  return {
    id,
    name: s.name,
    type: s.type || 'podcast',
    plan: s.plan,
    active: isShowPlan(s.plan),
    credits: Number(s.credits || 0),
    creditsUsedThisMonth: Number(s.creditsUsedThisMonth || 0),
    billingRenewDate: iso(s.billingRenewDate),
    memberCount: (s.memberIds || []).length,
    maxMembers: showMaxMembers(s.plan),
    inviteCode: s.inviteCode,
    role,
    podcast: s.podcast || {},
    feedUrl,
  };
}

function episodeView(id, e, file) {
  return {
    id,
    fileId: e.fileId,
    title: e.title,
    speaker: e.speaker || '',
    guests: e.guests || '',
    series: e.series || '',
    reference: e.reference || '',
    season: e.season ?? null,
    episode: e.episode ?? null,
    date: e.date || '',
    description: e.description || '',
    status: e.status,
    createdAt: iso(e.createdAt),
    publishedAt: iso(e.publishedAt),
    file: file
      ? {
          status: file.status === 'finalizing' ? 'processing' : file.status === 'uploading' ? 'uploaded' : file.status,
          stage: file.stage || null,
          percent: file.percent ?? null,
          durationSeconds: file.durationSeconds || 0,
          processedFileUrl: file.processedFileUrl || null,
          summaryTitle: file.summary?.title || null,
          error: file.error || null,
        }
      : null,
  };
}

function episodeFields(b, { partial }) {
  const out = {};
  const text = [['title', 150], ['speaker', 100], ['guests', 200], ['series', 100], ['reference', 150], ['description', 3000]];
  for (const [key, max] of text) if (!partial || b[key] !== undefined) out[key] = clean(b[key], max);
  for (const key of ['season', 'episode']) if (!partial || b[key] !== undefined) out[key] = posInt(b[key]);
  if (!partial || b.date !== undefined) {
    out.date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : partial ? undefined : new Date().toISOString().slice(0, 10);
    if (out.date === undefined) delete out.date;
  }
  return out;
}

function podcastSettings(p, show) {
  const type = showType(show.type);
  const category = Object.hasOwn(PODCAST_CATEGORIES, p.category) ? p.category : show.podcast?.category || type.category;
  const subs = PODCAST_CATEGORIES[category] || [];
  const email = clean(p.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid contact email.');
  return {
    ...(show.podcast || {}),
    title: clean(p.title, 120) || show.name,
    author: clean(p.author, 120) || show.name,
    description: clean(p.description, 3500),
    language: PODCAST_LANGUAGES.includes(p.language) ? p.language : 'en',
    category,
    subcategory: subs.includes(p.subcategory) ? p.subcategory : '',
    explicit: Boolean(p.explicit),
    email,
  };
}

export default function showsRouter({ publicBaseUrl, siteUrl, serializeFile }) {
  const router = express.Router();
  const feedUrlFor = (req, id) => `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}/feeds/show/${id}.xml`;

  // ── Show account ────────────────────────────────────────────

  router.get('/', route('Could not load your show', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const user = (await users().doc(uid).get()).data();
    if (!user?.showId) return res.json({ show: null });
    const snap = await shows().doc(user.showId).get();
    if (!snap.exists) return res.json({ show: null });
    const s = snap.data();
    const membersSnap = await snap.ref.collection('members').get();
    const members = membersSnap.docs
      .map((d) => ({ uid: d.id, email: d.data().email || '', displayName: d.data().displayName || '', role: d.data().role, joinedAt: iso(d.data().joinedAt) }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.joinedAt || '').localeCompare(b.joinedAt || '')));
    res.json({ show: serializeShow(snap.id, s, s.ownerId === uid ? 'owner' : 'editor', feedUrlFor(req, snap.id)), members });
  }));

  router.post('/', route('Could not create the account', async (req, res) => {
    const decoded = await verifyAuth(req);
    const name = clean(req.body?.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Enter a name.');
    const type = SHOW_TYPE_IDS.includes(req.body?.type) ? req.body.type : 'podcast';
    const t = showType(type);
    const ref = shows().doc();
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(decoded.uid);
      const user = (await tx.get(userRef)).data();
      if (!user) throw new HttpError(404, 'User not found');
      if (user.showId) throw new HttpError(409, 'You are already part of a podcast or church account.');
      const now = new Date();
      tx.set(ref, {
        name,
        type,
        ownerId: decoded.uid,
        plan: 'none',
        credits: 0,
        creditsUsedThisMonth: 0,
        billingRenewDate: null,
        memberIds: [decoded.uid],
        inviteCode: newInviteCode(),
        podcast: { title: name, author: name, description: '', language: 'en', category: t.category, subcategory: t.subcategory, explicit: false, email: user.email || '', artworkUrl: null },
        createdAt: now,
      });
      tx.set(ref.collection('members').doc(decoded.uid), { email: user.email || '', displayName: user.displayName || '', role: 'owner', joinedAt: now });
      tx.update(userRef, { showId: ref.id });
    });
    res.status(201).json({ id: ref.id });
  }));

  router.post('/join', route('Could not join', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const code = clean(req.body?.code, 12).toUpperCase();
    const found = await shows().where('inviteCode', '==', code).limit(1).get();
    if (found.empty) throw new HttpError(404, 'That invite code is not valid. Ask the account owner for a new one.');
    const ref = found.docs[0].ref;
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(uid);
      const [user, show] = [(await tx.get(userRef)).data(), (await tx.get(ref)).data()];
      if (!user) throw new HttpError(404, 'User not found');
      if (user.showId) throw new HttpError(409, 'You are already part of a podcast or church account.');
      const max = showMaxMembers(show.plan);
      if ((show.memberIds || []).length >= max) {
        throw new HttpError(409, `This team is full (${max} people on the current plan).`);
      }
      tx.update(ref, { memberIds: FieldValue.arrayUnion(uid) });
      tx.set(ref.collection('members').doc(uid), { email: user.email || '', displayName: user.displayName || '', role: 'editor', joinedAt: new Date() });
      tx.update(userRef, { showId: ref.id });
    });
    res.json({ id: ref.id });
  }));

  router.post('/leave', route('Could not leave', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, role } = await myShow(uid);
    if (role === 'owner') throw new HttpError(400, 'The owner cannot leave. Delete the account instead.');
    await removeMember(ref, uid);
    res.json({ success: true });
  }));

  // Owner closes the account: everyone is unlinked, episodes and the feed are removed.
  // Audio files stay in each uploader's own library.
  router.delete('/', route('Could not delete the account', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, show } = await myShow(uid, { requireOwner: true });
    const typed = clean(req.body?.confirmName, 80).toLowerCase();
    if (typed !== String(show.name || '').trim().toLowerCase()) throw new HttpError(400, 'Type the account name exactly to confirm.');

    const eps = await episodes().where('showId', '==', ref.id).get();
    const members = await ref.collection('members').get();
    const batch = adminDb.batch();
    for (const d of eps.docs) batch.delete(d.ref);
    for (const d of members.docs) batch.delete(d.ref);
    for (const memberUid of new Set([...(show.memberIds || []), show.ownerId])) {
      const userRef = users().doc(memberUid);
      if ((await userRef.get()).data()?.showId === ref.id) batch.update(userRef, { showId: null });
    }
    batch.delete(ref);
    await batch.commit();
    console.log(`[shows] ${uid} deleted show ${ref.id} (${show.name}), ${eps.size} episodes, ${Number(show.credits || 0)} credits forfeited`);
    res.json({ success: true });
  }));

  router.delete('/members/:uid', route('Could not remove member', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myShow(uid, { requireOwner: true });
    if (req.params.uid === uid) throw new HttpError(400, 'You cannot remove yourself.');
    await removeMember(ref, req.params.uid);
    res.json({ success: true });
  }));

  router.post('/invite', route('Could not create invite code', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myShow(uid, { requireOwner: true });
    const inviteCode = newInviteCode();
    await ref.update({ inviteCode });
    res.json({ inviteCode });
  }));

  router.patch('/', route('Could not save settings', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, show } = await myShow(uid, { requireOwner: true });
    const body = req.body || {};
    const updates = {};
    if (body.name !== undefined) {
      const name = clean(body.name, 80);
      if (name.length < 2) throw new HttpError(400, 'Enter a name.');
      updates.name = name;
    }
    if (body.type !== undefined) {
      if (!SHOW_TYPE_IDS.includes(body.type)) throw new HttpError(400, 'Unknown account type.');
      updates.type = body.type;
    }
    if (body.podcast && typeof body.podcast === 'object') updates.podcast = podcastSettings(body.podcast, { ...show, ...updates });
    await ref.update(updates);
    res.json({ success: true });
  }));

  router.post('/artwork', artworkUpload.single('artwork'), route('Could not upload artwork', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, show } = await myShow(uid, { requireOwner: true });
    if (!req.file || !/^image\/(jpeg|png|webp)$/.test(req.file.mimetype)) throw new HttpError(400, 'Upload a JPG, PNG or WebP image.');
    const saved = await uploadArtwork(req.file.buffer, ref.id);
    await ref.update({ podcast: { ...(show.podcast || {}), artworkUrl: saved.secure_url } });
    res.json({ artworkUrl: saved.secure_url });
  }));

  // ── Episodes (sermons for churches) ─────────────────────────

  router.get('/episodes', route('Could not load episodes', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myShow(uid);
    const snap = await episodes().where('showId', '==', ref.id).get();
    const fileRefs = snap.docs.map((d) => adminDb.collection('audioFiles').doc(d.data().fileId));
    const files = fileRefs.length ? await adminDb.getAll(...fileRefs) : [];
    const byId = new Map(files.map((f) => [f.id, f.exists ? f.data() : null]));
    const list = snap.docs
      .map((d) => episodeView(d.id, d.data(), byId.get(d.data().fileId)))
      .sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
    res.json({ episodes: list });
  }));

  router.post('/episodes', route('Could not save', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref: showRef } = await myShow(uid);
    const fields = episodeFields(req.body || {}, { partial: false });
    if (!fields.title) throw new HttpError(400, 'Give it a title.');
    const { ref: fileRef } = await getAccessibleFile(String(req.body?.fileId || '-'), uid);
    // Share the file with the rest of the team.
    await fileRef.update({ showId: showRef.id });
    const epRef = episodes().doc();
    await epRef.set({ ...fields, showId: showRef.id, createdBy: uid, fileId: fileRef.id, status: 'draft', createdAt: new Date(), publishedAt: null });
    res.status(201).json({ id: epRef.id });
  }));

  async function loadEpisode(uid, id) {
    const { ref: showRef } = await myShow(uid);
    const ref = episodes().doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().showId !== showRef.id) throw new HttpError(404, 'Not found');
    return { ref, episode: snap.data() };
  }

  router.get('/episodes/:id', route('Could not load', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, episode } = await loadEpisode(uid, req.params.id);
    const fileSnap = await adminDb.collection('audioFiles').doc(episode.fileId).get();
    res.json({
      episode: episodeView(ref.id, episode, fileSnap.data()),
      job: fileSnap.exists ? serializeFile(fileSnap.id, fileSnap.data()) : null,
    });
  }));

  router.patch('/episodes/:id', route('Could not update', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, episode } = await loadEpisode(uid, req.params.id);
    const b = req.body || {};
    const updates = episodeFields(b, { partial: true });
    if (updates.title === '') throw new HttpError(400, 'Give it a title.');
    if (b.status === 'published' || b.status === 'draft') {
      if (b.status === 'published') {
        const file = (await adminDb.collection('audioFiles').doc(episode.fileId).get()).data();
        if (file?.status !== 'processed') throw new HttpError(409, 'The audio must finish cleaning before it can be published.');
        if (file.processedIsVideo) throw new HttpError(400, 'Podcast episodes need audio. Clean it as audio to publish it.');
        if (!episode.publishedAt) updates.publishedAt = new Date();
      }
      updates.status = b.status;
    }
    await ref.update(updates);
    res.json({ success: true });
  }));

  router.delete('/episodes/:id', route('Could not delete', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await loadEpisode(uid, req.params.id);
    await ref.delete();
    res.json({ success: true });
  }));

  // ── Public podcast feed (no auth) ───────────────────────────

  const feed = route('Feed unavailable', async (req, res) => {
    const id = req.params.id.replace(/\.xml$/, '');
    const snap = await shows().doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'Feed not found');
    const show = snap.data();
    const published = await episodes().where('showId', '==', id).where('status', '==', 'published').get();
    const fileRefs = published.docs.map((d) => adminDb.collection('audioFiles').doc(d.data().fileId));
    const files = fileRefs.length ? await adminDb.getAll(...fileRefs) : [];
    const byId = new Map(files.map((f) => [f.id, f.exists ? f.data() : null]));
    const items = published.docs
      .map((d) => {
        const e = d.data();
        const file = byId.get(e.fileId);
        if (!file?.processedFileUrl) return null;
        return {
          id: d.id,
          title: e.title,
          speaker: e.speaker,
          guests: e.guests,
          series: e.series,
          reference: e.reference,
          season: e.season,
          episode: e.episode,
          description: e.description,
          summary: file.summary,
          audioUrl: file.processedFileUrl,
          audioBytes: file.processedBytes || 0,
          durationSeconds: file.processedDurationSeconds || file.durationSeconds,
          pubDate: e.date ? `${e.date}T09:00:00Z` : iso(e.publishedAt),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.pubDate.localeCompare(a.pubDate));
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buildPodcastFeed(show, items, { feedUrl: feedUrlFor(req, id), siteUrl: siteUrl || feedUrlFor(req, id) }));
  });

  return { router, feed };
}

async function removeMember(showRef, memberUid) {
  await adminDb.runTransaction(async (tx) => {
    const show = (await tx.get(showRef)).data();
    if (!(show.memberIds || []).includes(memberUid)) throw new HttpError(404, 'That person is not a member.');
    if (show.ownerId === memberUid) throw new HttpError(400, 'The owner cannot be removed.');
    tx.update(showRef, { memberIds: FieldValue.arrayRemove(memberUid) });
    tx.delete(showRef.collection('members').doc(memberUid));
    tx.update(users().doc(memberUid), { showId: null });
  });
}
