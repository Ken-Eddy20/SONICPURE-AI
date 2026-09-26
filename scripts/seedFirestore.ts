import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceKeyPath = resolve(__dirname, '..', 'sonicpure service key.json');
const serviceAccount = JSON.parse(readFileSync(serviceKeyPath, 'utf-8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const creditPlans: Record<string, Record<string, unknown>> = {
  free: {
    planId: 'free',
    name: 'Free',
    tagline: 'Perfect for trying out the service',
    price: 0,
    billingCycle: 'monthly',
    credits: 50,
    isUnlimited: false,
    maxDailyEnhances: 2,
    maxAudioLengthMins: 20,
    processingSpeed: 'standard',
    extractAudioFromVideo: false,
    multipleUploads: false,
    advancedNoiseProfiles: false,
    isActive: true,
    qualityLevel: 80,
  },
  payg: {
    planId: 'payg',
    name: 'Pay As You Go',
    tagline: 'For occasional creators',
    price: 5,
    billingCycle: 'one_time',
    credits: 130,
    creditsExpire: false,
    isUnlimited: false,
    maxDailyEnhances: 4,
    maxAudioLengthMins: 30,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: false,
    multipleUploads: false,
    advancedNoiseProfiles: false,
    isActive: true,
    qualityLevel: 80,
  },
  pro: {
    planId: 'pro',
    name: 'Pro',
    tagline: 'For professional workflows',
    price: 20,
    billingCycle: 'monthly',
    credits: 600,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: 50,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: true,
    multipleUploads: false,
    advancedNoiseProfiles: true,
    isActive: true,
    qualityLevel: 100,
  },
  audio_master: {
    planId: 'audio_master',
    name: 'Audio Master Studio',
    tagline: 'The ultimate package for studios and heavy users',
    price: 60,
    billingCycle: 'monthly',
    credits: 2000,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: -1,
    processingSpeed: 'highest_tier',
    extractAudioFromVideo: true,
    multipleUploads: true,
    advancedNoiseProfiles: true,
    isActive: true,
    qualityLevel: 100,
  },
  podcast: {
    planId: 'podcast',
    name: 'Podcast',
    tagline: 'Record, clean and publish your show to Spotify and Apple Podcasts',
    price: 35,
    billingCycle: 'monthly',
    credits: 1500,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: 180,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: true,
    multipleUploads: true,
    advancedNoiseProfiles: true,
    maxMembers: 5,
    isActive: true,
    qualityLevel: 100,
  },
  // Same package as Podcast; only the wording in the app differs.
  church: {
    planId: 'church',
    name: 'Church',
    tagline: 'Sermon studio, podcast feed and shared credits for your media team',
    price: 35,
    billingCycle: 'monthly',
    credits: 1500,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: 180,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: true,
    multipleUploads: true,
    advancedNoiseProfiles: true,
    maxMembers: 5,
    isActive: true,
    qualityLevel: 100,
  },
};

// `--only church,pro` seeds just those plans and leaves the others untouched.
const onlyArg = process.argv.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] || process.argv[process.argv.indexOf(onlyArg) + 1] || '').split(',') : null;

async function seed() {
  console.log('Seeding creditPlans collection...\n');

  for (const [docId, data] of Object.entries(creditPlans)) {
    if (only && !only.includes(docId)) continue;
    const ref = db.collection('creditPlans').doc(docId);
    const snapshot = await ref.get();

    if (snapshot.exists) {
      await ref.update(data);
      console.log(`  [OK]   creditPlans/${docId} updated`);
    } else {
      await ref.set(data);
      console.log(`  [OK]   creditPlans/${docId} created`);
    }
  }

  console.log('\nSeed complete.');
  console.log('\nCollections that will be created by the app at runtime:');
  console.log('  - users          (on first sign-in)');
  console.log('  - transactions   (on payment)');
  console.log('  - usageLogs      (on audio processing)');
  console.log('  - audioFiles     (on file upload)');
  console.log('  - shows          (Podcast tab: podcast/church account, members subcollection)');
  console.log('  - episodes       (Podcast tab: episodes/sermons linked to audioFiles)');
  console.log('  - transcripts    (local-language transcripts and translations)');
  console.log('  - captionJobs    (burned-in video captions)');
  console.log('  - meetings       (meeting transcripts and minutes; parts subcollection)');
  console.log('  - recordings     (Recorder library: edited, tagged MP3s with cover art)');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
