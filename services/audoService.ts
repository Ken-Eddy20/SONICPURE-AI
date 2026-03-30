/**
 * Audo AI - Voice cleaning via our backend API
 * API key stays server-side only
 */
import { convertToWav } from './audioUtils';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export interface AudoProcessOptions {
  intensity: number; // 0-100
  aggressive?: boolean; // Double-pass for heavier noise reduction
  autoBalance?: boolean;
  autoGain?: boolean;
  dereverberation?: boolean;
  audioRestoration?: boolean;
}

export async function processAudioWithAudo(
  audioBlob: Blob,
  options: AudoProcessOptions,
  onProgress?: (percent: number) => void
): Promise<{ cleanedAudioBlob: Blob }> {
  // Audo AI requires WAV for reliable parsing - convert WebM/MP3/M4A/etc. client-side
  const isWav = /wav|wave/i.test(audioBlob.type || '');
  let currentBlob: Blob = isWav ? audioBlob : await convertToWav(audioBlob);

  const processOnce = async (blob: Blob): Promise<Blob> => {
    const formData = new FormData();
    formData.append('audio', blob, 'audio.wav');
    formData.append('options', JSON.stringify({
      intensity: options.intensity,
      autoBalance: options.autoBalance,
      autoGain: options.autoGain,
      dereverberation: options.dereverberation,
      audioRestoration: options.audioRestoration,
    }));

    const res = await fetch(`${API_BASE}/api/process-audio`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      let errMessage = 'Audio processing failed';
      if (contentType.includes('text/html')) {
        errMessage = 'API server not available. If running locally, make sure the backend is running (npm run start). If on the live site, audio processing requires the API to be deployed.';
      } else if (contentType.includes('application/json')) {
        try {
          const err = await res.json();
          errMessage = err.error || err.detail || err.message || errMessage;
        } catch {
          errMessage = res.statusText || errMessage;
        }
      } else {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          errMessage = 'API server not responding. Make sure the backend is running: run "npm run start" (or "npm run dev:server" in a separate terminal).';
        } else {
          errMessage = res.statusText || errMessage;
        }
      }
      throw new Error(errMessage);
    }

    const resultBlob = await res.blob();
    if (resultBlob.type?.includes('text/html')) {
      throw new Error('API server not available. The request did not reach the audio processing service. Run "npm run start" to use the app locally with full functionality.');
    }
    return resultBlob;
  };

  let result = await processOnce(currentBlob);
  if (options.aggressive) {
    onProgress?.(50);
    const wavForSecondPass = /wav|wave/i.test(result.type || '') ? result : await convertToWav(result);
    result = await processOnce(wavForSecondPass);
  }
  onProgress?.(100);
  return { cleanedAudioBlob: result };
}
