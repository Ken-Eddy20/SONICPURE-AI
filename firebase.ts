import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Optional local file (gitignored). import.meta.glob returns {} when it doesn't exist,
// so a fresh clone builds instead of failing on a missing import.
const localFiles = import.meta.glob<{ default: FirebaseOptions }>('./firebase-applet-config.json', { eager: true });
const fileConfig = Object.values(localFiles)[0]?.default;

const env = import.meta.env;
const envConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const config: FirebaseOptions | undefined = envConfig.apiKey ? envConfig : fileConfig;

/** False when no Firebase web config was provided; index.tsx shows setup instructions instead of the app. */
export const firebaseConfigured = Boolean(config?.apiKey && config?.projectId);

// A placeholder keeps getAuth() from throwing at import time when config is missing.
const app = initializeApp(firebaseConfigured ? config! : { apiKey: 'missing-config', projectId: 'missing-config', appId: 'missing' });
export const auth = getAuth(app);
export const db = getFirestore(app);
