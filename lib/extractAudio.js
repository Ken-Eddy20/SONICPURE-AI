import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Extract audio from a video buffer and return an MP3 buffer.
 * Uses a temp directory for intermediate files, cleaned up in finally.
 */
export async function extractAudioFromVideo(videoBuffer, originalFilename) {
  const id = crypto.randomUUID();
  const ext = path.extname(originalFilename || '.mp4');
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `sonicpure_in_${id}${ext}`);
  const outputPath = path.join(tmpDir, `sonicpure_out_${id}.mp3`);

  fs.writeFileSync(inputPath, videoBuffer);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}
