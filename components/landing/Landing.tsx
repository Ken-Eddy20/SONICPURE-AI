import { useState } from 'react';
import {
  ArrowRight, AudioLines, Wind, MessageSquareOff, Repeat, MousePointerClick, Timer, SlidersHorizontal,
  Volume2, Music2, FileText, ListTree, Share2, Upload, Wand2, Download, Church, GraduationCap, Mic,
  Users, Clapperboard, Smartphone, Plus, Minus, ShieldCheck, Clock, Sparkles, Languages, Captions, Podcast, Radio,
} from 'lucide-react';
import Logo from '../ui/Logo';
import ThemeToggle from '../ui/ThemeToggle';
import SignalWave from './SignalWave';
import Pricing from '../Pricing';
import { PROFILES } from '../../shared/processing.js';
import type { SubscriptionTier } from '../../constants/subscriptionPlans';

interface LandingProps {
  onSignIn: () => void;
  onSignUp: () => void;
  onChoosePlan: (tier: SubscriptionTier) => void;
}

const FIXES = [
  { icon: AudioLines, title: 'Background noise', text: 'Generators, fans, traffic, AC hum and room hiss.' },
  { icon: MessageSquareOff, title: 'Filler words', text: 'Um, uh and other verbal crutches, cut cleanly.' },
  { icon: Repeat, title: 'Stutters', text: 'Repeated syllables and false starts.' },
  { icon: MousePointerClick, title: 'Mouth sounds', text: 'Clicks, smacks and lip noise.' },
  { icon: Wind, title: 'Loud breaths', text: 'Softened so speech flows naturally.' },
  { icon: Timer, title: 'Dead air', text: 'Long silences trimmed to a natural pace.' },
  { icon: Volume2, title: 'Uneven volume', text: 'Leveled to podcast, YouTube or broadcast loudness.' },
  { icon: SlidersHorizontal, title: 'Muddy tone', text: 'Auto EQ balances boomy or thin recordings.' },
];

const PROFILE_ICONS: Record<string, typeof AudioLines> = {
  noise_removal: AudioLines,
  audio_enhancement: Sparkles,
  voice_clarity: Mic,
  custom: SlidersHorizontal,
};

const USE_CASES = [
  { icon: Church, title: 'Sermons & church media', text: 'Clean up live service recordings before they go to YouTube or WhatsApp.' },
  { icon: Mic, title: 'Podcasts', text: 'Polish every episode and get show notes, chapters and posts in the same pass.' },
  { icon: GraduationCap, title: 'Lectures & training', text: 'Make classroom and Zoom recordings easy to listen to.' },
  { icon: Users, title: 'Interviews', text: 'Rescue interviews recorded in busy offices, cafés and markets.' },
  { icon: Clapperboard, title: 'YouTube & TikTok', text: 'Upload the video, get the video back with clean audio.' },
  { icon: Smartphone, title: 'Phone recordings', text: 'Voice notes and phone mic recordings, made presentable.' },
];

const STEPS = [
  { icon: Upload, title: 'Upload or record', text: 'Drop an audio or video file, or record straight from your browser.' },
  { icon: Wand2, title: 'Pick a profile', text: 'Choose what to fix and how loud it should be. See the credit cost before you commit.' },
  { icon: Download, title: 'Compare and download', text: 'Flip between before and after on the same timeline, then download.' },
];

const FAQS = [
  {
    q: 'How does SonicPure clean my audio?',
    a: 'Your file is processed by Cleanvoice AI, a speech model trained to separate voices from noise and to detect fillers, stutters, mouth sounds and silences. SonicPure picks the right settings for the profile you choose and levels the result to your loudness target.',
  },
  {
    q: 'How are credits charged?',
    a: 'Per started minute of audio. Noise Removal and Podcast Polish cost 2 credits per minute, Studio Sound and Custom Mix cost 3. AI show notes add 1 per minute. You see the exact cost before you start, and if a job fails the credits go straight back to your balance.',
  },
  {
    q: 'What formats can I upload?',
    a: 'MP3, WAV, M4A, AAC, FLAC, OGG and OPUS on every plan. Pro and Audio Master can also upload MP4, MOV, MKV, AVI and WEBM video, and choose to get either the cleaned audio or the full video back.',
  },
  {
    q: 'What happens to my files?',
    a: 'Files are stored privately and listed in your library so you can come back and download them. You can delete any file yourself at any time, which removes both the original and the cleaned version. Your recordings are not used to train models.',
  },
  {
    q: 'How long does processing take?',
    a: 'Most files finish in 1 to 3 minutes. Long recordings take longer. You can leave the page open or come back later; the job keeps running and shows up in your library.',
  },
  {
    q: 'Can I pay with mobile money?',
    a: 'Yes. Prices are shown in US dollars and you pay the equivalent in Ghana cedis at the live exchange rate through Paystack: MTN MoMo, Telecel Cash, AirtelTigo Money, cards, bank transfer and USSD.',
  },
];

export default function Landing({ onSignIn, onSignUp, onChoosePlan }: LandingProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo onClick={() => window.scrollTo({ top: 0 })} />
          <nav className="hidden items-center gap-7 text-sm font-semibold text-muted md:flex">
            <a href="#fixes" className="hover:text-ink">What it fixes</a>
            <a href="#church" className="hover:text-ink">For churches</a>
            <a href="#languages" className="hover:text-ink">Local languages</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button type="button" onClick={onSignIn} className="hidden px-3 text-sm font-semibold text-muted hover:text-ink sm:block">
              Sign in
            </button>
            <button type="button" onClick={onSignUp} className="btn-ink">
              Start free
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI audio cleanup for creators
            </span>
            <h1 className="mt-6 text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
              Studio-clean audio,
              <br />
              <span className="display italic text-accent">without the studio.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Remove background noise, filler words, breaths and dead air from any recording. Get a transcript, summary and
              social posts in the same pass.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button type="button" onClick={onSignUp} className="btn-primary px-7 py-3.5 text-base">
                Clean a recording free <ArrowRight className="h-4 w-4" />
              </button>
              <a href="#pricing" className="btn-ghost px-7 py-3.5 text-base">
                See pricing
              </a>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted">
              <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> 50 free credits</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-accent" /> No card needed</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-accent" /> Ready in minutes</span>
            </div>
          </div>

          <div className="card mx-auto mt-14 max-w-4xl overflow-hidden p-2">
            <div className="flex items-center justify-between rounded-t-[20px] px-4 pt-3 text-xs font-semibold">
              <span className="flex items-center gap-2 text-accent">
                <span className="h-2 w-2 rounded-full bg-accent" /> Cleaned: voice only
              </span>
              <span className="flex items-center gap-2 text-noise">
                Original: voice + noise <span className="h-2 w-2 rounded-full bg-noise" />
              </span>
            </div>
            <div className="h-40 px-3 py-4 sm:h-52">
              <SignalWave />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              {['Generator hum removed', '14 fillers cut', 'Breaths softened', 'Leveled to -16 LUFS'].map((t) => (
                <span key={t} className="chip bg-sunken">{t}</span>
              ))}
            </div>
          </div>
        </section>

        {/* What it fixes */}
        <section id="fixes" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="What it fixes" title="Everything that makes a recording sound amateur." />
            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {FIXES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="bg-surface p-6">
                  <Icon className="h-5 w-5 text-accent" />
                  <h3 className="mt-4 font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Profiles */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Profiles" title="One click for the common jobs. Full control when you want it." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.values(PROFILES).map((p) => {
              const Icon = PROFILE_ICONS[p.id];
              return (
                <div key={p.id} className="card flex flex-col p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
                      <Icon className="h-5 w-5" />
                    </span>
                    {p.premium && <span className="chip py-0.5 text-[11px]">Pro</span>}
                  </div>
                  <h3 className="mt-5 text-lg font-bold">{p.name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{p.tagline}</p>
                  <p className="mt-5 text-xs font-bold uppercase tracking-wider text-faint">{p.creditsPerMin} credits / min</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* AI show notes */}
        <section id="notes" className="scroll-mt-20 mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="card grid overflow-hidden lg:grid-cols-2">
            <div className="p-8 sm:p-12">
              <span className="eyebrow text-accent">Pro feature</span>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Clean audio <span className="display italic">and</span> the show notes.
              </h2>
              <p className="mt-4 leading-relaxed text-muted">
                Tick one box and the same job returns a full transcript, a summary, chapter markers and ready-to-post
                content for X, LinkedIn and your newsletter. Export subtitles as SRT.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {[
                  { icon: FileText, label: 'Transcript + SRT' },
                  { icon: ListTree, label: 'Summary & chapters' },
                  { icon: Share2, label: 'Social posts' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 text-accent" /> {label}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-line bg-sunken p-6 sm:p-10 lg:border-l lg:border-t-0">
              <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
                <p className="eyebrow">Chapters</p>
                <ul className="mt-3 space-y-2">
                  {[
                    ['0:00', 'Welcome and opening prayer'],
                    ['4:12', 'Why small businesses stall'],
                    ['17:48', 'Three habits that compound'],
                    ['31:05', 'Questions from the audience'],
                  ].map(([t, title]) => (
                    <li key={t} className="flex gap-3">
                      <span className="w-12 shrink-0 font-mono text-xs text-accent">{t}</span>
                      <span>{title}</span>
                    </li>
                  ))}
                </ul>
                <p className="eyebrow mt-6">LinkedIn post</p>
                <p className="mt-2 leading-relaxed text-muted">
                  Most businesses don't fail from lack of ideas. They stall because nothing compounds. Here are three
                  habits we unpacked this week…
                </p>
              </div>
              <p className="mt-3 text-center text-xs text-faint">Example output</p>
            </div>
          </div>
        </section>

        {/* Church package */}
        <section id="church" className="scroll-mt-20 mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="overflow-hidden rounded-[2rem] bg-ink text-bg">
            <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-2">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                  <Church className="h-3.5 w-3.5" /> Church package
                </span>
                <h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
                  Sunday’s sermon, <span className="display italic text-accent">ready by Monday.</span>
                </h2>
                <p className="mt-4 leading-relaxed opacity-75">
                  Upload the service recording. SonicPure removes generator hum and crowd noise, keeps the worship songs,
                  writes the title, summary and chapters, and publishes it to your church podcast.
                </p>
                <button type="button" onClick={() => onChoosePlan('church')} className="btn-primary mt-8 px-7 py-3.5 text-base">
                  See the Church plan <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Mic, title: 'Sermon Studio', text: 'Clean audio, worship kept, AI notes for every message.' },
                  { icon: Podcast, title: 'Your own podcast', text: 'One feed for Spotify, Apple Podcasts and more.' },
                  { icon: Users, title: 'Media team', text: 'Up to 5 people share one credit pool.' },
                  { icon: Radio, title: 'One-click publish', text: 'New sermons reach listeners automatically.' },
                ].map(({ icon: Icon, title, text }) => (
                  <li key={title} className="rounded-2xl bg-white/5 p-5">
                    <Icon className="h-5 w-5 text-accent" />
                    <p className="mt-3 font-bold">{title}</p>
                    <p className="mt-1 text-sm opacity-70">{text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Local languages + captions */}
        <section id="languages" className="scroll-mt-20 mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <SectionHeading
            eyebrow="Local languages"
            title="Transcripts and captions in the languages your people speak."
            sub="Powered by Khaya AI from GhanaNLP. Transcribe, translate to or from English, and burn captions onto your videos."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <div className="card p-6">
              <Languages className="h-5 w-5 text-accent" />
              <h3 className="mt-4 text-lg font-bold">Transcribe</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">English, Twi, Fante, Ga, Ewe, Dagbani, Hausa, Nzema, Dangme, Gurene, Kusaal, Dagaare, Gonja, Pidgin and more.</p>
            </div>
            <div className="card p-6">
              <Share2 className="h-5 w-5 text-accent" />
              <h3 className="mt-4 text-lg font-bold">Translate</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">Turn a Twi sermon into English text, or an English message into Twi, Ga, Ewe, Fante and more. Download as TXT, SRT or VTT.</p>
            </div>
            <div className="card overflow-hidden">
              <div className="grid h-32 place-items-end bg-gradient-to-br from-slate-700 to-slate-900 p-4">
                <span className="mx-auto text-center text-base font-extrabold text-[#FFE500] [text-shadow:0_0_3px_#000,0_2px_4px_#000]">Onyame yɛ ɔdɔ</span>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2">
                  <Captions className="h-5 w-5 text-accent" />
                  <h3 className="text-lg font-bold">Captions on video</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">Subtitles burned into your clip, styled for TikTok, Reels and WhatsApp status.</p>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading eyebrow="How it works" title="Three steps. No editing skills needed." />
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-sm font-bold text-bg">{i + 1}</span>
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Use cases */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Built for" title="Anyone who records people talking." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4 rounded-3xl border border-line p-6">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionHeading
              eyebrow="Pricing"
              title="Start free. Pay only when it earns its keep."
              sub="Prices in USD, paid in cedis at the live rate. Mobile money, card or bank through Paystack."
            />
            <div className="mt-12">
              <Pricing onChoose={onChoosePlan} onStartFree={onSignUp} />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="FAQ" title="Questions, answered." />
          <div className="mt-10 divide-y divide-line rounded-3xl border border-line bg-surface">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left font-semibold"
                    aria-expanded={open}
                  >
                    {f.q}
                    {open ? <Minus className="h-4 w-4 shrink-0 text-accent" /> : <Plus className="h-4 w-4 shrink-0 text-muted" />}
                  </button>
                  {open && <p className="px-6 pb-6 text-sm leading-relaxed text-muted">{f.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-center text-bg sm:px-12">
            <Music2 className="mx-auto h-6 w-6 opacity-60" />
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">
              Your next recording, <span className="display italic">cleaned.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md opacity-70">50 free credits. That's about 25 minutes of noise removal.</p>
            <button type="button" onClick={onSignUp} className="btn-primary mt-8 px-7 py-3.5 text-base">
              Create free account <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-faint">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="mailto:support@sonicpure.ai" className="hover:text-ink">support@sonicpure.ai</a>
            <a href="/terms.html" className="hover:text-ink">Terms</a>
            <a href="/privacy.html" className="hover:text-ink">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow text-accent">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-muted">{sub}</p>}
    </div>
  );
}
