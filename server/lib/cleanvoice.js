import { Cleanvoice } from '@cleanvoice/cleanvoice-sdk';

/**
 * 80% QUALITY CONFIG (free and payg)
 */
const noise_removal_80 = {
  remove_noise: true,
  normalize: true,
  studio_sound: false,
  enhanceSpeech: false,
  fillers: false,
  long_silences: false
};

const audio_enhancement_80 = {
  remove_noise: true,
  normalize: true,
  studio_sound: false,
  enhanceSpeech: false,
  fillers: false,
  long_silences: false
};

const voice_clarity_80 = {
  remove_noise: true,
  normalize: true,
  studio_sound: false,
  enhanceSpeech: false,
  fillers: false,
  long_silences: false
};

/**
 * 100% QUALITY CONFIG (pro and unlimited)
 */
const noise_removal_100 = {
  remove_noise: true,
  normalize: true,
  studio_sound: false,
  enhanceSpeech: false,
  fillers: false,
  long_silences: false
};

const audio_enhancement_100 = {
  remove_noise: true,
  normalize: true,
  studio_sound: "nightly",
  enhanceSpeech: true,
  fillers: false,
  long_silences: true
};

const voice_clarity_100 = {
  remove_noise: true,
  normalize: true,
  studio_sound: "nightly",
  enhanceSpeech: true,
  fillers: true,
  long_silences: true
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
  config.export_format = 'wav';

  const client = new Cleanvoice({ apiKey: key });

  console.log(`Processing with Cleanvoice: plan=${plan}, quality=${qualityLevel}, feature=${featureKey}`);
  console.log('Sending to Cleanvoice API:', config);

  try {
    // SDK supports processing a URL directly
    const result = await client.process(cloudinaryUrl, { config });

    if (!result || !result.audio) {
       throw new Error('Cleanvoice AI returned no result data.');
    }

    return {
      processedUrl: result.audio.url,
      qualityLevel,
    };
  } catch (err) {
    throw new Error(err.message || 'Processing failed at Cleanvoice API');
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
