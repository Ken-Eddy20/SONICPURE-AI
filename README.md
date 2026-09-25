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

## Meetings

- Upload meeting recordings (audio or video) up to 3 GB. The browser sends the file in 8 MB pieces with automatic retries; the server keeps only a compact speech MP3 (about 14 MB per hour), never the video.
- Length limits per plan: Free 60 min, PAYG 3 h, Pro 4 h, Church 4 h, Audio Master 8 h (`MEETING_MAX_MINUTES` in `shared/processing.js`).
- English meetings: Cleanvoice transcription with speaker labels (rename speakers in the app). If Cleanvoice is unavailable (e.g. out of credits), the server falls back to Khaya's African English model.
- Local-language meetings: Khaya transcription in 5-minute pieces, optional English translation.
- Minutes: Claude (`claude-opus-5`) writes a summary, key points, decisions, action items (owner, due) and topics as structured JSON from the English transcript. Needs `ANTHROPIC_API_KEY`. If the minutes step fails, only its credits are refunded and the transcript is still delivered.
- Costs: 2 credits/min transcript, +1/min translation, 10 credits per started hour for minutes. Charged when processing starts (after the real length is measured), refunded on failure.
- Exports: Word (.doc), TXT, SRT, VTT; minutes copy-ready for WhatsApp or email.
- Stored in `meetings/{id}` with the transcript split across `meetings/{id}/parts` (keeps each document under Firestore's 1 MB limit). API-only access.

## Church package

- **Church account:** one owner plus up to 5 team members joining with an invite code (WhatsApp share button). Credits come from a shared pool on the church.
- **Church plan:** $35/month, 1,500 shared credits, files up to 150 minutes, all Pro features. Paid by the church owner via Paystack; credits go to the church, not the user.
- **Sermon Studio:** upload a service recording; it is cleaned with Podcast Polish at podcast loudness, worship songs protected, with title, summary, chapters and social posts.
- **Podcast feed:** `GET /feeds/church/<churchId>.xml` is a public RSS feed (Apple/Spotify format). Publishing a sermon adds it to the feed.

## Local-language transcripts and captions (Khaya AI)

- Transcribe in English, Twi (Asante and Akuapem), Fante, Ga, Ewe, Dagbani, Hausa, Nzema, Dangme, Gurene, Kusaal, Dagaare, Gonja, Pidgin, Yoruba and French via the Khaya ASR v3 API.
- Translate to or from English (Twi, Fante, Ga, Ewe, Dagbani, Gurene, Kusaal, Yoruba). Export TXT, SRT and VTT.
- Burn captions onto videos (up to 20 minutes) in three styles with ffmpeg; the result is saved to Cloudinary.
- Costs: transcript 2 credits/min, translation +1/min, captions 2/min. Failed jobs refund automatically, and jobs interrupted by a server restart are refunded on startup.
- Needs `KHAYA_API_KEY` on the server. Without it the feature shows as switched off.

## Firestore collections

| Collection | Written by | Purpose |
|---|---|---|
| `users` | client (create only), server | Plan, credits, daily counter, `churchId` |
| `creditPlans` | seed script | Plan limits and prices (`free`, `payg`, `pro`, `audio_master`, `church`) |
| `audioFiles` | server | Uploads and cleaning jobs (`churchId` when uploaded by a church member) |
| `churches` (+ `members`) | server | Church account, shared credits, invite code, podcast settings |
| `sermons` | server | Sermon details linked to an `audioFiles` doc, draft/published |
| `transcripts` | server | Khaya transcripts and translations with timed segments |
| `captionJobs` | server | Burned-in caption renders |
| `meetings` (+ `parts`) | server | Meeting uploads, transcripts, translations, speaker names and minutes |
| `transactions`, `usageLogs` | server | Payments and usage history |

Seed or update a single plan without touching the others: `npx tsx scripts/seedFirestore.ts --only church`

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
