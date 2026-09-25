/**
 * Church package: a church account with a shared credit pool, a small media team,
 * sermons (cleaned audio + AI notes) and a public podcast feed.
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
import { CHURCH_MAX_MEMBERS } from '../../shared/processing.js';

const churches = () => adminDb.collection('churches');
const sermons = () => adminDb.collection('sermons');
const users = () => adminDb.collection('users');

const artworkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const newInviteCode = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');

const PODCAST_LANGUAGES = ['en', 'tw', 'ak', 'ee', 'gaa', 'ha', 'fr'];

/** Load the caller's church and their role in it. */
async function myChurch(uid, { requireOwner = false } = {}) {
  const user = (await users().doc(uid).get()).data();
  if (!user?.churchId) throw new HttpError(404, 'You are not part of a church account yet.');
  const ref = churches().doc(user.churchId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Church not found.');
  const church = snap.data();
  const role = church.ownerId === uid ? 'owner' : 'editor';
  if (requireOwner && role !== 'owner') throw new HttpError(403, 'Only the church account owner can do this.');
  return { ref, church, role, user };
}

function serializeChurch(id, c, role, feedUrl) {
  return {
    id,
    name: c.name,
    plan: c.plan,
    active: c.plan === 'church',
    credits: Number(c.credits || 0),
    creditsUsedThisMonth: Number(c.creditsUsedThisMonth || 0),
    billingRenewDate: iso(c.billingRenewDate),
    memberCount: (c.memberIds || []).length,
    maxMembers: CHURCH_MAX_MEMBERS,
    inviteCode: c.inviteCode,
    role,
    podcast: c.podcast || {},
    feedUrl,
  };
}

function sermonView(id, s, file) {
  return {
    id,
    fileId: s.fileId,
    title: s.title,
    preacher: s.preacher || '',
    date: s.date || '',
    series: s.series || '',
    scripture: s.scripture || '',
    description: s.description || '',
    status: s.status,
    createdAt: iso(s.createdAt),
    publishedAt: iso(s.publishedAt),
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

export default function churchRouter({ publicBaseUrl, siteUrl, serializeFile }) {
  const router = express.Router();
  const feedUrlFor = (req, id) => `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}/feeds/church/${id}.xml`;

  // ── Church account ──────────────────────────────────────────

  router.get('/', route('Could not load church', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const user = (await users().doc(uid).get()).data();
    if (!user?.churchId) return res.json({ church: null });
    const snap = await churches().doc(user.churchId).get();
    if (!snap.exists) return res.json({ church: null });
    const c = snap.data();
    const membersSnap = await snap.ref.collection('members').get();
    const members = membersSnap.docs
      .map((d) => ({ uid: d.id, email: d.data().email || '', displayName: d.data().displayName || '', role: d.data().role, joinedAt: iso(d.data().joinedAt) }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.joinedAt || '').localeCompare(b.joinedAt || '')));
    res.json({ church: serializeChurch(snap.id, c, c.ownerId === uid ? 'owner' : 'editor', feedUrlFor(req, snap.id)), members });
  }));

  router.post('/', route('Could not create church', async (req, res) => {
    const decoded = await verifyAuth(req);
    const name = clean(req.body?.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Enter your church name.');
    const ref = churches().doc();
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(decoded.uid);
      const user = (await tx.get(userRef)).data();
      if (!user) throw new HttpError(404, 'User not found');
      if (user.churchId) throw new HttpError(409, 'You are already part of a church account.');
      const now = new Date();
      tx.set(ref, {
        name,
        ownerId: decoded.uid,
        plan: 'none',
        credits: 0,
        creditsUsedThisMonth: 0,
        billingRenewDate: null,
        memberIds: [decoded.uid],
        inviteCode: newInviteCode(),
        podcast: { title: name, author: name, description: '', language: 'en', category: 'Religion & Spirituality', subcategory: 'Christianity', email: user.email || '', artworkUrl: null },
        createdAt: now,
      });
      tx.set(ref.collection('members').doc(decoded.uid), { email: user.email || '', displayName: user.displayName || '', role: 'owner', joinedAt: now });
      tx.update(userRef, { churchId: ref.id });
    });
    res.status(201).json({ id: ref.id });
  }));

  router.post('/join', route('Could not join church', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const code = clean(req.body?.code, 12).toUpperCase();
    const found = await churches().where('inviteCode', '==', code).limit(1).get();
    if (found.empty) throw new HttpError(404, 'That invite code is not valid. Ask your church admin for a new one.');
    const ref = found.docs[0].ref;
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(uid);
      const [user, church] = [(await tx.get(userRef)).data(), (await tx.get(ref)).data()];
      if (!user) throw new HttpError(404, 'User not found');
      if (user.churchId) throw new HttpError(409, 'You are already part of a church account.');
      if ((church.memberIds || []).length >= CHURCH_MAX_MEMBERS) {
        throw new HttpError(409, `This church team is full (${CHURCH_MAX_MEMBERS} members).`);
      }
      tx.update(ref, { memberIds: FieldValue.arrayUnion(uid) });
      tx.set(ref.collection('members').doc(uid), { email: user.email || '', displayName: user.displayName || '', role: 'editor', joinedAt: new Date() });
      tx.update(userRef, { churchId: ref.id });
    });
    res.json({ id: ref.id });
  }));

  router.post('/leave', route('Could not leave church', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, role } = await myChurch(uid);
    if (role === 'owner') throw new HttpError(400, 'The owner cannot leave. Remove the other members first, or contact support to transfer the account.');
    await removeMember(ref, uid);
    res.json({ success: true });
  }));

  router.delete('/members/:uid', route('Could not remove member', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myChurch(uid, { requireOwner: true });
    if (req.params.uid === uid) throw new HttpError(400, 'You cannot remove yourself.');
    await removeMember(ref, req.params.uid);
    res.json({ success: true });
  }));

  router.post('/invite', route('Could not create invite code', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myChurch(uid, { requireOwner: true });
    const inviteCode = newInviteCode();
    await ref.update({ inviteCode });
    res.json({ inviteCode });
  }));

  router.patch('/', route('Could not save settings', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, church } = await myChurch(uid, { requireOwner: true });
    const body = req.body || {};
    const updates = {};
    if (body.name !== undefined) {
      const name = clean(body.name, 80);
      if (name.length < 2) throw new HttpError(400, 'Enter your church name.');
      updates.name = name;
    }
    if (body.podcast && typeof body.podcast === 'object') {
      const p = body.podcast;
      const email = clean(p.email, 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid contact email.');
      updates.podcast = {
        ...(church.podcast || {}),
        title: clean(p.title, 120) || church.name,
        author: clean(p.author, 120) || church.name,
        description: clean(p.description, 3500),
        language: PODCAST_LANGUAGES.includes(p.language) ? p.language : 'en',
        category: 'Religion & Spirituality',
        subcategory: ['Christianity', 'Islam', 'Spirituality', 'Religion'].includes(p.subcategory) ? p.subcategory : 'Christianity',
        email,
      };
    }
    await ref.update(updates);
    res.json({ success: true });
  }));

  router.post('/artwork', artworkUpload.single('artwork'), route('Could not upload artwork', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, church } = await myChurch(uid, { requireOwner: true });
    if (!req.file || !/^image\/(jpeg|png|webp)$/.test(req.file.mimetype)) throw new HttpError(400, 'Upload a JPG, PNG or WebP image.');
    const saved = await uploadArtwork(req.file.buffer, ref.id);
    await ref.update({ podcast: { ...(church.podcast || {}), artworkUrl: saved.secure_url } });
    res.json({ artworkUrl: saved.secure_url });
  }));

  // ── Sermons ─────────────────────────────────────────────────

  router.get('/sermons', route('Could not load sermons', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await myChurch(uid);
    const snap = await sermons().where('churchId', '==', ref.id).get();
    const fileRefs = snap.docs.map((d) => adminDb.collection('audioFiles').doc(d.data().fileId));
    const files = fileRefs.length ? await adminDb.getAll(...fileRefs) : [];
    const byId = new Map(files.map((f) => [f.id, f.exists ? f.data() : null]));
    const list = snap.docs
      .map((d) => sermonView(d.id, d.data(), byId.get(d.data().fileId)))
      .sort((a, b) => (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''));
    res.json({ sermons: list });
  }));

  router.post('/sermons', route('Could not save sermon', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref: churchRef } = await myChurch(uid);
    const b = req.body || {};
    const title = clean(b.title, 150);
    if (!title) throw new HttpError(400, 'Give the sermon a title.');
    const { ref: fileRef } = await getAccessibleFile(String(b.fileId || '-'), uid);
    // Share the file with the rest of the church team.
    await fileRef.update({ churchId: churchRef.id });
    const sermonRef = sermons().doc();
    await sermonRef.set({
      churchId: churchRef.id,
      createdBy: uid,
      fileId: fileRef.id,
      title,
      preacher: clean(b.preacher, 100),
      date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10),
      series: clean(b.series, 100),
      scripture: clean(b.scripture, 150),
      description: clean(b.description, 3000),
      status: 'draft',
      createdAt: new Date(),
      publishedAt: null,
    });
    res.status(201).json({ id: sermonRef.id });
  }));

  async function loadSermon(uid, id) {
    const { ref: churchRef } = await myChurch(uid);
    const ref = sermons().doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().churchId !== churchRef.id) throw new HttpError(404, 'Sermon not found');
    return { ref, sermon: snap.data() };
  }

  router.get('/sermons/:id', route('Could not load sermon', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, sermon } = await loadSermon(uid, req.params.id);
    const fileSnap = await adminDb.collection('audioFiles').doc(sermon.fileId).get();
    res.json({
      sermon: sermonView(ref.id, sermon, fileSnap.data()),
      job: fileSnap.exists ? serializeFile(fileSnap.id, fileSnap.data()) : null,
    });
  }));

  router.patch('/sermons/:id', route('Could not update sermon', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, sermon } = await loadSermon(uid, req.params.id);
    const b = req.body || {};
    const updates = {};
    for (const [key, max] of [['title', 150], ['preacher', 100], ['series', 100], ['scripture', 150], ['description', 3000]]) {
      if (b[key] !== undefined) updates[key] = clean(b[key], max);
    }
    if (updates.title === '') throw new HttpError(400, 'Give the sermon a title.');
    if (b.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) updates.date = b.date;
    if (b.status === 'published' || b.status === 'draft') {
      if (b.status === 'published') {
        const file = (await adminDb.collection('audioFiles').doc(sermon.fileId).get()).data();
        if (file?.status !== 'processed') throw new HttpError(409, 'The sermon audio must finish cleaning before it can be published.');
        if (file.processedIsVideo) throw new HttpError(400, 'Podcast episodes need audio. Clean this sermon as audio to publish it.');
        if (!sermon.publishedAt) updates.publishedAt = new Date();
      }
      updates.status = b.status;
    }
    await ref.update(updates);
    res.json({ success: true });
  }));

  router.delete('/sermons/:id', route('Could not delete sermon', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref } = await loadSermon(uid, req.params.id);
    await ref.delete();
    res.json({ success: true });
  }));

  // ── Public podcast feed (no auth) ───────────────────────────

  const feed = route('Feed unavailable', async (req, res) => {
    const id = req.params.id.replace(/\.xml$/, '');
    const snap = await churches().doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'Feed not found');
    const church = snap.data();
    const published = await sermons().where('churchId', '==', id).where('status', '==', 'published').get();
    const fileRefs = published.docs.map((d) => adminDb.collection('audioFiles').doc(d.data().fileId));
    const files = fileRefs.length ? await adminDb.getAll(...fileRefs) : [];
    const byId = new Map(files.map((f) => [f.id, f.exists ? f.data() : null]));
    const episodes = published.docs
      .map((d) => {
        const s = d.data();
        const file = byId.get(s.fileId);
        if (!file?.processedFileUrl) return null;
        return {
          id: d.id,
          title: s.title,
          preacher: s.preacher,
          series: s.series,
          scripture: s.scripture,
          description: s.description,
          summary: file.summary,
          audioUrl: file.processedFileUrl,
          audioBytes: file.processedBytes || 0,
          durationSeconds: file.processedDurationSeconds || file.durationSeconds,
          pubDate: s.date ? `${s.date}T09:00:00Z` : iso(s.publishedAt),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.pubDate.localeCompare(a.pubDate));
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buildPodcastFeed(church, episodes, { feedUrl: feedUrlFor(req, id), siteUrl: siteUrl || feedUrlFor(req, id) }));
  });

  return { router, feed };
}

async function removeMember(churchRef, memberUid) {
  await adminDb.runTransaction(async (tx) => {
    const church = (await tx.get(churchRef)).data();
    if (!(church.memberIds || []).includes(memberUid)) throw new HttpError(404, 'That person is not a member.');
    if (church.ownerId === memberUid) throw new HttpError(400, 'The owner cannot be removed.');
    tx.update(churchRef, { memberIds: FieldValue.arrayRemove(memberUid) });
    tx.delete(churchRef.collection('members').doc(memberUid));
    tx.update(users().doc(memberUid), { churchId: null });
  });
}
