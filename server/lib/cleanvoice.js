import { Cleanvoice } from '@cleanvoice/cleanvoice-sdk';
import util from 'util';

/**
 * 80% QUALITY CONFIG (free and payg)
 */
const noise_removal_80 = {
  remove_noise: true,
  normalize: true
};

const audio_enhancement_80 = {
  studio_sound: true,
  normalize: true
};

const voice_clarity_80 = {
  studio_sound: true,
  normalize: true,
  breath: true
};

/**
 * 100% QUALITY CONFIG (pro and unlimited)
 */
const noise_removal_100 = {
  remove_noise: true,
  normalize: true
};

const audio_enhancement_100 = {
  studio_sound: true,
  normalize: true
};

const voice_clarity_100 = {
  studio_sound: true,
  normalize: true,
  fillers: true,
  long_silences: true,
  breath: true
};

const CONFIGS = {
  80: {
    noise_removal: noise_removal_80,
    audio_enhancement: audio_enhancement_80,
    voice_clarity: voice_clarity_80,
  },
  100: {
    noise_removal: noise_removal_100,
    audio_enhancement: audio_enhancement_100,
    voice_clarity: voice_clarity_100,
  }
};

/**
 * processAudioCleaning
 */
export async function processAudioCleaning(cloudinaryUrl, feature, plan) {
  const key = process.env.CLEANVOICE_API_KEY;
  if (!key) {
    throw new Error('CLEANVOICE_API_KEY not set in server/.env');
  }

  const qualityLevel = (plan === 'free' || plan === 'payg') ? 80 : 100;
  
  // Safe lookup config based on feature names
  let featureKey = feature;
  if (!['noise_removal', 'audio_enhancement', 'voice_clarity'].includes(featureKey)) {
    featureKey = 'noise_removal'; 
  }

  const config = CONFIGS[qualityLevel][featureKey];

  const client = new Cleanvoice({ apiKey: key });

  console.log(`Processing with Cleanvoice: plan=${plan}, quality=${qualityLevel}, feature=${featureKey}`);
  console.log('Sending to Cleanvoice API:', config);

  try {
    const secureUrl = cloudinaryUrl.replace('http://', 'https://');
    console.log(`[Cleanvoice] Sending request:`, { url: secureUrl, feature: featureKey, quality: qualityLevel });
    const result = await client.process(secureUrl, config);
    console.log(`[Cleanvoice] Response received:`, result);

    if (!result || !result.audio) {
       throw new Error('Cleanvoice AI returned no result data.');
    }

    return {
      processedUrl: result.audio.url,
      qualityLevel,
    };
  } catch (err) {
    console.error('Cleanvoice process error raw:', err);
    // SDK errors might be complex objects with a .response or .detail
    let detail = '';
    try {
      detail = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    } catch (e) {
      detail = String(err);
    }
    throw new Error(err.message && err.message !== '[object Object]' ? err.message : detail);
  }
}

export async function getJobStatus(jobId) {
  // Mock function if needed, SDK handles internal polling automatically via process()
  return 'completed';
}

export async function deleteCleanvoiceJob(jobId) {
  // Manual clean up if necessary depending on SDK implementation
  return true;
}
