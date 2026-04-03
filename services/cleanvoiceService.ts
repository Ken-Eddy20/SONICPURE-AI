/// <reference types="vite/client" />
/**
 * Cleanvoice AI - Voice cleaning via our backend API
 * API key stays server-side only
 */
import { convertToWav } from './audioUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export interface CleanvoiceProcessOptions {
  removeNoise?: boolean;
  fillers?: boolean;
  stutters?: boolean;
  mouthSounds?: boolean;
  hesitations?: boolean;
  breath?: boolean;
  normalize?: boolean;
}

export async function processAudioWithCleanvoice(
  audioBlob: Blob,
  options: CleanvoiceProcessOptions,
  onProgress?: (percent: number) => void
): Promise<{ cleanedAudioBlob: Blob }> {
  // Convert to WAV locally to ensure consistency
  const isWav = /wav|wave/i.test(audioBlob.type || '');
  let currentBlob: Blob = isWav ? audioBlob : await convertToWav(audioBlob);

  const formData = new FormData();
  formData.append('audio', currentBlob, 'audio.wav');
  formData.append('options', JSON.stringify({
    remove_noise: options.removeNoise,
    fillers: options.fillers,
    stutters: options.stutters,
    mouth_sounds: options.mouthSounds,
    hesitations: options.hesitations,
    breath: options.breath,
    normalize: options.normalize
  }));

  onProgress?.(10);

  const res = await fetch(`${API_BASE}/api/process-audio`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    let errMessage = 'Audio processing failed';
    if (contentType.includes('text/html')) {
      errMessage = 'API server not available. Ensure backend is running.';
    } else if (contentType.includes('application/json')) {
      try {
        const err = await res.json();
        errMessage = err.error || err.detail || err.message || errMessage;
      } catch {
        errMessage = res.statusText || errMessage;
      }
    } else {
      errMessage = res.statusText || errMessage;
    }
    throw new Error(errMessage);
  }

  onProgress?.(100);
  const resultBlob = await res.blob();
  if (resultBlob.type?.includes('text/html')) {
    throw new Error('API server not available. The request did not reach the audio processing service.');
  }

  return { cleanedAudioBlob: resultBlob };
}
