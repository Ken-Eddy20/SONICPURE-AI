import React, { useState, useEffect, useRef } from 'react';
import { Upload, Film, Music, Lock, AlertTriangle, CheckCircle2, Loader2, ArrowUpRight, Download, Wand2 } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { CreditPlanDocument, UserDocument } from '../types/firestore';
import FeatureSelector from './FeatureSelector';

interface PlanInfo {
  extractAudioFromVideo: boolean;
  maxAudioLengthMins: number;
  maxDailyEnhances: number;
}

interface AudioUploaderProps {
  onUploadSuccess?: (data: { fileId: string; processedFileUrl: string; creditsUsed: number; qualityLevel: number }) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

type StatusState = 'idle' | 'uploading' | 'processing' | 'done' | 'failed';

export default function AudioUploader({ onUploadSuccess }: AudioUploaderProps) {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [planName, setPlanName] = useState<'free' | 'payg' | 'pro' | 'unlimited'>('free');
  const [userCredits, setUserCredits] = useState<number | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'audio' | 'video' | null>(null);
  
  const [status, setStatus] = useState<StatusState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creditsNeededForError, setCreditsNeededForError] = useState<number | null>(null);
  
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [qualityAchieved, setQualityAchieved] = useState<number | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  
  const [intensity, setIntensity] = useState<number>(80);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchPlan() {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!userSnap.exists()) { setLoading(false); return; }
        const userData = userSnap.data() as UserDocument;
        const plan = (userData.plan as 'free' | 'payg' | 'pro' | 'unlimited') || 'free';
        setPlanName(plan);
        setCreditsRemaining(userData.credits || 0);
        setUserCredits(userData.credits || 0);

        const planSnap = await getDoc(doc(db, 'creditPlans', plan));
        if (!planSnap.exists()) { setLoading(false); return; }
        const planData = planSnap.data() as CreditPlanDocument;

        setPlanInfo({
          extractAudioFromVideo: planData.extractAudioFromVideo ?? false,
          maxAudioLengthMins: planData.maxAudioLengthMins ?? 10,
          maxDailyEnhances: planData.maxDailyEnhances ?? 2,
        });
      } catch (err) {
        console.error('Error fetching plan:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchPlan();
  }, []);

  const acceptTypes = planInfo?.extractAudioFromVideo
    ? 'audio/*,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm'
    : 'audio/*';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setStatus('idle');
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isAudio = file.type.startsWith('audio/');

    if (!isAudio && !isVideo) {
      setError('Please select a valid audio or video file.');
      return;
    }

    if (isVideo && !planInfo?.extractAudioFromVideo) {
      setError('Video uploads require a Pro or Unlimited plan.');
      setSelectedFile(null);
      setFileType(null);
      return;
    }

    setSelectedFile(file);
    setFileType(isVideo ? 'video' : 'audio');
  };

  const pollStatus = async (fileId: string, token: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/audio/status/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to check status');

      if (data.status === 'processed' || data.status === 'completed') {
        setStatus('done');
        setProcessedUrl(data.processedFileUrl);
        setQualityAchieved(data.qualityLevel);
        setCreditsUsed(data.creditsUsed);
        setCreditsRemaining(data.creditsRemaining);
        onUploadSuccess?.(data);
      } else if (data.status === 'failed') {
        setStatus('failed');
        setError('Processing failed. Your credits were not deducted. Please try again.');
      } else {
        // Still processing
        setTimeout(() => pollStatus(fileId, token), 5000);
      }
    } catch (err: any) {
      setStatus('failed');
      setError('Network error tracking processing status. Check your console.');
      console.error(err);
    }
  };

  const handleProcessUpload = async () => {
    if (!selectedFile || !selectedFeature) return;
    const user = auth.currentUser;
    if (!user) {
      setError('Please sign in to upload files.');
      return;
    }

    setStatus('uploading');
    setProgress(0);
    setError(null);
    setCreditsNeededForError(null);

    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append('audio', selectedFile);
      formData.append('feature', selectedFeature);
      // Let the backend calculate duration and deduct correctly

      const xhr = new XMLHttpRequest();
      const uploadResult = await new Promise<any>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              reject({ status: xhr.status, data });
            }
          } catch {
            reject({ status: xhr.status, data: { error: 'Invalid response' } });
          }
        });
        xhr.addEventListener('error', () => reject({ status: 0, data: { error: 'Network error' } }));
        xhr.open('POST', `${API_BASE}/api/audio/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      const fileId = uploadResult.fileId;
      setStatus('processing');
      
      // Step 2: Trigger processing route
      const procRes = await fetch(`${API_BASE}/api/audio/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ fileId, feature: selectedFeature })
      });
      
      const procData = await procRes.json();
      
      if (!procRes.ok) {
        if (procRes.status === 402) {
          setCreditsNeededForError(procData.creditsNeeded);
          throw new Error('Not enough credits.');
        } else if (procRes.status === 429) {
          throw new Error('Daily limit reached. Upgrade for unlimited enhancements.');
        } else {
          throw new Error(procData.error || 'Processing failed. No credits were deducted. Try again.');
        }
      }

      // Backend returned 200 or 202, begin polling
      if (procData.success && procData.processedFileUrl) {
         setStatus('done');
         setProcessedUrl(procData.processedFileUrl);
         setQualityAchieved(procData.qualityLevel);
         setCreditsUsed(procData.creditsUsed);
         setCreditsRemaining(procData.creditsRemaining);
         onUploadSuccess?.(procData);
      } else {
         pollStatus(fileId, token);
      }

    } catch (err: any) {
      setStatus('failed');
      const status = err?.status;
      const msg = err?.data?.error || err.message;

      if (status === 403) {
        setError(msg || 'Video uploads are not available on your plan. Upgrade to Pro or Unlimited.');
      } else if (status === 429) {
        setError(msg || 'You have reached your limit.');
      } else if (status === 400) {
        setError(msg || 'Your audio exceeds the maximum length for your plan.');
      } else if (status === 401) {
        setError('Session expired. Please sign in again.');
      } else {
        setError(msg || 'Request failed.');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Upload/Processing states take over the screen */}
      {status === 'idle' || status === 'failed' ? (
        <>
          <FeatureSelector
            selectedFeature={selectedFeature}
            onFeatureSelect={setSelectedFeature}
            userCredits={userCredits}
            isUnlimited={planName === 'unlimited'}
            userPlan={planName}
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl py-12 bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-all cursor-pointer group relative"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={acceptTypes}
              onChange={handleFileChange}
            />
            <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 rounded-full mb-4 group-hover:scale-110 transition-transform">
              <Upload className="w-7 h-7 text-indigo-600 dark:text-indigo-500" />
            </div>
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
              Click to select {planInfo?.extractAudioFromVideo ? 'audio or video' : 'audio'} file
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {planInfo?.extractAudioFromVideo
                ? 'MP3, WAV, M4A, FLAC, OGG, MP4, MOV, AVI, MKV, WEBM'
                : 'MP3, WAV, M4A, FLAC, OGG, AAC'}
            </p>
          </div>

          {selectedFile && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              {fileType === 'video' ? <Film className="w-5 h-5 text-purple-500 shrink-0" /> : <Music className="w-5 h-5 text-indigo-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {fileType === 'video' ? 'Video file' : 'Audio file'} &middot; {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setFileType(null); }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Remove
              </button>
            </div>
          )}

          {error && (
            <div className="flex flex-col sm:flex-row items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                {error}
                {creditsNeededForError && <span> You need {creditsNeededForError} credits.</span>}
              </div>
              {(creditsNeededForError || error.includes("Upgrade")) && (
                <a href="#pricing" className="shrink-0 font-bold bg-white dark:bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-500/30 hover:bg-gray-50 dark:hover:bg-red-500/40 transition-colors">
                  Upgrade
                </a>
              )}
            </div>
          )}

          <div className="pt-2">
            {!selectedFeature && selectedFile && (
              <p className="text-xs text-red-500 mb-2 text-center">Please select a feature first</p>
            )}

            {selectedFeature && (
              <div className="mb-6 p-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-indigo-500" />
                    Effect Intensity
                  </label>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold text-lg">{intensity}%</span>
                </div>
                
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-indigo-600"
                />
                
                {intensity > 80 && (planName === 'free' || planName === 'payg') && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm flex gap-3 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-semibold mb-1">100% Intensity Locked</p>
                      <p>Your current plan limits processing to 80% maximum effect. Upgrade to Pro for full studio quality.</p>
                      <a href="#pricing" className="inline-block mt-2 font-bold underline hover:no-underline pointer-events-auto">Upgrade Now</a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleProcessUpload}
              disabled={!selectedFile || !selectedFeature || (intensity > 80 && (planName === 'free' || planName === 'payg'))}
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              <Upload className="w-5 h-5" />
              Upload & Process
            </button>
          </div>
        </>
      ) : status === 'uploading' ? (
        <div className="p-12 text-center bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-3xl">
          <Upload className="w-10 h-10 text-indigo-500 mx-auto mb-4 animate-bounce" />
          <h3 className="text-xl font-bold mb-2">Uploading your {fileType} file...</h3>
          <div className="max-w-xs mx-auto mb-4 bg-gray-200 dark:bg-white/10 h-2 pl-0 rounded-full overflow-hidden">
             <div className="h-full bg-indigo-500" style={{ width: `${progress}%` }}></div>
          </div>
          <p className="text-sm font-mono text-indigo-600 dark:text-indigo-400">{progress}%</p>
        </div>
      ) : status === 'processing' ? (
        <div className="p-12 text-center bg-gray-50 dark:bg-white/5 border border-indigo-200 dark:border-indigo-500/20 rounded-3xl relative overflow-hidden">
          <div className="absolute inset-0 bg-indigo-500/5 animate-pulse" />
          <Loader2 className="relative z-10 w-12 h-12 text-indigo-500 mx-auto mb-6 animate-spin" />
          <h3 className="relative z-10 text-xl font-bold mb-2">Cleanvoice AI is processing your audio...</h3>
          <p className="relative z-10 text-gray-500 dark:text-gray-400 text-sm mb-6">This usually takes 1-3 minutes</p>
          <div className="relative z-10 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-semibold text-xs uppercase tracking-wider">
            {planName === 'pro' || planName === 'unlimited' ? 'Processing at 100% quality' : 'Processing at 80% quality'}
          </div>
        </div>
      ) : status === 'done' ? (
        <div className="p-12 text-center bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 rounded-3xl">
          <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-3xl font-bold mb-4 text-emerald-900 dark:text-emerald-100">Your audio is ready!</h3>
          
          <div className={`mx-auto max-w-sm mb-8 text-sm p-4 rounded-xl border ${qualityAchieved === 100 ? 'bg-emerald-100/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-200' : 'bg-amber-100/50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200'}`}>
            {qualityAchieved === 100 ? (
               <p className="font-semibold flex items-center justify-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Processed at 100% full quality ✅</p>
            ) : (
               <div className="space-y-2">
                 <p className="font-semibold flex items-center justify-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Processed at 80% quality</p>
                 <a href="#pricing" className="text-amber-700 dark:text-amber-300 underline font-medium">Upgrade to Pro for 100% full effect.</a>
               </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-8">
            <a 
              href={processedUrl!} 
              target="_blank" 
              rel="noopener noreferrer"
              download
              className="py-4 px-8 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Download className="w-5 h-5" />
              Download Audio
            </a>
            <button 
              onClick={() => {
                setStatus('idle');
                setSelectedFile(null);
                setProcessedUrl(null);
              }}
              className="py-4 px-8 rounded-2xl bg-white dark:bg-white/5 border border-emerald-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-900 dark:text-white font-bold transition-all"
            >
              Process Another File
            </button>
          </div>

          <div className="flex justify-center gap-4 text-xs font-medium text-gray-500 dark:text-gray-400">
            <p>Credits used: {creditsUsed}</p>
            <p>Credits remaining: {creditsRemaining === -1 ? 'Unlimited' : creditsRemaining}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
