import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, Pause, Play, Square } from 'lucide-react';
import { formatDuration } from '../../services/media';
import { saveChunk, startSession } from '../../services/recordingStore';

interface Props {
  onCancel: () => void;
  onDone: (blob: Blob, seconds: number, sessionId: string) => void;
}

type State = 'setup' | 'recording' | 'paused' | 'finishing';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Live recording with device choice, level meter, pause/resume and crash-safe storage. */
export default function LiveRecorder({ onCancel, onDone }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [state, setState] = useState<State>('setup');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [peakHold, setPeakHold] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sessionRef = useRef('');
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const rafRef = useRef(0);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  // Preview the input level as soon as a mic is chosen, so people can check before recording.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
        setDevices(list);
        if (!deviceId) setDeviceId(stream.getAudioTracks()[0]?.getSettings().deviceId || '');
        startMeter(stream);
        setError(null);
      } catch {
        setError('Microphone access was blocked. Allow the microphone in your browser settings, then try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
      wakeRef.current?.release().catch(() => {});
    },
    [],
  );

  function startMeter(stream: MediaStream) {
    cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {});
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let hold = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      setLevel(peak);
      hold = Math.max(peak, hold * 0.97);
      setPeakHold(hold);
      if (recorderRef.current?.state === 'recording') {
        const now = performance.now();
        elapsedRef.current += (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        setSeconds(elapsedRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  const start = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
    const id = `rec_${Date.now()}`;
    sessionRef.current = id;
    chunksRef.current = [];
    elapsedRef.current = 0;
    await startSession(id, rec.mimeType || mimeType || 'audio/webm');
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const index = chunksRef.current.length;
      chunksRef.current.push(e.data);
      saveChunk(id, index, e.data, elapsedRef.current);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      onDone(blob, elapsedRef.current, id);
    };
    lastTickRef.current = performance.now();
    rec.start(5000);
    recorderRef.current = rec;
    setState('recording');
    // Keep the screen awake during a long service where supported.
    try {
      wakeRef.current = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch {
      wakeRef.current = null;
    }
  };

  const pause = () => {
    recorderRef.current?.pause();
    setState('paused');
  };
  const resume = () => {
    lastTickRef.current = performance.now();
    recorderRef.current?.resume();
    setState('recording');
  };
  const stop = () => {
    setState('finishing');
    recorderRef.current?.stop();
    wakeRef.current?.release().catch(() => {});
  };

  const meterPct = Math.min(100, Math.round(Math.sqrt(level) * 100));
  const holdPct = Math.min(100, Math.round(Math.sqrt(peakHold) * 100));
  const clipping = peakHold > 0.98;
  const quiet = state !== 'setup' && peakHold < 0.03 && seconds > 3;

  return (
    <div className="card p-5 sm:p-8">
      {state === 'setup' && (
        <button type="button" onClick={onCancel} className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}

      <div className="mx-auto max-w-lg text-center">
        <p className="eyebrow text-accent">Live recording</p>
        <p className="mt-4 font-mono text-5xl font-bold tabular-nums sm:text-6xl" aria-live="off">{formatDuration(seconds)}</p>
        <p className="mt-2 h-5 text-sm text-muted">
          {state === 'recording' ? (
            <span className="inline-flex items-center gap-2 font-semibold text-danger"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" /> Recording</span>
          ) : state === 'paused' ? 'Paused' : state === 'finishing' ? 'Finishing…' : 'Ready when you are'}
        </p>

        <div className="mt-8" aria-label="Input level">
          <div className="relative h-3 overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-[width] duration-75 ${clipping ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${meterPct}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${holdPct}%` }} />
          </div>
          <p className="mt-2 h-4 text-xs">
            {clipping ? <span className="font-semibold text-danger">Too loud: move the mic back or lower the mixer.</span> : quiet ? <span className="text-warn">Very quiet: check the mic is connected.</span> : <span className="text-muted">Aim for the bar to move in the middle when people speak.</span>}
          </p>
        </div>

        {state === 'setup' && devices.length > 0 && (
          <label className="mt-6 block text-left text-xs font-semibold text-muted">
            Microphone or mixer input
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold outline-none focus:border-accent">
              {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </label>
        )}

        {error && <p className="mt-6 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

        <div className="mt-8 flex items-center justify-center gap-4">
          {state === 'setup' && (
            <button type="button" onClick={start} disabled={!streamRef.current || Boolean(error)} className="grid h-20 w-20 place-items-center rounded-full bg-danger text-white shadow-card transition-transform active:scale-95 disabled:opacity-40" aria-label="Start recording">
              <Mic className="h-8 w-8" />
            </button>
          )}
          {(state === 'recording' || state === 'paused') && (
            <>
              <button type="button" onClick={state === 'recording' ? pause : resume} className="grid h-14 w-14 place-items-center rounded-full border border-line bg-surface" aria-label={state === 'recording' ? 'Pause' : 'Resume'}>
                {state === 'recording' ? <Pause className="h-6 w-6" /> : <Play className="ml-0.5 h-6 w-6" />}
              </button>
              <button type="button" onClick={stop} className="grid h-20 w-20 place-items-center rounded-full bg-ink text-bg shadow-card active:scale-95" aria-label="Stop and edit">
                <Square className="h-7 w-7 fill-current" />
              </button>
            </>
          )}
        </div>
        {(state === 'recording' || state === 'paused') && (
          <p className="mt-6 text-xs text-muted">
            Saved on this device every few seconds. If the browser closes, you can recover the recording from the Recorder page.
          </p>
        )}
      </div>
    </div>
  );
}
