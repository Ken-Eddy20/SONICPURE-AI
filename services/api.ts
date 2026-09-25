import { auth } from '../firebase';

export const API_BASE: string = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export type Plan = 'free' | 'payg' | 'pro' | 'audio_master' | 'church';
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
  /** The uploaded video itself (videos only); originalFileUrl is its extracted audio. */
  originalVideoUrl?: string | null;
  processedFileUrl: string | null;
  processedIsVideo: boolean;
  durationSeconds: number;
  churchId?: string | null;
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

// ─── Transcripts & captions ──────────────────────────────────────

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  id: string;
  fileId: string;
  language: string;
  translateTo: string | null;
  status: 'queued' | 'processing' | 'done' | 'failed';
  stage: string | null;
  percent: number | null;
  timeline: 'original' | 'processed';
  creditsUsed: number;
  error: string | null;
  createdAt: string | null;
  segments?: Segment[];
  translation?: { language: string; segments: Segment[] } | null;
}

export interface CaptionJob {
  id: string;
  fileId: string;
  transcriptId: string;
  useTranslation: boolean;
  style: 'classic' | 'boxed' | 'social';
  position: 'bottom' | 'middle' | 'top';
  size: 'small' | 'medium' | 'large';
  status: 'queued' | 'processing' | 'done' | 'failed';
  stage: string | null;
  percent: number | null;
  outputUrl: string | null;
  creditsUsed: number;
  error: string | null;
  createdAt: string | null;
}

export const getTranscriptConfig = () => apiFetch<{ enabled: boolean }>('/api/transcripts/config');
export const listTranscripts = (fileId: string) =>
  apiFetch<{ transcripts: Transcript[] }>(`/api/transcripts?fileId=${encodeURIComponent(fileId)}`);
export const getTranscript = (id: string) => apiFetch<Transcript>(`/api/transcripts/${id}`);
export const startTranscript = (fileId: string, language: string, translateTo: string | null) =>
  apiFetch<{ id: string; creditsUsed: number }>('/api/transcripts', {
    method: 'POST',
    body: JSON.stringify({ fileId, language, translateTo }),
  });

export const listCaptions = (fileId: string) =>
  apiFetch<{ captions: CaptionJob[] }>(`/api/captions?fileId=${encodeURIComponent(fileId)}`);
export const getCaptionJob = (id: string) => apiFetch<CaptionJob>(`/api/captions/${id}`);
export const startCaptions = (body: {
  transcriptId: string;
  useTranslation: boolean;
  style: CaptionJob['style'];
  position: CaptionJob['position'];
  size: CaptionJob['size'];
}) => apiFetch<{ id: string; creditsUsed: number }>('/api/captions', { method: 'POST', body: JSON.stringify(body) });

// ─── Church ──────────────────────────────────────────────────────

export interface PodcastSettings {
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  subcategory?: string;
  email?: string;
  artworkUrl?: string | null;
}

export interface Church {
  id: string;
  name: string;
  plan: string;
  active: boolean;
  credits: number;
  creditsUsedThisMonth: number;
  billingRenewDate: string | null;
  memberCount: number;
  maxMembers: number;
  inviteCode: string;
  role: 'owner' | 'editor';
  podcast: PodcastSettings;
  feedUrl: string;
}

export interface ChurchMember {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'editor';
  joinedAt: string | null;
}

export interface Sermon {
  id: string;
  fileId: string;
  title: string;
  preacher: string;
  date: string;
  series: string;
  scripture: string;
  description: string;
  status: 'draft' | 'published';
  createdAt: string | null;
  publishedAt: string | null;
  file: {
    status: JobStatus;
    stage: string | null;
    percent: number | null;
    durationSeconds: number;
    processedFileUrl: string | null;
    summaryTitle: string | null;
    error: string | null;
  } | null;
}

export type SermonFields = Pick<Sermon, 'title' | 'preacher' | 'date' | 'series' | 'scripture' | 'description'>;

export const getChurch = () => apiFetch<{ church: Church | null; members?: ChurchMember[] }>('/api/church');
export const createChurch = (name: string) => apiFetch<{ id: string }>('/api/church', { method: 'POST', body: JSON.stringify({ name }) });
export const joinChurch = (code: string) => apiFetch<{ id: string }>('/api/church/join', { method: 'POST', body: JSON.stringify({ code }) });
export const leaveChurch = () => apiFetch<{ success: boolean }>('/api/church/leave', { method: 'POST' });
export const removeChurchMember = (uid: string) => apiFetch<{ success: boolean }>(`/api/church/members/${uid}`, { method: 'DELETE' });
export const regenerateInvite = () => apiFetch<{ inviteCode: string }>('/api/church/invite', { method: 'POST' });
export const updateChurch = (body: { name?: string; podcast?: PodcastSettings }) =>
  apiFetch<{ success: boolean }>('/api/church', { method: 'PATCH', body: JSON.stringify(body) });
export const uploadChurchArtwork = (file: File) => {
  const form = new FormData();
  form.append('artwork', file, file.name);
  return apiFetch<{ artworkUrl: string }>('/api/church/artwork', { method: 'POST', body: form });
};

export const listSermons = () => apiFetch<{ sermons: Sermon[] }>('/api/church/sermons');
export const getSermon = (id: string) => apiFetch<{ sermon: Sermon; job: AudioJob | null }>(`/api/church/sermons/${id}`);
export const createSermon = (fileId: string, fields: SermonFields) =>
  apiFetch<{ id: string }>('/api/church/sermons', { method: 'POST', body: JSON.stringify({ fileId, ...fields }) });
export const updateSermon = (id: string, body: Partial<SermonFields> & { status?: Sermon['status'] }) =>
  apiFetch<{ success: boolean }>(`/api/church/sermons/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteSermon = (id: string) => apiFetch<{ success: boolean }>(`/api/church/sermons/${id}`, { method: 'DELETE' });
