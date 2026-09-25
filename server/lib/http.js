import fs from 'fs';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';
import { adminAuth } from '../../lib/firebaseAdmin.js';

const LOG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.log');

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function formatError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message && err.message !== '[object Object]') return err.message;
  return util.inspect(err, { depth: 2, colors: false });
}

export function diskLog(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // Read-only filesystems (some hosts) still get console output.
  }
  console.log(msg);
}

export async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }
  try {
    return await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    throw new HttpError(401, 'Session expired. Please sign in again.');
  }
}

export function sendError(res, err, fallback) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  diskLog(`[Error] ${fallback}: ${formatError(err)}`);
  return res.status(500).json({ error: formatError(err) || fallback });
}

/** Wrap an async route so thrown errors become JSON responses. */
export const route = (fallback, handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    sendError(res, err, fallback);
  }
};

/** UTC day key used for the daily enhancement counter, e.g. "2026-09-25". */
export function getQuotaDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

export const iso = (value) => toDate(value)?.toISOString() || null;
