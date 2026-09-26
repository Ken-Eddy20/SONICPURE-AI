/**
 * Long-term hosting for published podcast episodes, the only audio SonicPure keeps.
 *
 * Cloudflare R2 when configured (no charge when listeners download, $0.015/GB-month),
 * otherwise Cloudinary. Each episode is re-encoded to mono MP3 at HOSTED_KBPS first, so an
 * hour of speech is about 29 MB.
 *
 * R2 env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and
 * R2_PUBLIC_URL (the bucket's public r2.dev URL or custom domain, no trailing slash).
 */
import fs from 'fs';
import path from 'path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { cloudinary } from '../../lib/cloudinary.js';
import { HOSTED_KBPS } from '../../shared/processing.js';
import { cleanupDir, downloadTo, encodeHostedMp3, makeWorkDir, probe } from './media.js';

const env = (k) => (process.env[k] || '').trim();

export const r2Configured = () =>
  Boolean(env('R2_ACCOUNT_ID') && env('R2_ACCESS_KEY_ID') && env('R2_SECRET_ACCESS_KEY') && env('R2_BUCKET') && env('R2_PUBLIC_URL'));

let client = null;
function r2() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
    });
  }
  return client;
}

async function put(filePath, key) {
  const body = fs.readFileSync(filePath);
  if (r2Configured()) {
    await r2().send(new PutObjectCommand({
      Bucket: env('R2_BUCKET'),
      Key: key,
      Body: body,
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return { provider: 'r2', key, url: `${env('R2_PUBLIC_URL').replace(/\/+$/, '')}/${key}`, bytes: body.length };
  }
  // "raw" so Cloudinary serves the exact file; as "video" it re-compresses MP3s on delivery.
  const saved = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ resource_type: 'raw', public_id: `sonicpure/${key}`, overwrite: true }, (err, result) =>
        err ? reject(err) : resolve(result),
      )
      .end(body);
  });
  return { provider: 'cloudinary', key: saved.public_id, url: saved.secure_url, bytes: saved.bytes || body.length };
}

/** Remove a hosted episode file. Safe to call twice. */
export async function deleteHosted(hosted) {
  if (!hosted?.key) return;
  if (hosted.provider === 'r2') {
    if (!r2Configured()) throw new Error('R2 is not configured, so this hosted file cannot be deleted.');
    await r2().send(new DeleteObjectCommand({ Bucket: env('R2_BUCKET'), Key: hosted.key }));
  } else {
    await cloudinary.uploader.destroy(hosted.key, { resource_type: 'raw', invalidate: true });
  }
}

/**
 * Download the episode's audio, re-encode it for podcast apps and store it.
 * Returns { provider, key, url, bytes, seconds, kbps }.
 */
export async function hostEpisode(sourceUrl, { showId, episodeId, title, artist }) {
  const dir = makeWorkDir('host');
  try {
    const input = path.join(dir, 'source');
    await downloadTo(sourceUrl, input);
    const output = await encodeHostedMp3(input, dir, { kbps: HOSTED_KBPS, title, artist });
    const { duration } = await probe(output);
    // A fresh key per publish, so podcast apps never get a cached old file.
    const key = `shows/${showId}/${episodeId}-${Date.now().toString(36)}.mp3`;
    const stored = await put(output, key);
    return { ...stored, seconds: Math.round(duration || 0), kbps: HOSTED_KBPS };
  } finally {
    cleanupDir(dir);
  }
}
