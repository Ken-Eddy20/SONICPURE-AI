# SonicPure AI

AI audio cleanup for podcasters, churches, educators and video creators. Upload or record audio (or video on Pro), pick a profile, and get back clean audio plus optional transcript, summary, chapters and social posts.

**Stack:** React 19 + Vite + Tailwind v4 (frontend) · Express (API) · Firebase Auth + Firestore · Cloudinary (file storage) · Cleanvoice AI (processing) · Paystack (payments)

## Features

- **Four profiles:** Noise Removal, Studio Sound, Podcast Polish, Custom Mix (Pro). Pro and Audio Master unlock full-strength Podcast Polish (fillers, stutters, mouth sounds, dead air), Custom Mix, AI show notes and video.
- **Output controls:** loudness targets (Podcast -16, YouTube -14, Broadcast -23 LUFS), MP3 / WAV / FLAC / M4A, protect music.
- **AI show notes (Pro):** transcript with TXT and SRT export, summary, chapters, X / LinkedIn / newsletter posts.
- **Video (Pro):** upload video, get cleaned audio or the full video back.
- **Record in browser** with a live level meter.
- **Before / after player** on one shared timeline with waveforms.
- **Library** of recent files with live progress; jobs keep running if the tab closes.
- **Batch upload** on Audio Master.
- **Plans:** Free (50 credits), Pay As You Go ($1 per 20 credits, any amount), Pro ($20, 600 credits), Audio Master ($60, 2,000 credits). Prices in USD, charged in GHS at the live rate via Paystack.
- Credit cost shown before every job; failed jobs refund automatically.

## How processing works

1. `POST /api/audio/upload` stores the file in Cloudinary and records its duration.
2. `POST /api/audio/process` checks plan limits, reserves credits in a Firestore transaction, and submits a Cleanvoice job (`createEdit`). Returns immediately.
3. The browser polls `GET /api/audio/status/:fileId`. Each poll checks Cleanvoice once; on success the server copies the result to Cloudinary and saves stats, transcript and notes. On failure credits are refunded.

Profiles, pricing and the exact Cleanvoice config for each plan live in [`shared/processing.js`](shared/processing.js), used by both the server and the UI.

## Run locally

Prerequisites: Node 20+.

1. `npm install`
2. Copy `server/.env.example` to `server/.env` and fill in the keys.
3. Copy `.env.example` to `.env.local`.
4. Add your Firebase web config as `VITE_FIREBASE_*` in `.env.local`, or keep using `firebase-applet-config.json` (gitignored).
5. Seed plans once: `npx tsx scripts/seedFirestore.ts` (needs `sonicpure service key.json` in the repo root).
6. Deploy Firestore rules: `firebase deploy --only firestore:rules`
7. `npm start` runs the API on :3002 and the app on http://localhost:5173.

## Deploy

- **API (Render):** build `npm install`, start `npm run server`, and set all `server/.env` variables.
- **Frontend (Firebase Hosting or any static host):** `npm run build`, serve `dist/`. Set `VITE_API_URL` to the Render URL at build time.
- **Paystack webhook:** point it to `https://<your-api>/api/paystack/webhook`.
