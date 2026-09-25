/**
 * ffmpeg helpers for transcripts and captions. Every job works in its own temp
 * directory, which the caller removes with `cleanupDir`.
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');

export function makeWorkDir(prefix) {
  const dir = path.join(os.tmpdir(), `sonicpure_${prefix}_${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupDir(dir) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

export async function downloadTo(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download media (${res.status})`);
  fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  return filePath;
}

/**
 * Run ffmpeg with `cwd` set, so filter arguments can use plain relative paths
 * (Windows drive letters break ffmpeg's filter syntax).
 */
function runFfmpeg(args, { cwd, onTime } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { cwd });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      // Keep the banner (stream info, used by probe) plus the tail (errors).
      stderr = stderr.length < 16000 ? stderr + text : stderr.slice(0, 8000) + (stderr.slice(8000) + text).slice(-8000);
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (m && onTime) onTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      const err = new Error(`ffmpeg failed (${code}): ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
      err.stderr = stderr;
      reject(err);
    });
  });
}

/** Width, height and duration of a media file, read from ffmpeg's banner. */
export async function probe(filePath) {
  let out = '';
  try {
    out = await runFfmpeg(['-i', filePath]);
  } catch (err) {
    // `ffmpeg -i` without an output always exits non-zero; the banner is in stderr.
    out = String(err.stderr || err.message);
  }
  const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  const rotate = /rotate\s*:\s*(-?\d+)|rotation of (-?\d+)/.exec(out);
  let width = size ? Number(size[1]) : 0;
  let height = size ? Number(size[2]) : 0;
  const angle = rotate ? Math.abs(Number(rotate[1] ?? rotate[2])) : 0;
  if (angle === 90 || angle === 270) [width, height] = [height, width];
  return {
    width,
    height,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
  };
}

/**
 * Convert any audio/video to mono 16 kHz MP3 (what speech models want) and split it
 * into fixed-length chunks. Returns chunk paths with their start offsets in seconds.
 */
export async function speechChunks(inputPath, dir, chunkSeconds) {
  await runFfmpeg(
    ['-i', path.basename(inputPath), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
      '-f', 'segment', '-segment_time', String(chunkSeconds), '-reset_timestamps', '1', 'chunk_%04d.mp3'],
    { cwd: dir },
  );
  return fs
    .readdirSync(dir)
    .filter((f) => /^chunk_\d{4}\.mp3$/.test(f))
    .sort()
    .map((f, i) => ({ path: path.join(dir, f), start: i * chunkSeconds }));
}

/**
 * Burn an .ass subtitle file into a video. Writes `out.mp4` in `dir`.
 * @param {string} dir Work dir containing the video and `captions.ass`
 * @param {string} videoName File name of the source video inside `dir`
 * @param {(seconds: number) => void} onTime Progress callback
 */
export async function burnCaptions(dir, videoName, onTime) {
  const fontsDir = path.join(dir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  for (const f of fs.readdirSync(FONTS_DIR).filter((n) => n.endsWith('.ttf'))) {
    fs.copyFileSync(path.join(FONTS_DIR, f), path.join(fontsDir, f));
  }
  await runFfmpeg(
    ['-i', videoName, '-vf', 'subtitles=captions.ass:fontsdir=fonts',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.mp4'],
    { cwd: dir, onTime },
  );
  return path.join(dir, 'out.mp4');
}
