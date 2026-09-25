import { auth } from '../firebase';

export const API_BASE: string = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export type Plan = 'free' | 'payg' | 'pro' | 'audio_master';
export type JobStatus = 'uploading' | 'uploaded' | 'processing' | 'processed' | 'failed';

export interface JobOptions {
  exportFormat: 'mp3' | 'wav' | 'flac' | 'm4a';
  loudness: 'podcast' | 'youtube' | 'broadcast' | 'none';
  keepMusic: boolean;
  aiNotes: boolean;
  returnVideo: boolean;
  custom: Record<string, boolean>;
}

export interface JobStatistics {
  fillers: number;
  stutters: number;
  mouthSounds: number;
  breaths: number;
  deadAir: number;
}

export interface TranscriptParagraph {
  start: number;
  end: number;
  text: string;
}

export interface JobSummary {
  title: string;
  summary: string;
  episodeDescription: string;
  keyLearnings: string;
  chapters: { start: number; title: string }[];
}

export interface JobSocial {
  twitterThread: string;
  linkedin: string;
  newsletter: string;
}

export interface AudioJob {
  fileId: string;
  status: JobStatus;
  stage: string | null;
  percent: number | null;
  feature: string | null;
  options: JobOptions | null;
  originalFileName: string;
  sourceType: 'audio' | 'video';
  originalFileUrl: string;
  processedFileUrl: string | null;
  processedIsVideo: boolean;
  durationSeconds: number;
  fileSizeMB: number;
  creditsUsed: number;
  qualityLevel: number | null;
  statistics: JobStatistics | null;
  hasNotes: boolean;
  error: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  transcript?: { paragraphs: TranscriptParagraph[]; truncated: boolean } | null;
  summary?: JobSummary | null;
  social?: JobSocial | null;
}

/** Error carrying the HTTP status and any extra fields the API sent. */
export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, data: Record<string, unknown>) {
    super(String(data.error || data.message || `Request failed (${status})`));
    this.status = status;
    this.data = data;
  }
  get wantsUpgrade() {
    return Boolean(this.data.upgrade) || this.status === 402;
  }
}

async function token() {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, { error: 'Please sign in first.' });
  return user.getIdToken();
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, { error: 'Could not reach the SonicPure server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Upload with progress events (fetch has no upload progress). */
export async function uploadMedia(
  file: File,
  durationSeconds: number | null,
  onProgress: (percent: number) => void,
): Promise<{ fileId: string; originalFileUrl: string; sourceType: 'audio' | 'video'; durationSeconds: number }> {
  const bearer = await token();
  const form = new FormData();
  form.append('audio', file, file.name);
  if (durationSeconds) form.append('durationSeconds', String(durationSeconds));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = { error: 'The server sent an invalid response.' };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as never);
      else reject(new ApiError(xhr.status, data));
    });
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, { error: 'Upload failed. Check your connection and try again.' })),
    );
    xhr.open('POST', `${API_BASE}/api/audio/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    xhr.send(form);
  });
}

export const startProcessing = (fileId: string, feature: string, options: JobOptions) =>
  apiFetch<{ fileId: string; creditsUsed: number; creditsRemaining: number }>('/api/audio/process', {
    method: 'POST',
    body: JSON.stringify({ fileId, feature, options }),
  });

export const getJob = (fileId: string) => apiFetch<AudioJob>(`/api/audio/status/${fileId}`);

export const getHistory = () => apiFetch<{ files: AudioJob[] }>('/api/audio/history');

export const deleteJob = (fileId: string) => apiFetch<{ success: boolean }>(`/api/audio/${fileId}`, { method: 'DELETE' });
