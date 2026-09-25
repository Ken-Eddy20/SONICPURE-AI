import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Upload, Film, Music, Lock, AlertTriangle, CheckCircle2, Loader2, ArrowUpRight, Download, Wand2, Mic, Square, XCircle, RotateCcw } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import FeatureSelector from './FeatureSelector';
import { convertBlobToMp3 } from '../services/audioUtils';

interface PlanInfo {
  extractAudioFromVideo: boolean;
  maxAudioLengthMins: number;
  maxDailyEnhances: number;
}

interface UserDocument {
  plan?: string;
  credits?: number;
}

interface CreditPlanDocument {
  extractAudioFromVideo?: boolean;
  maxAudioLengthMins?: number;
  maxDailyEnhances?: number;
}

interface AudioUploaderProps {
  onUploadSuccess?: (data: { fileId: string; processedFileUrl: string; creditsUsed: number; qualityLevel: number }) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

type StatusState = 'idle' | 'uploading' | 'processing' | 'done' | 'failed';

export default function AudioUploader({ onUploadSuccess }: AudioUploaderProps) {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [planName, setPlanName] = useState<'free' | 'payg' | 'pro' | 'audio_master'>('free');
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
  const [showUpgradeNotification, setShowUpgradeNotification] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            setStatus('processing');
            const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type: mimeType });
            // By naming it .mp3, we absolutely guarantee the backend (which hasn't restarted) won't classify it as a video format. Cleanvoice will natively decode it based on its WebM magic bytes anyway!
            const file = new File([blob], `recording.mp3`, { type: 'audio/mp3' });
            setError(null);
            setStatus('idle');
            setSelectedFile(file);
            setFileType('audio');
            stream.getTracks().forEach(track => track.stop());
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
          } catch (err: any) {
            console.error("Audio conversion failed:", err);
            setError(`Failed to process recording: ${err.message || 'Unknown error'}`);
            setStatus('idle');
            setIsRecording(false);
            stream.getTracks().forEach(track => track.stop());
            if (timerRef.current) clearInterval(timerRef.current);
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
        setRecordingTime(0);
        timerRef.current = setInterval(() => {
          setRecordingTime(t => t + 1);
        }, 1000);
      } catch (err) {
        console.error("Error accessing microphone", err);
        setError("Error accessing microphone. Please allow permissions.");
      }
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedFile]);

  useEffect(() => {
    const fetchPlanForUser = async (uid: string) => {
      try {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (!userSnap.exists()) {
          setPlanName('free');
          setPlanInfo({
            extractAudioFromVideo: false,
            maxAudioLengthMins: 10,
            maxDailyEnhances: 2,
          });
          setUserCredits(0);
          setCreditsRemaining(0);
          return;
        }

        const userData = userSnap.data() as UserDocument;
        const plan = (userData.plan as 'free' | 'payg' | 'pro' | 'audio_master') || 'free';
        setPlanName(plan);
        setCreditsRemaining(userData.credits ?? 0);
        setUserCredits(userData.credits ?? 0);

        const planSnap = await getDoc(doc(db, 'creditPlans', plan));
        if (!planSnap.exists()) {
          setPlanInfo({
            extractAudioFromVideo: false,
            maxAudioLengthMins: 10,
            maxDailyEnhances: 2,
          });
          return;
        }

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
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      if (!user) {
        setPlanName('free');
        setPlanInfo({
          extractAudioFromVideo: false,
          maxAudioLengthMins: 10,
          maxDailyEnhances: 2,
        });
        setUserCredits(null);
        setCreditsRemaining(null);
        setLoading(false);
        return;
      }

      await fetchPlanForUser(user.uid);
    });

    return () => unsubscribe();
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
      setError('Video uploads require a Pro or Audio Master plan.');
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
        setError(data.error || 'The audio processing engine encountered an error. This can happen with very noisy files or unsupported formats.');
      } else {
        // Still processing
        setTimeout(() => pollStatus(fileId, token), 3000);
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
      if (selectedFile.name.startsWith('recording.')) {
        formData.append('durationSeconds', recordingTime.toString());
      }
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
          throw new Error('Daily limit reached. Upgrade for more enhancements.');
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
        setError(msg || 'Video uploads are not available on your plan. Upgrade to Pro or Audio Master.');
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
      
      {/* Main Container with stable layout */}
      <div className="min-h-[400px] flex flex-col justify-center">
      
      {status === 'idle' ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <FeatureSelector
            selectedFeature={selectedFeature}
            onFeatureSelect={setSelectedFeature}
            userCredits={userCredits}
            isUnlimited={planName === 'audio_master'}
            userPlan={planName}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center border-2 border-dashed border-indigo-300 dark:border-white/10 rounded-2xl py-12 bg-indigo-50/70 hover:bg-indigo-100/80 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-all cursor-pointer group relative"
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
              <p className="font-medium text-slate-800 dark:text-gray-300 mb-1">
                Click to select {planInfo?.extractAudioFromVideo ? 'audio or video' : 'audio'} file
              </p>
              <p className="text-xs text-slate-600 dark:text-gray-500">
                {planInfo?.extractAudioFromVideo
                  ? 'MP3, WAV, M4A, FLAC, OGG, MP4, MOV, AVI, MKV, WEBM'
                  : 'MP3, WAV, M4A, FLAC, OGG, AAC'}
              </p>
            </div>

            <div
              onClick={toggleRecording}
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl py-12 transition-all cursor-pointer group relative ${
                isRecording 
                  ? 'border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10' 
                  : 'border-indigo-300 dark:border-white/10 bg-indigo-50/70 hover:bg-indigo-100/80 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]'
              }`}
            >
              <div className={`p-4 rounded-full mb-4 group-hover:scale-110 transition-transform ${
                isRecording ? 'bg-red-100 dark:bg-red-500/20 animate-pulse' : 'bg-indigo-50 dark:bg-indigo-500/10'
              }`}>
                {isRecording ? (
                  <Square className="w-7 h-7 text-red-600 dark:text-red-500" fill="currentColor" />
                ) : (
                  <Mic className="w-7 h-7 text-indigo-600 dark:text-indigo-500" />
                )}
              </div>
              <p className={`font-medium mb-1 ${isRecording ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-gray-300'}`}>
                {isRecording ? 'Stop Recording' : 'Record Audio'}
              </p>
              {isRecording ? (
                <div className="text-xl font-bold font-mono text-red-600 dark:text-red-400 mt-1 px-4 py-1 rounded-lg bg-red-100 dark:bg-red-500/20 tabular-nums">
                  {formatTime(recordingTime)}
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-gray-500 font-mono">
                  Use your microphone
                </p>
              )}
            </div>
          </div>

          {selectedFile && (
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-3">
                {fileType === 'video' ? <Film className="w-5 h-5 text-purple-500 shrink-0" /> : <Music className="w-5 h-5 text-indigo-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {fileType === 'video' ? 'Video file' : 'Audio file'} &middot; {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                    {selectedFile.name.startsWith('recording.') && ` \u00B7 ${formatTime(recordingTime)}`}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setFileType(null); }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Remove
                </button>
              </div>
              {previewUrl && (
                <div className="mt-2">
                  <p className="text-xs font-semibold mb-2 text-gray-500 uppercase tracking-wide">Preview</p>
                  {fileType === 'video' ? (
                    <video controls src={previewUrl} className="w-full max-h-48 rounded-lg bg-black" />
                  ) : (
                    <audio controls src={previewUrl} className="w-full h-10" />
                  )}
                </div>
              )}
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
                  onChange={(e) => {
                    let val = Number(e.target.value);
                    if ((planName === 'free' || planName === 'payg') && val > 80) {
                      setShowUpgradeNotification(true);
                      val = 80;
                    } else {
                      setShowUpgradeNotification(false);
                    }
                    setIntensity(val);
                  }}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-indigo-600"
                />
                
                {showUpgradeNotification && (planName === 'free' || planName === 'payg') && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-sm flex gap-3 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                      <p className="font-semibold mb-1">Intensity Locked at 80%</p>
                      <p>Your current plan limits processing to 80% maximum effect. Upgrade to Pro for full studio quality.</p>
                      <a href="#pricing" className="inline-block mt-2 font-bold underline hover:no-underline pointer-events-auto">Upgrade Now</a>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleProcessUpload}
              disabled={!selectedFile || !selectedFeature}
              className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              <Wand2 className="w-5 h-5" />
              Clean & Enhance Audio
            </button>
          </div>
        </motion.div>
      ) : status === 'failed' ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-12 text-center bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-3xl"
        >
          <div className="w-16 h-16 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8" />
          </div>
          <h3 className="text-2xl font-bold mb-4 text-red-900 dark:text-red-100">Processing Failed</h3>
          <p className="text-gray-600 dark:text-red-300/70 mb-8 max-w-sm mx-auto leading-relaxed">
            {error || 'Something went wrong during the enhancement process.'}
          </p>
          
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button 
              onClick={handleProcessUpload}
              className="py-4 px-8 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-500/20"
            >
              <RotateCcw className="w-5 h-5" />
              Try Again
            </button>
            <button 
              onClick={() => {
                setStatus('idle');
                setError(null);
              }}
              className="py-4 px-8 rounded-2xl bg-white dark:bg-white/5 border border-red-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-900 dark:text-white font-bold transition-all"
            >
              Back to Start
            </button>
          </div>
        </motion.div>
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
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="p-12 text-center bg-white dark:bg-white/5 border border-indigo-200 dark:border-indigo-500/20 rounded-[2.5rem] relative overflow-hidden shadow-2xl shadow-indigo-500/10"
        >
          {/* Animated Background Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-pink-500/5 animate-pulse" />
          
          {/* Premium Waveform Animation */}
          <div className="relative z-10 flex items-center justify-center gap-1.5 h-16 mb-8">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                animate={{ 
                  height: [20, 40, 20, 60, 20],
                }}
                transition={{ 
                  duration: 1.5, 
                  repeat: Infinity, 
                  delay: i * 0.1,
                  ease: "easeInOut"
                }}
                className="w-1.5 bg-indigo-500 rounded-full opacity-60"
              />
            ))}
          </div>

          <h3 className="relative z-10 text-2xl font-bold mb-3 tracking-tight">SonicPure AI is enhancing your audio...</h3>
          <p className="relative z-10 text-gray-500 dark:text-indigo-200/50 text-sm mb-8 font-medium">Please stay on this page. Estimated time: 10-30 seconds.</p>
          
          <div className="relative z-10 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
              <span className="text-indigo-700 dark:text-indigo-300 font-bold text-xs uppercase tracking-widest">
                {selectedFeature === 'noise_vocal' ? 'Noise Removal + Voice Clarity' : 'Studio Enhancement'}
              </span>
            </div>
            
            <div className="text-[10px] text-gray-400 dark:text-white/20 uppercase tracking-[0.2em] font-bold">
              AI ENGINE V2.4 ACTIVE
            </div>
          </div>
        </motion.div>
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
            <p>Credits remaining: {creditsRemaining === -1 ? 'Full Access' : creditsRemaining}</p>
          </div>
        </div>
      ) : null}
      
      </div>
    </div>
  );
}
