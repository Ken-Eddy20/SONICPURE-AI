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

## Recorder (free, in the Podcast tab)

- **Record live** in the browser from a mic, USB interface or mixer: input picker, level meter with clipping and too-quiet warnings, pause/resume, screen kept awake. Every 5 seconds the recording is saved in the browser (IndexedDB), so a crash or closed tab can be recovered from the Recorder page.
- **Edit** recordings or any opened audio/video file: waveform with zoom and overview, drag or type exact selections, crop, cut out, mute, volume in dB, normalise, fade in/out, insert silence, **add audio** (an intro in front, a file inserted in between at the playhead, or an outro at the end; from the device or a saved recording, up to 30 min each), unlimited undo/redo (Space, Delete, Ctrl+Z/Y). Editing is non-destructive (`services/audioEdit.ts`): each file is decoded once into a source list and edits are a list of clips pointing into those sources, so memory stays flat and undo also removes added audio. Files up to 3 hours; long ones are edited at speech quality to fit in memory.
- **Details**: cover art, title, artist, album, album artist, composer, genre, year, track and comment are written into the MP3 as ID3 tags (`browser-id3-writer`). MP3 encoding runs in a Web Worker (`@breezystack/lamejs`, LGPL) in 5-minute windows.
- **Save, download, share**: download the MP3; share to WhatsApp or Telegram (the file itself on phones, a link to the saved copy on computers); save to the cloud library (`recordings` collection; free plan keeps ${FREE_RECORDING_LIMIT} = 10 recordings).
- **Paid**: "Clean with AI" (needs a paid plan; uses credits) and "Publish to Spotify & Apple Podcasts" (Podcast or Church plan: cleans it, writes show notes and creates an episode for the podcast feed). Both reuse the saved file without re-uploading.

## Meetings

- Upload meeting recordings (audio or video) up to 3 GB. The browser sends the file in 8 MB pieces with automatic retries; the server keeps only a compact speech MP3 (about 14 MB per hour), never the video.
- Length limits per plan: Free 60 min, PAYG 3 h, Pro 4 h, Podcast 4 h, Church 4 h, Audio Master 8 h (`MEETING_MAX_MINUTES` in `shared/processing.js`).
- English meetings: Cleanvoice transcription with speaker labels (rename speakers in the app). If Cleanvoice is unavailable (e.g. out of credits), the server falls back to Khaya's African English model.
- Local-language meetings: Khaya transcription in 5-minute pieces, optional English translation.
- Minutes: Claude (`claude-opus-5`) writes a summary, key points, decisions, action items (owner, due) and topics as structured JSON from the English transcript. Needs `ANTHROPIC_API_KEY`. If the minutes step fails, only its credits are refunded and the transcript is still delivered.
- Costs: 2 credits/min transcript, +1/min translation, 10 credits per started hour for minutes. Charged when processing starts (after the real length is measured), refunded on failure.
- Exports: Word (.doc), TXT, SRT, VTT; minutes copy-ready for WhatsApp or email.
- Stored in `meetings/{id}` with the transcript split across `meetings/{id}/parts` (keeps each document under Firestore's 1 MB limit). API-only access.

## Podcasts and churches (Podcast tab)

One engine for every "show". When creating the account the owner picks a type, and the labels follow it (`SHOW_TYPES` in `shared/processing.js`):

| Type | Items | Speaker | Extra fields | Default category |
|---|---|---|---|---|
| Church or ministry | Sermons | Preacher | Series, Scripture | Religion & Spirituality › Christianity |
| Podcast show | Episodes | Host | Guests, season and episode numbers | Society & Culture |
| School or organisation | Episodes | Speaker | Guests, series, numbering | Education |

- **Several accounts:** one person can be in up to 5 accounts (for example their church and their own podcast). `user.showIds` lists them and `user.showId` is the one they are working in; the account bar at the top of the Podcast tab switches (`POST /api/shows/switch`) and "New church or podcast account" opens the create/join page again. Credits and new uploads go to the open account.
- **Team:** one owner plus members joining with an invite code (WhatsApp share button). Credits come from a shared pool on the show. Team size: 2 without a plan, 5 on Podcast or Church.
- **Plans:** Podcast and Church are the same package: $35/month, 1,500 shared credits, up to 5 people, files up to 3 hours. Only the wording differs. Paid by the owner via Paystack; credits go to the show, not the user. Either plan works with any type.
- **Team top-up:** anyone on a team with an active plan can buy packs of 350 credits for $10 (1 to 10 packs) straight into the shared pool (tier `team_topup`); the plan and renewal date are unchanged. Personal Pay As You Go is refused for active team members (`USE_TEAM_TOPUP`), because personal credits are not spent while the team plan is active.
- **Episode studio:** upload a recording; it is cleaned with Podcast Polish at podcast loudness, music protected, with title, summary, chapters and social posts.
- **Podcast feed:** `GET /feeds/show/<showId>.xml` is a public RSS feed (Apple/Spotify format) with category, subcategory, explicit flag, seasons and episode numbers. `/feeds/church/<id>.xml` still works for feeds submitted before the rename.
- The type can be changed later in Podcast settings; the feed wording follows.
- **Leaving:** members use "Leave this team". The owner deletes the account (Team or Podcast settings, type the name to confirm, `DELETE /api/shows`): everyone is unlinked, episodes and the feed are removed, remaining shared credits are forfeited, audio files stay with their uploaders.

## Storage: what is kept and for how long

SonicPure keeps no backups. Rules live in `shared/processing.js`; deletion runs in `server/lib/retention.js` every 30 minutes.

| What | Kept for |
|---|---|
| Uncleaned original after cleaning | 24 hours (for the before/after comparison), or until the episode is published |
| Uploads never cleaned or published, and failed uploads | 3 days |
| Cleaned files, Recorder saves, caption videos, meeting audio | 7 days on Free, 30 days on paid plans, counted from when they finish |
| A working file after its episode is published | 24 hours more |
| Transcripts, AI notes, meeting minutes (text) | Kept; they are tiny |
| **Published podcast episodes** | While published, re-encoded to mono MP3 at 64 kbps (about 29 MB an hour). Podcast and Church plans allow **150 hours online**, plus **+250 hours for $3 per 30 days** (`hosting_addon`, 1 to 4 blocks, any team member). If the add-on runs out nothing is deleted; publishing is refused until there is room. Unpublishing or deleting removes the file immediately |

**Working space:** an account can hold at most 2 hours (Free), 10 hours (paid) or 20 hours (Podcast/Church team) of uploads and cleaned files at once; published episodes do not count. New uploads past that are refused with `WORKING_SPACE_FULL` until files are downloaded, published, deleted or expire.

Published episodes must stay online because Apple Podcasts and most apps stream from our link. They are hosted on **Cloudflare R2** when the `R2_*` variables in `server/.env` are set (no charge for listener downloads), otherwise on Cloudinary as raw files. Publishing runs in the background (`status: publishing`), and a restart puts half-published episodes back to draft. Episodes can be published without AI cleaning (no credits).

Files created before this existed have no delete date. `node scripts/backfillRetention.mjs` previews them; `--apply` schedules them (7 or 30 days from the day it runs).

## Local-language transcripts and captions (Khaya AI)

- Transcribe in English, Twi (Asante and Akuapem), Fante, Ga, Ewe, Dagbani, Hausa, Nzema, Dangme, Gurene, Kusaal, Dagaare, Gonja, Pidgin, Yoruba and French via the Khaya ASR v3 API.
- Translate to or from English (Twi, Fante, Ga, Ewe, Dagbani, Gurene, Kusaal, Yoruba). Export TXT, SRT and VTT.
- Burn captions onto videos (up to 20 minutes) in three styles with ffmpeg; the result is saved to Cloudinary.
- Costs: transcript 2 credits/min, translation +1/min, captions 2/min. Failed jobs refund automatically, and jobs interrupted by a server restart are refunded on startup.
- Needs `KHAYA_API_KEY` on the server. Without it the feature shows as switched off.

## Firestore collections

| Collection | Written by | Purpose |
|---|---|---|
| `users` | client (create only), server | Plan, credits, daily counter, `showId` |
| `creditPlans` | seed script | Plan limits and prices (`free`, `payg`, `pro`, `audio_master`, `podcast`, `church`) |
| `audioFiles` | server | Uploads and cleaning jobs (`showId` when uploaded by a team member) |
| `shows` (+ `members`) | server | Podcast or church account: type, plan, shared credits, invite code, podcast settings |
| `episodes` | server | Episode or sermon details linked to an `audioFiles` doc, draft/published |
| `transcripts` | server | Khaya transcripts and translations with timed segments |
| `captionJobs` | server | Burned-in caption renders |
| `recordings` | server | Recorder library: edited, tagged MP3s with cover art |
| `meetings` (+ `parts`) | server | Meeting uploads, transcripts, translations, speaker names and minutes |
| `transactions`, `usageLogs` | server | Payments and usage history |

Seed or update a single plan without touching the others: `npx tsx scripts/seedFirestore.ts --only podcast`

Databases created before shows existed: `node scripts/migrateChurchesToShows.mjs` moves `churches`/`sermons` to `shows`/`episodes` and renames `churchId` to `showId` (already run on the live database).

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

## Deploy (one Render web service)

The API server also serves the built website from `dist/`, so one Render service hosts everything on one address (no CORS or `VITE_API_URL` setup). `render.yaml` describes it.

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run server`
- **Health check:** `/api/health`
- **Instance:** Starter or higher (always on). Free instances sleep, so podcast apps fetching feeds would time out and the deletion sweeper would pause.
- **Environment:**
  - Website build: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (the values in `firebase-applet-config.json`, which is not in Git) and `VITE_PAYSTACK_PUBLIC_KEY`.
  - Server: everything in `.env`: `FIREBASE_*`, `CLEANVOICE_API_KEY`, `CLOUDINARY_*`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_CURRENCY`, `R2_*`, plus optional `KHAYA_API_KEY` and `ANTHROPIC_API_KEY`. Paste `FIREBASE_PRIVATE_KEY` exactly as it is in `.env` (with its backslash-n sequences).
- **After the first deploy:** add the Render domain (and any custom domain) to Firebase → Authentication → Settings → Authorized domains, and set the Paystack webhook to `https://<your-domain>/api/paystack/webhook`.
- Serving the site elsewhere is still possible: set `VITE_API_URL` to the API address at build time and `ALLOWED_ORIGINS` on the server.
