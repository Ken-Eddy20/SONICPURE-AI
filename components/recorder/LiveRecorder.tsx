import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, Pause, Play, RefreshCw, Square } from 'lucide-react';
import { formatDuration } from '../../services/media';
import { saveChunk, startSession } from '../../services/recordingStore';

interface Props {
  onCancel: () => void;
  onDone: (blob: Blob, seconds: number, sessionId: string) => void;
}

type State = 'setup' | 'recording' | 'paused' | 'finishing';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MIC_KEY = 'sp-mic';

const readSavedMic = () => {
  try {
    return localStorage.getItem(MIC_KEY) || '';
  } catch {
    return '';
  }
};
const saveMic = (id: string) => {
  try {
    localStorage.setItem(MIC_KEY, id);
  } catch {
    /* private mode: just not remembered */
  }
};

/** Friendly name for an input; Windows' "communications" duplicate is hidden from the list. */
const micLabel = (d: MediaDeviceInfo, i: number) => d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') || `Microphone ${i + 1}`;

/**
 * Live recording with a choice of microphone (switchable at any time, even mid-recording),
 * level meter, pause/resume and crash-safe storage.
 *
 * The mic feeds a small Web Audio graph and MediaRecorder records the graph's output, so
 * changing the input only reconnects one node: the recording carries on without a gap.
 */
export default function LiveRecorder({ onCancel, onDone }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [activeLabel, setActiveLabel] = useState('');
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<State>('setup');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [peakHold, setPeakHold] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const micRef = useRef<{ stream: MediaStream; source: MediaStreamAudioSourceNode } | null>(null);
  const graphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; dest: MediaStreamAudioDestinationNode } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(0);
  const rafRef = useRef(0);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const openSeq = useRef(0);

  /** The shared graph: mic source → analyser (meter) and → recording destination. */
  const graph = () => {
    if (!graphRef.current) {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 1;
      dest.channelCountMode = 'explicit';
      graphRef.current = { ctx, analyser, dest };
      startMeter(analyser);
    }
    return graphRef.current;
  };

  const refreshDevices = useCallback(async () => {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
    setDevices(list);
    return list;
  }, []);

  /** Open a microphone (or the system default) and plug it into the graph in place of the old one. */
  const openMic = useCallback(async (wanted: string, { quietFallback = false } = {}) => {
    const seq = ++openSeq.current;
    setSwitching(true);
    try {
      let stream: MediaStream;
      const constraints = (id: string): MediaStreamConstraints => ({
        audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(wanted));
      } catch (err) {
        // A remembered mic that is no longer plugged in: fall back to the default one.
        const name = (err as Error)?.name;
        if (!wanted || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
        stream = await navigator.mediaDevices.getUserMedia(constraints(''));
        if (!quietFallback) setNotice('That microphone is not available any more, so the default one is being used.');
      }
      if (seq !== openSeq.current) return stream.getTracks().forEach((t) => t.stop()); // a newer choice won
      const { ctx, analyser, dest } = graph();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      source.connect(dest);
      const old = micRef.current;
      micRef.current = { stream, source };
      if (old) {
        old.source.disconnect();
        old.stream.getTracks().forEach((t) => t.stop());
      }
      const track = stream.getAudioTracks()[0];
      const usedId = track?.getSettings().deviceId || wanted;
      setDeviceId(usedId);
      setActiveLabel(track?.label || 'Default microphone');
      if (usedId) saveMic(usedId);
      // If the mic is unplugged while in use, move to the default one automatically.
      if (track) {
        track.onended = () => {
          if (micRef.current?.stream === stream) {
            setNotice('The microphone was disconnected, so the default one is being used.');
            openMic('', { quietFallback: true });
          }
        };
      }
      await refreshDevices();
      setError(null);
    } catch {
      setError('Microphone access was blocked. Allow the microphone in your browser settings, then try again.');
    } finally {
      if (seq === openSeq.current) setSwitching(false);
    }
  }, [refreshDevices]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the remembered (or default) mic straight away so the level can be checked before recording.
  useEffect(() => {
    openMic(readSavedMic(), { quietFallback: true });
    const onChange = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  }, [openMic, refreshDevices]);

  useEffect(
    () => () => {
      openSeq.current++;
      cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      micRef.current?.stream.getTracks().forEach((t) => t.stop());
      graphRef.current?.ctx.close().catch(() => {});
      wakeRef.current?.release().catch(() => {});
    },
    [],
  );

  function startMeter(analyser: AnalyserNode) {
    cancelAnimationFrame(rafRef.current);
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
    if (!micRef.current) return;
    const { ctx, dest } = graph();
    await ctx.resume().catch(() => {});
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(dest.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
    const id = `rec_${Date.now()}`;
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

  const chooseMic = (id: string) => {
    setNotice(null);
    openMic(id);
  };

  const meterPct = Math.min(100, Math.round(Math.sqrt(level) * 100));
  const holdPct = Math.min(100, Math.round(Math.sqrt(peakHold) * 100));
  const clipping = peakHold > 0.98;
  const quiet = state !== 'setup' && peakHold < 0.03 && seconds > 3;
  const live = state === 'recording' || state === 'paused';

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

        {/* Microphone choice: always visible, switchable at any time. */}
        <div className="mt-7 rounded-2xl border border-line bg-sunken p-4 text-left">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mic-select" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted">
              <Mic className="h-3.5 w-3.5 text-accent" /> Recording from
            </label>
            <button type="button" onClick={() => refreshDevices()} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink" title="Look for newly connected microphones">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh list
            </button>
          </div>
          {devices.length > 0 ? (
            <select
              id="mic-select"
              value={devices.some((d) => d.deviceId === deviceId) ? deviceId : ''}
              onChange={(e) => chooseMic(e.target.value)}
              disabled={switching || state === 'finishing'}
              className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold outline-none focus:border-accent disabled:opacity-60"
            >
              {!devices.some((d) => d.deviceId === deviceId) && <option value="">{activeLabel || 'Default microphone'}</option>}
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.deviceId === 'default' ? `System default (${micLabel(d, i).replace(/^Default - /, '')})` : micLabel(d, i)}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-2 text-sm text-muted">{error ? 'No microphone available yet.' : 'Looking for microphones…'}</p>
          )}
          <p className="mt-2 text-xs text-muted">
            {switching
              ? 'Switching microphone…'
              : live
                ? 'You can change the microphone while recording; the recording carries on.'
                : devices.length > 1
                  ? `${devices.length} inputs found. Pick your mic, USB interface or mixer, then check the level below.`
                  : 'Plug in a USB mic or mixer at any time; it shows up here.'}
          </p>
          {notice && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-ink">{notice}</p>}
        </div>

        <div className="mt-6" aria-label="Input level">
          <div className="relative h-3 overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-[width] duration-75 ${clipping ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${meterPct}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${holdPct}%` }} />
          </div>
          <p className="mt-2 h-4 text-xs">
            {clipping ? <span className="font-semibold text-danger">Too loud: move the mic back or lower the mixer.</span> : quiet ? <span className="text-warn">Very quiet: check the mic is connected, or pick another input above.</span> : <span className="text-muted">Aim for the bar to move in the middle when people speak.</span>}
          </p>
        </div>

        {error && <p className="mt-6 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

        <div className="mt-8 flex items-center justify-center gap-4">
          {state === 'setup' && (
            <button type="button" onClick={start} disabled={!micRef.current || switching || Boolean(error)} className="grid h-20 w-20 place-items-center rounded-full bg-danger text-white shadow-card transition-transform active:scale-95 disabled:opacity-40" aria-label="Start recording">
              <Mic className="h-8 w-8" />
            </button>
          )}
          {live && (
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
        {live && (
          <p className="mt-6 text-xs text-muted">
            Saved on this device every few seconds. If the browser closes, you can recover the recording from the Recorder page.
          </p>
        )}
      </div>
    </div>
  );
}
