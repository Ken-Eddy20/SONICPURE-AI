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
  },
  payg: {
    planId: 'payg',
    name: 'Pay As You Go',
    tagline: 'For occasional creators',
    price: 5,
    billingCycle: 'one_time',
    credits: 150,
    creditsExpire: false,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: 30,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: false,
    multipleUploads: false,
    advancedNoiseProfiles: false,
    isActive: true,
  },
  pro: {
    planId: 'pro',
    name: 'Pro',
    tagline: 'For professional workflows',
    price: 20,
    billingCycle: 'monthly',
    credits: 2500,
    isUnlimited: false,
    maxDailyEnhances: -1,
    maxAudioLengthMins: 50,
    processingSpeed: 'high_priority',
    extractAudioFromVideo: true,
    multipleUploads: false,
    advancedNoiseProfiles: true,
    isActive: true,
  },
  unlimited: {
    planId: 'unlimited',
    name: 'Unlimited Studio',
    tagline: 'The ultimate package for studios and heavy users',
    price: 60,
    billingCycle: 'monthly',
    credits: -1,
    isUnlimited: true,
    maxDailyEnhances: -1,
    maxAudioLengthMins: -1,
    processingSpeed: 'highest_tier',
    extractAudioFromVideo: true,
    multipleUploads: true,
    advancedNoiseProfiles: true,
    isActive: true,
  },
};

async function seed() {
  console.log('Seeding creditPlans collection...\n');

  for (const [docId, data] of Object.entries(creditPlans)) {
    const ref = db.collection('creditPlans').doc(docId);
    const snapshot = await ref.get();

    if (snapshot.exists) {
      console.log(`  [SKIP] creditPlans/${docId} already exists`);
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
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
