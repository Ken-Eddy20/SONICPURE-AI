import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../lib/firebaseAdmin.js';
import { HttpError } from './http.js';
import { isShowPlan } from '../../shared/processing.js';

/**
 * Who pays for a job. A member of a show (podcast or church) with an active Podcast or
 * Church plan bills the show's shared credit pool and gets that plan's features;
 * everyone else bills their own user doc on their own plan.
 *
 * Pass `tx` to read inside a Firestore transaction (reads must come before writes).
 */
export async function resolveAccount(userId, tx = null) {
  const get = (ref) => (tx ? tx.get(ref) : ref.get());
  const userRef = adminDb.collection('users').doc(userId);
  const userSnap = await get(userRef);
  if (!userSnap.exists) throw new HttpError(404, 'User not found');
  const user = userSnap.data();

  if (user.showId) {
    const showRef = adminDb.collection('shows').doc(user.showId);
    const showSnap = await get(showRef);
    const show = showSnap.exists ? showSnap.data() : null;
    if (show && isShowPlan(show.plan)) {
      return {
        userRef,
        user,
        kind: 'show',
        plan: show.plan,
        showId: user.showId,
        billingRef: showRef,
        credits: Number(show.credits || 0),
      };
    }
  }

  return {
    userRef,
    user,
    kind: 'user',
    plan: (user.plan || 'free').toLowerCase(),
    showId: user.showId || null,
    billingRef: userRef,
    credits: Number(user.credits || 0),
  };
}

export const billedTo = (account) => ({ kind: account.kind, id: account.billingRef.id });

export function billingRefFor(billed) {
  // 'church' is the pre-rename name of a show pool; kept so old jobs still refund correctly.
  const shared = billed?.kind === 'show' || billed?.kind === 'church';
  return adminDb.collection(shared ? 'shows' : 'users').doc(billed.id);
}

/**
 * Charge `cost` credits and write `jobData` to `jobRef` atomically.
 * Throws 402 when the balance is too low.
 */
export async function chargeAndCreate(userId, cost, jobRef, jobData, check) {
  return adminDb.runTransaction(async (tx) => {
    const account = await resolveAccount(userId, tx);
    if (check) await check(account, tx);
    if (account.credits < cost) {
      throw new HttpError(402, `This needs ${cost} credits. You have ${account.credits}.`, {
        creditsNeeded: cost,
        creditsAvailable: account.credits,
        upgrade: true,
      });
    }
    tx.update(account.billingRef, {
      credits: account.credits - cost,
      creditsUsedThisMonth: FieldValue.increment(cost),
    });
    tx.set(jobRef, { ...jobData, creditsUsed: cost, billedTo: billedTo(account), showId: account.showId || null });
    return account;
  });
}

/** Give credits back to whoever paid for a job. Idempotent via the `refunded` flag. */
export async function refundJob(jobRef, reason) {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const job = snap.data();
    if (!job || job.refunded || job.status === 'done') return false;
    const cost = job.creditsUsed || 0;
    if (cost > 0 && job.billedTo) {
      tx.update(billingRefFor(job.billedTo), {
        credits: FieldValue.increment(cost),
        creditsUsedThisMonth: FieldValue.increment(-cost),
      });
    }
    tx.update(jobRef, { status: 'failed', error: reason, refunded: true, creditsRefunded: cost, creditsUsed: 0 });
    return true;
  });
}

/** A file is visible to its uploader and to members of the show it was uploaded under. */
export async function getAccessibleFile(fileId, userId) {
  const ref = adminDb.collection('audioFiles').doc(fileId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'File not found');
  const data = snap.data();
  if (data.userId === userId) return { ref, data };
  if (data.showId) {
    const user = (await adminDb.collection('users').doc(userId).get()).data();
    if (user?.showId === data.showId) return { ref, data };
  }
  throw new HttpError(403, 'Not authorized');
}

/**
 * Charge `cost` credits for a job doc that already exists, merging `fields` into it.
 * `check(account)` can throw to reject (e.g. plan limits) before anything is charged.
 */
export async function chargeExisting(userId, cost, jobRef, fields, check) {
  return adminDb.runTransaction(async (tx) => {
    const account = await resolveAccount(userId, tx);
    if (check) check(account);
    if (account.credits < cost) {
      throw new HttpError(402, `This needs ${cost} credits. You have ${account.credits}.`, {
        creditsNeeded: cost,
        creditsAvailable: account.credits,
        upgrade: true,
      });
    }
    tx.update(account.billingRef, {
      credits: account.credits - cost,
      creditsUsedThisMonth: FieldValue.increment(cost),
    });
    tx.update(jobRef, { ...fields, creditsUsed: cost, billedTo: billedTo(account), refunded: false });
    return account;
  });
}
