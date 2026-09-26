import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

/**
 * Upload original audio to Cloudinary with 24h expiry.
 * Cloudinary treats audio as resource_type "video".
 */
export async function uploadAudio(fileBuffer, userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: `sonicpure/users/${userId}/original`,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id, bytes: result.bytes });
      }
    );
    stream.end(fileBuffer);
  });
}

/**
 * Upload processed (cleaned) audio to Cloudinary with 24h expiry.
 */
export async function saveProcessedAudio(fileBuffer, userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: `sonicpure/users/${userId}/processed`,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id, bytes: result.bytes });
      }
    );
    stream.end(fileBuffer);
  });
}

/**
 * Upload extracted (from video) audio to Cloudinary with 24h expiry.
 */
export async function saveExtractedAudio(fileBuffer, userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: `sonicpure/users/${userId}/extracted`,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id, bytes: result.bytes });
      }
    );
    stream.end(fileBuffer);
  });
}

/**
 * Delete an audio file from Cloudinary by public_id.
 */
export async function deleteAudio(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'video', invalidate: true });
}

/**
 * Delivery URL for an uploaded file transcoded to another format on the fly.
 * Used to hand Cleanvoice a format it accepts (e.g. browser .webm recordings as .wav).
 */
export function transcodedUrl(publicId, format) {
  return cloudinary.url(publicId, { resource_type: 'video', format, secure: true });
}

/**
 * Podcast artwork: stored as a 1400x1400 JPEG (Apple and Spotify require a square image of at least 1400px).
 */
export async function uploadArtwork(fileBuffer, showId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: `sonicpure/shows/${showId}/artwork`,
        format: 'jpg',
        transformation: [{ width: 1400, height: 1400, crop: 'fill', gravity: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(fileBuffer);
  });
}

/** Upload a finished video from disk (chunked, so large files work). */
export async function uploadVideoFile(filePath, userId) {
  // upload_large reports its result only through the callback, not a returned promise.
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_large(
      filePath,
      {
        resource_type: 'video',
        folder: `sonicpure/users/${userId}/captioned`,
        chunk_size: 20 * 1024 * 1024,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error('Cloudinary did not return a URL for the captioned video.'));
        resolve({ secure_url: result.secure_url, public_id: result.public_id, bytes: result.bytes });
      }
    );
  });
}
