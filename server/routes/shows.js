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
import { HttpError, route, verifyAuth, iso, diskLog, formatError } from '../lib/http.js';
import { deleteHosted, hostEpisode } from '../lib/hosting.js';
import { getAccessibleFile } from '../lib/accounts.js';
import { buildPodcastFeed } from '../lib/podcast.js';
import { PODCAST_CATEGORIES, SHOW_TYPE_IDS, hostingAddonHours, isShowPlan, showHostingHours, showMaxMembers, showType } from '../../shared/processing.js';

const shows = () => adminDb.collection('shows');
const episodes = () => adminDb.collection('episodes');
const users = () => adminDb.collection('users');

const artworkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const newInviteCode = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');
const PODCAST_LANGUAGES = ['en', 'tw', 'ak', 'ee', 'gaa', 'ha', 'fr'];
/** Most accounts one person can be part of (e.g. their church plus a podcast). */
const MAX_SHOWS_PER_USER = 5;

/** Every show the user belongs to. `showId` is the one they are working in right now. */
export const showIdsOf = (user) => [...new Set([...(user?.showIds || []), user?.showId].filter(Boolean))];

/**
 * Every show this person is a member of, straight from the shows' member lists (the source of
 * truth). The user's own showIds list could miss accounts created before several accounts were
 * allowed, so it is only a cache that GET /api/shows repairs.
 */
async function memberShows(uid) {
  const snap = await adminDb.collection('shows').where('memberIds', 'array-contains', uid).get();
  return snap.docs;
}

/** User doc update that drops one show and moves the active one to another if needed. */
function detachUpdate(user, showId) {
  const remaining = showIdsOf(user).filter((id) => id !== showId);
  return { showIds: remaining, showId: user.showId === showId ? remaining[0] || null : user.showId || null };
}

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

/** Seconds of audio this show has online (published episodes, plus any being published now). */
async function hostedSeconds(showId, exceptEpisodeId = null) {
  const snap = await adminDb.collection('episodes').where('showId', '==', showId).where('status', 'in', ['published', 'publishing']).get();
  return snap.docs.reduce((sum, d) => (d.id === exceptEpisodeId ? sum : sum + Number(d.data().hosted?.seconds || d.data().hostingSeconds || 0)), 0);
}

function serializeShow(id, s, role, feedUrl, usedSeconds = 0) {
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
    hostingUsedSeconds: Math.round(usedSeconds),
    hostingLimitHours: showHostingHours(s),
    hostingAddon: hostingAddonHours(s) ? { hours: hostingAddonHours(s), until: iso(s.hostingAddon.until) } : null,
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
    publishError: e.publishError || null,
    createdAt: iso(e.createdAt),
    publishedAt: iso(e.publishedAt),
    hosted: e.hosted ? { url: e.hosted.url, seconds: e.hosted.seconds || 0, bytes: e.hosted.bytes || 0 } : null,
    file: file
      ? {
          status: file.status === 'finalizing' ? 'processing' : file.status === 'uploading' ? 'uploaded' : file.status,
          stage: file.stage || null,
          percent: file.percent ?? null,
          durationSeconds: file.durationSeconds || 0,
          processedFileUrl: file.processedFileUrl || null,
          originalFileUrl: file.extractedAudioUrl || file.originalFileUrl || null,
          cleaned: Boolean(file.feature),
          deleteAt: iso(file.deleteAt),
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
    const userRef = users().doc(uid);
    const user = (await userRef.get()).data();
    const snaps = await memberShows(uid);
    const accounts = snaps
      .map((d) => ({ id: d.id, name: d.data().name, type: d.data().type || 'podcast', role: d.data().ownerId === uid ? 'owner' : 'editor', active: isShowPlan(d.data().plan) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Repair the cached list (and a stale open account) so billing and file access agree with membership.
    const ids = snaps.map((d) => d.id);
    const cached = showIdsOf(user);
    const openId = ids.includes(user?.showId) ? user.showId : null;
    if (user && (ids.length !== cached.length || ids.some((id) => !cached.includes(id)) || (user.showId || null) !== openId)) {
      await userRef.update({ showIds: ids, showId: openId });
    }
    const snap = snaps.find((d) => d.id === openId);
    if (!snap) return res.json({ show: null, accounts });
    const s = snap.data();
    const membersSnap = await snap.ref.collection('members').get();
    const members = membersSnap.docs
      .map((d) => ({ uid: d.id, email: d.data().email || '', displayName: d.data().displayName || '', role: d.data().role, joinedAt: iso(d.data().joinedAt) }))
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.joinedAt || '').localeCompare(b.joinedAt || '')));
    const used = await hostedSeconds(snap.id);
    res.json({ show: serializeShow(snap.id, s, s.ownerId === uid ? 'owner' : 'editor', feedUrlFor(req, snap.id), used), members, accounts });
  }));

  router.post('/', route('Could not create the account', async (req, res) => {
    const decoded = await verifyAuth(req);
    const name = clean(req.body?.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Enter a name.');
    const type = SHOW_TYPE_IDS.includes(req.body?.type) ? req.body.type : 'podcast';
    const t = showType(type);
    const ref = shows().doc();
    const memberCount = (await memberShows(decoded.uid)).length;
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(decoded.uid);
      const user = (await tx.get(userRef)).data();
      if (!user) throw new HttpError(404, 'User not found');
      if (memberCount >= MAX_SHOWS_PER_USER) throw new HttpError(409, `You can be part of up to ${MAX_SHOWS_PER_USER} podcast or church accounts.`);
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
      // Keep the account that was open before in the list too.
      tx.update(userRef, { showId: ref.id, showIds: FieldValue.arrayUnion(ref.id, ...(user.showId ? [user.showId] : [])) });
    });
    res.status(201).json({ id: ref.id });
  }));

  router.post('/join', route('Could not join', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const code = clean(req.body?.code, 12).toUpperCase();
    const found = await shows().where('inviteCode', '==', code).limit(1).get();
    if (found.empty) throw new HttpError(404, 'That invite code is not valid. Ask the account owner for a new one.');
    const ref = found.docs[0].ref;
    const memberCount = (await memberShows(uid)).length;
    await adminDb.runTransaction(async (tx) => {
      const userRef = users().doc(uid);
      const [user, show] = [(await tx.get(userRef)).data(), (await tx.get(ref)).data()];
      if (!user) throw new HttpError(404, 'User not found');
      if ((show.memberIds || []).includes(uid)) throw new HttpError(409, 'You are already on this team. Pick it from your accounts.');
      if (memberCount >= MAX_SHOWS_PER_USER) throw new HttpError(409, `You can be part of up to ${MAX_SHOWS_PER_USER} podcast or church accounts.`);
      const max = showMaxMembers(show.plan);
      if ((show.memberIds || []).length >= max) {
        throw new HttpError(409, `This team is full (${max} people on the current plan).`);
      }
      tx.update(ref, { memberIds: FieldValue.arrayUnion(uid) });
      tx.set(ref.collection('members').doc(uid), { email: user.email || '', displayName: user.displayName || '', role: 'editor', joinedAt: new Date() });
      tx.update(userRef, { showId: ref.id, showIds: FieldValue.arrayUnion(ref.id, ...(user.showId ? [user.showId] : [])) });
    });
    res.json({ id: ref.id });
  }));

  // Work in another of your accounts, or in none (id null: your own plan and credits).
  router.post('/switch', route('Could not switch account', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const id = req.body?.id ? String(req.body.id) : null;
    const userRef = users().doc(uid);
    const user = (await userRef.get()).data();
    if (id) {
      const show = (await shows().doc(id).get()).data();
      if (!show || !(show.memberIds || []).includes(uid)) throw new HttpError(404, 'You are not part of that account.');
    }
    await userRef.update({ showId: id, showIds: id ? FieldValue.arrayUnion(id) : showIdsOf(user) });
    res.json({ success: true });
  }));

  // Leave the open account, or any other one you are in ({ id }).
  router.post('/leave', route('Could not leave', async (req, res) => {
    const { uid } = await verifyAuth(req);
    let ref;
    let role;
    if (req.body?.id) {
      ref = shows().doc(String(req.body.id));
      const show = (await ref.get()).data();
      if (!show || !(show.memberIds || []).includes(uid)) throw new HttpError(404, 'You are not part of that account.');
      role = show.ownerId === uid ? 'owner' : 'editor';
    } else {
      ({ ref, role } = await myShow(uid));
    }
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
    for (const d of eps.docs) await deleteHosted(d.data().hosted).catch((err) => diskLog(`[shows] could not delete hosted audio for ${d.id}: ${formatError(err)}`));
    const members = await ref.collection('members').get();
    const batch = adminDb.batch();
    for (const d of eps.docs) batch.delete(d.ref);
    for (const d of members.docs) batch.delete(d.ref);
    for (const memberUid of new Set([...(show.memberIds || []), show.ownerId])) {
      const userRef = users().doc(memberUid);
      const member = (await userRef.get()).data();
      if (member && showIdsOf(member).includes(ref.id)) batch.update(userRef, detachUpdate(member, ref.id));
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
    if (b.status === 'published' && episode.status !== 'published' && episode.status !== 'publishing') {
      const { show } = await myShow(uid);
      if (!isShowPlan(show.plan)) throw new HttpError(402, 'Activate the Podcast or Church plan to publish.', { upgrade: true });
      const file = (await adminDb.collection('audioFiles').doc(episode.fileId).get()).data();
      const source = publishSource(file);
      const limit = showHostingHours(show) * 3600;
      const used = await hostedSeconds(episode.showId, ref.id);
      const seconds = Number(file.processedDurationSeconds || file.durationSeconds || 0);
      if (used + seconds > limit) {
        throw new HttpError(409, `Your podcast has ${Math.round(used / 3600)} of ${limit / 3600} hours online. Unpublish an older episode, or add 250 more hours for $3 a month.`, { code: 'HOSTING_FULL' });
      }
      await ref.update({ ...updates, status: 'publishing', publishError: null, hostingSeconds: seconds });
      publishInBackground(ref, { ...episode, ...updates }, source, show);
      return res.status(202).json({ success: true, status: 'publishing' });
    }
    if (b.status === 'draft' && episode.status === 'published') {
      // Unpublishing removes the hosted copy for good.
      await deleteHosted(episode.hosted);
      updates.status = 'draft';
      updates.hosted = null;
    }
    await ref.update(updates);
    res.json({ success: true });
  }));

  router.delete('/episodes/:id', route('Could not delete', async (req, res) => {
    const { uid } = await verifyAuth(req);
    const { ref, episode } = await loadEpisode(uid, req.params.id);
    if (episode.status === 'publishing') throw new HttpError(409, 'It is being published right now. Try again in a minute.');
    await deleteHosted(episode.hosted);
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
        // Hosted copy first; older episodes published before hosting fall back to the cleaned file.
        const audio = e.hosted
          ? { url: e.hosted.url, bytes: e.hosted.bytes, seconds: e.hosted.seconds }
          : file?.processedFileUrl
            ? { url: file.processedFileUrl, bytes: file.processedBytes || 0, seconds: file.processedDurationSeconds || file.durationSeconds }
            : null;
        if (!audio) return null;
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
          summary: file?.summary || e.summary || null,
          audioUrl: audio.url,
          audioBytes: audio.bytes || 0,
          durationSeconds: audio.seconds || 0,
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

/** Which audio to publish: the cleaned file, or the upload itself when it was not cleaned. */
function publishSource(file) {
  if (!file || file.status === 'expired') throw new HttpError(410, 'This audio was already deleted from SonicPure. Upload it again to publish it.');
  if (['uploading', 'processing', 'finalizing'].includes(file.status)) throw new HttpError(409, 'Wait for the cleaning to finish, then publish.');
  if (file.status === 'failed') throw new HttpError(409, 'Cleaning failed for this recording. Upload it again to publish it.');
  if (file.status === 'processed') {
    if (file.processedIsVideo) throw new HttpError(400, 'Podcast episodes need audio. Clean it as audio to publish it.');
    if (!file.processedFileUrl) throw new HttpError(410, 'The cleaned audio was already deleted. Upload it again to publish it.');
    return file.processedFileUrl;
  }
  const url = file.extractedAudioUrl || file.originalFileUrl;
  if (!url) throw new HttpError(410, 'This audio was already deleted from SonicPure. Upload it again to publish it.');
  return url;
}

/**
 * Encode and store the episode, then flip it to published. Runs after the response so long
 * sermons do not time out; the app polls the episode. The working file is removed a day later.
 */
function publishInBackground(ref, episode, sourceUrl, show) {
  (async () => {
    try {
      const hosted = await hostEpisode(sourceUrl, {
        showId: episode.showId, episodeId: ref.id, title: episode.title, artist: episode.speaker || show.podcast?.author || show.name,
      });
      // Re-check the cap with the real length (another publish may have finished meanwhile).
      const used = await hostedSeconds(episode.showId, ref.id);
      if (used + hosted.seconds > showHostingHours(show) * 3600) {
        await deleteHosted(hosted);
        throw new Error('Your podcast is at its hours limit. Unpublish an older episode, or add 250 more hours for $3 a month.');
      }
      const current = (await ref.get()).data();
      if (!current || current.status !== 'publishing') {
        await deleteHosted(hosted); // deleted or changed while we worked
        return;
      }
      await ref.update({ status: 'published', hosted, hostingSeconds: hosted.seconds, publishedAt: episode.publishedAt || new Date(), publishError: null });
      const soon = new Date(Date.now() + 24 * 3600 * 1000);
      const fileRef = adminDb.collection('audioFiles').doc(episode.fileId);
      const file = (await fileRef.get()).data();
      if (file) {
        const current = file.deleteAt?.toDate?.() || null;
        await fileRef.update({ deleteAt: current && current < soon ? current : soon, originalDeleteAt: new Date() });
      }
      diskLog(`[shows] published ${ref.id}: ${hosted.seconds}s, ${Math.round(hosted.bytes / 1024)} KB on ${hosted.provider}`);
    } catch (err) {
      diskLog(`[shows] publish failed for ${ref.id}: ${formatError(err)}`);
      await ref.update({ status: 'draft', publishError: err.message || 'Publishing failed. Try again.' }).catch(() => {});
    }
  })();
}

/** Episodes left half-published by a restart go back to draft so they can be published again. */
export async function recoverPublishing() {
  const snap = await adminDb.collection('episodes').where('status', '==', 'publishing').get();
  for (const d of snap.docs) await d.ref.update({ status: 'draft', publishError: 'The server restarted while publishing. Please publish again.' });
  return snap.size;
}

async function removeMember(showRef, memberUid) {
  await adminDb.runTransaction(async (tx) => {
    const userRef = users().doc(memberUid);
    const [show, member] = [(await tx.get(showRef)).data(), (await tx.get(userRef)).data()];
    if (!(show.memberIds || []).includes(memberUid)) throw new HttpError(404, 'That person is not a member.');
    if (show.ownerId === memberUid) throw new HttpError(400, 'The owner cannot be removed.');
    tx.update(showRef, { memberIds: FieldValue.arrayRemove(memberUid) });
    tx.delete(showRef.collection('members').doc(memberUid));
    if (member) tx.update(userRef, detachUpdate(member, showRef.id));
  });
}
