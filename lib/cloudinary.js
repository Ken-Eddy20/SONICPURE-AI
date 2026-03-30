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
        expires_at: expiresAt,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
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
        expires_at: expiresAt,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
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
        expires_at: expiresAt,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(fileBuffer);
  });
}

/**
 * Delete an audio file from Cloudinary by public_id.
 */
export async function deleteAudio(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
}
