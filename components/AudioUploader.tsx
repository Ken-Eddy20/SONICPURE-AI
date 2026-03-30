import React, { useState, useEffect, useRef } from 'react';
import { Upload, Film, Music, Lock, AlertTriangle, CheckCircle2, Loader2, ArrowUpRight } from 'lucide-react';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { CreditPlanDocument, UserDocument } from '../types/firestore';

type Feature = 'noise_removal' | 'audio_enhancement' | 'voice_clarity';

interface PlanInfo {
  extractAudioFromVideo: boolean;
  maxAudioLengthMins: number;
  maxDailyEnhances: number;
}

interface AudioUploaderProps {
  onUploadSuccess?: (data: { fileId: string; originalFileUrl: string; extractedAudioUrl: string | null; sourceType: string }) => void;
}

const FEATURES: { value: Feature; label: string; desc: string }[] = [
  { value: 'noise_removal', label: 'Noise Removal', desc: 'Remove background noise' },
  { value: 'audio_enhancement', label: 'Audio Enhancement', desc: 'Improve overall quality' },
  { value: 'voice_clarity', label: 'Voice Clarity', desc: 'Enhance speech clarity' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export default function AudioUploader({ onUploadSuccess }: AudioUploaderProps) {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [planName, setPlanName] = useState('free');
  const [loading, setLoading] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState<Feature>('noise_removal');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'audio' | 'video' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
        const plan = userData.plan || 'free';
        setPlanName(plan);

        const planSnap = await getDoc(doc(db, 'creditPlans', plan));
        if (!planSnap.exists()) { setLoading(false); return; }
        const planData = planSnap.data() as CreditPlanDocument;

        setPlanInfo({
          extractAudioFromVideo: planData.extractAudioFromVideo,
          maxAudioLengthMins: planData.maxAudioLengthMins,
          maxDailyEnhances: planData.maxDailyEnhances,
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
    setSuccess(null);
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

  const handleUpload = async () => {
    if (!selectedFile) return;
    const user = auth.currentUser;
    if (!user) {
      setError('Please sign in to upload files.');
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);
    setSuccess(null);

    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append('audio', selectedFile);
      formData.append('feature', selectedFeature);

      const xhr = new XMLHttpRequest();

      const result = await new Promise<any>((resolve, reject) => {
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

      setSuccess(`Upload successful. Processing your audio... (File ID: ${result.fileId})`);
      onUploadSuccess?.(result);
    } catch (err: any) {
      const status = err?.status;
      const msg = err?.data?.error;

      if (status === 403) {
        setError(msg || 'Video uploads are not available on your plan. Upgrade to Pro or Unlimited.');
      } else if (status === 429) {
        setError(msg || 'You have reached your daily upload limit. Upgrade your plan for unlimited uploads.');
      } else if (status === 400) {
        setError(msg || 'Your audio exceeds the maximum length for your plan. Upgrade for longer audio.');
      } else if (status === 401) {
        setError('Session expired. Please sign in again.');
      } else {
        setError(msg || 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
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
      {/* Plan limits info */}
      {planInfo && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Max Length</p>
            <p className="font-semibold text-sm">
              {planInfo.maxAudioLengthMins === -1 ? 'Unlimited' : `${planInfo.maxAudioLengthMins} min`}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Daily Uploads</p>
            <p className="font-semibold text-sm">
              {planInfo.maxDailyEnhances === -1 ? 'Unlimited' : `${planInfo.maxDailyEnhances}/day`}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Video Extract</p>
            <p className={`font-semibold text-sm ${planInfo.extractAudioFromVideo ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
              {planInfo.extractAudioFromVideo ? 'Supported' : 'Locked'}
            </p>
          </div>
        </div>
      )}

      {/* Video extraction locked banner */}
      {planInfo && !planInfo.extractAudioFromVideo && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
          <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Video extraction is available on Pro and Unlimited plans.
            </p>
          </div>
          <a href="#pricing" className="flex items-center gap-1 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:underline shrink-0">
            Upgrade <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Feature selector */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-widest text-gray-500 dark:text-white/40 font-semibold">Processing Type</label>
        <div className="grid grid-cols-3 gap-2">
          {FEATURES.map((f) => (
            <button
              key={f.value}
              onClick={() => setSelectedFeature(f.value)}
              className={`p-3 rounded-xl border text-left transition-all text-sm ${
                selectedFeature === f.value
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
              }`}
            >
              <p className="font-medium">{f.label}</p>
              <p className="text-xs opacity-70 mt-0.5">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* File input */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-white/10 rounded-2xl py-12 bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.02] dark:hover:bg-white/[0.04] transition-all cursor-pointer group"
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

      {/* Selected file display */}
      {selectedFile && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10">
          {fileType === 'video' ? (
            <Film className="w-5 h-5 text-purple-500 shrink-0" />
          ) : (
            <Music className="w-5 h-5 text-indigo-500 shrink-0" />
          )}
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

      {/* Upload progress */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Uploading{fileType === 'video' ? ' & extracting audio' : ''}...</span>
            <span className="font-mono text-indigo-600 dark:text-indigo-400">{progress}%</span>
          </div>
          <div className="h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          {success}
        </div>
      )}

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={!selectedFile || uploading}
        className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
      >
        {uploading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="w-5 h-5" />
            Upload & Process
          </>
        )}
      </button>
    </div>
  );
}
