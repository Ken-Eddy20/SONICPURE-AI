import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { ApiError, deleteJob, getHistory, getJob, startProcessing, uploadMedia, type JobOptions, type Plan } from '../../services/api';
import type { SubscriptionTier } from '../../constants/subscriptionPlans';
import AppHeader, { type StudioView } from './AppHeader';
import Composer, { type PlanLimits, type QueuedFile } from './Composer';
import JobDetail, { type ClientJob } from './JobDetail';
import Library from './Library';
import Pricing from '../Pricing';
import ChurchView from '../church/ChurchView';
import { PLAN_NAMES } from '../../shared/processing.js';

export interface UserSnapshot {
  plan: Plan;
  credits: number | null;
  creditsUsedThisMonth: number;
  dailyEnhancesUsed: number;
  /** UTC day ("YYYY-MM-DD") the daily counter belongs to. */
  dailyEnhancesDate: string;
  /** Credits and plan come from the church's shared pool. */
  churchBilling: boolean;
}

interface StudioProps {
  user: User;
  account: UserSnapshot;
  onChoosePlan: (tier: SubscriptionTier) => void;
  onSignOut: () => void;
}

const POLL_MS = 4000;

const todayKeyUTC = () => new Date().toISOString().slice(0, 10);

let localSeq = 0;

export default function Studio({ user, account, onChoosePlan, onSignOut }: StudioProps) {
  const [view, setView] = useState<StudioView>('studio');
  const [jobs, setJobs] = useState<ClientJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limits, setLimits] = useState<PlanLimits | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const patchJob = useCallback((id: string, patch: Partial<ClientJob>) => {
    setJobs((list) => list.map((j) => (j.fileId === id ? { ...j, ...patch } : j)));
  }, []);

  // Plan limits (public, readable from the client).
  useEffect(() => {
    getDoc(doc(db, 'creditPlans', account.plan))
      .then((snap) => {
        const d = snap.data() || {};
        setLimits({
          maxAudioLengthMins: d.maxAudioLengthMins ?? 20,
          maxDailyEnhances: d.maxDailyEnhances ?? 2,
          extractAudioFromVideo: Boolean(d.extractAudioFromVideo),
          multipleUploads: Boolean(d.multipleUploads),
        });
      })
      .catch(() => setLimits({ maxAudioLengthMins: 20, maxDailyEnhances: 2, extractAudioFromVideo: false, multipleUploads: false }));
  }, [account.plan]);

  useEffect(() => {
    getHistory()
      .then(({ files }) =>
        setJobs((local) => {
          const known = new Set(local.map((j) => j.fileId));
          return [...local, ...files.filter((f) => !known.has(f.fileId))];
        }),
      )
      .catch((err) => setBanner(err instanceof ApiError ? err.message : 'Could not load your library.'))
      .finally(() => setHistoryLoading(false));
  }, []);

  // Poll every job that is running on the server. The status call also advances the job.
  const hasRunning = jobs.some((j) => j.status === 'processing' && !j.fileId.startsWith('local-'));
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => {
      jobsRef.current
        .filter((j) => j.status === 'processing' && !j.fileId.startsWith('local-'))
        .forEach((j) => {
          getJob(j.fileId)
            .then((fresh) => patchJob(j.fileId, fresh))
            .catch((err) => {
              if (err instanceof ApiError && err.status === 404) patchJob(j.fileId, { status: 'failed', error: 'This file no longer exists.' });
            });
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [hasRunning, patchJob]);

  const runOne = async (item: QueuedFile, feature: string, options: JobOptions, localId: string) => {
    let id = localId;
    try {
      const uploaded = await uploadMedia(item.file, item.duration, (p) => patchJob(id, { uploadPercent: p }));
      patchJob(id, {
        fileId: uploaded.fileId,
        status: 'processing',
        stage: 'Queued',
        percent: 2,
        originalFileUrl: uploaded.originalFileUrl,
        durationSeconds: uploaded.durationSeconds || item.duration || 0,
      });
      setSelectedId((s) => (s === id ? uploaded.fileId : s));
      id = uploaded.fileId;
      const started = await startProcessing(uploaded.fileId, feature, options);
      patchJob(id, { creditsUsed: started.creditsUsed });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, { error: 'Something went wrong.' });
      patchJob(id, { status: 'failed', error: e.message, upgrade: e.wantsUpgrade });
    }
  };

  const handleStart = async (files: QueuedFile[], feature: string, options: JobOptions) => {
    const now = new Date().toISOString();
    const created: [QueuedFile, string][] = files.map((f) => [f, `local-${++localSeq}`]);
    setJobs((list) => [
      ...created.map(([f, localId]): ClientJob => ({
        fileId: localId,
        status: 'uploading',
        uploadPercent: 0,
        stage: null,
        percent: null,
        feature,
        options,
        originalFileName: f.file.name,
        sourceType: f.isVideo ? 'video' : 'audio',
        originalFileUrl: '',
        processedFileUrl: null,
        processedIsVideo: false,
        durationSeconds: f.duration || 0,
        fileSizeMB: f.file.size / (1024 * 1024),
        creditsUsed: 0,
        qualityLevel: null,
        statistics: null,
        hasNotes: false,
        error: null,
        createdAt: now,
        expiresAt: null,
      })),
      ...list,
    ]);
    setSelectedId(created[0][1]);
    // Upload one at a time to keep bandwidth for the current file; processing runs in parallel.
    for (const [f, localId] of created) {
      await runOne(f, feature, options, localId);
    }
  };

  const handleDelete = async (job: ClientJob) => {
    if (!window.confirm(`Delete "${job.originalFileName}"? This removes the original and cleaned files.`)) return;
    try {
      if (!job.fileId.startsWith('local-')) await deleteJob(job.fileId);
      setJobs((list) => list.filter((j) => j.fileId !== job.fileId));
      setSelectedId(null);
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Delete failed.');
    }
  };

  const enhancesLeftToday = useMemo(() => {
    if (!limits || limits.maxDailyEnhances === -1) return null;
    const used = account.dailyEnhancesDate === todayKeyUTC() ? account.dailyEnhancesUsed : 0;
    return Math.max(0, limits.maxDailyEnhances - used);
  }, [limits, account.dailyEnhancesDate, account.dailyEnhancesUsed]);

  const selected = jobs.find((j) => j.fileId === selectedId) || null;
  const goPlans = () => setView('plans');

  return (
    <div className="min-h-screen">
      <AppHeader
        user={user}
        plan={account.plan}
        credits={account.credits}
        churchBilling={account.churchBilling}
        view={view}
        onView={setView}
        onSignOut={onSignOut}
      />

      {banner && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {banner}
            <button type="button" onClick={() => setBanner(null)} className="font-semibold underline">Dismiss</button>
          </div>
        </div>
      )}

      {view === 'church' ? (
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <ChurchView onChoosePlan={onChoosePlan} onChurchChanged={() => undefined} />
        </main>
      ) : view === 'studio' ? (
        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {selected ? (
              <JobDetail job={selected} onBack={() => setSelectedId(null)} onDelete={handleDelete} onUpgrade={goPlans} />
            ) : (
              <Composer
                plan={account.plan}
                credits={account.credits}
                limits={limits}
                enhancesLeftToday={enhancesLeftToday}
                onStart={handleStart}
                onUpgrade={goPlans}
              />
            )}
          </div>
          <Library jobs={jobs} loading={historyLoading} selectedId={selectedId} onSelect={setSelectedId} />
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Current plan" value={PLAN_NAMES[account.plan] || 'Free'} />
            <Stat label="Credits available" value={Math.max(0, account.credits ?? 0).toLocaleString()} />
            <Stat label="Credits used this month" value={account.creditsUsedThisMonth.toLocaleString()} />
          </div>
          <h2 className="mt-12 text-2xl font-extrabold tracking-tight">Upgrade or top up</h2>
          <p className="mt-1 text-sm text-muted">Prices in USD, paid in cedis at the live rate. Mobile money, card or bank through Paystack.</p>
          <div className="mt-8">
            <Pricing currentPlan={account.plan} onChoose={onChoosePlan} />
          </div>
        </main>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
}
