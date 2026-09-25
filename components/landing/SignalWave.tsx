import { useEffect, useRef } from 'react';

const BARS = 84;

// Deterministic "speech" envelope: syllable bumps with short pauses between words.
function speechEnvelope(i: number) {
  const word = Math.floor(i / 12);
  const pos = (i % 12) / 12;
  if (pos > 0.82) return 0.04;
  const syllable = Math.abs(Math.sin(pos * Math.PI * (2 + (word % 3))));
  const accent = 0.55 + 0.45 * Math.abs(Math.sin(word * 1.7 + 0.6));
  return 0.1 + syllable * accent * 0.85;
}

const ENVELOPE = Array.from({ length: BARS }, (_, i) => speechEnvelope(i));

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Animated before/after waveform. A scan line sweeps left to right; bars it has
 * passed are "cleaned" (voice only), bars ahead of it still carry noise.
 */
export default function SignalWave() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const noiseSeed = Array.from({ length: BARS }, () => Math.random());
    let raf = 0;
    let start = performance.now();
    let visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const accent = cssVar('--accent');
      const noise = cssVar('--noise');
      const faint = cssVar('--line-strong');

      // 5s sweep, then 1.2s hold on the clean result, then restart.
      const cycle = 6200;
      const t = reduced ? 0.5 : ((now - start) % cycle) / 5000;
      const scan = Math.min(t, 1) * width;

      const gap = width / BARS;
      const barW = Math.max(2, gap * 0.52);
      const mid = height / 2;

      for (let i = 0; i < BARS; i++) {
        const x = i * gap + (gap - barW) / 2;
        const clean = x + barW / 2 < scan;
        const env = ENVELOPE[i];
        let amp: number;
        if (clean) {
          amp = env;
        } else {
          const flicker = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 90 + noiseSeed[i] * 40);
          amp = Math.min(1, env * 0.9 + 0.18 + noiseSeed[i] * 0.22 * flicker);
        }
        const h = Math.max(3, amp * (height * 0.86));
        ctx.fillStyle = clean ? accent : env < 0.06 ? faint : noise;
        ctx.globalAlpha = clean ? 1 : 0.55 + env * 0.4;
        ctx.beginPath();
        ctx.roundRect(x, mid - h / 2, barW, h, barW / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (scan > 0 && scan < width) {
        const grad = ctx.createLinearGradient(scan - 40, 0, scan, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, accent);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = grad;
        ctx.fillRect(scan - 40, 0, 40, height);
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.fillRect(scan - 1, 4, 2, height - 8);
      }

      if (!reduced && visible) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(performance.now());
    });
    ro.observe(canvas);

    // Pause the loop while off-screen.
    const io = new IntersectionObserver(([entry]) => {
      const wasVisible = visible;
      visible = entry.isIntersecting;
      if (visible && !wasVisible && !reduced) {
        start = performance.now();
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);

    // Redraw the static frame when the theme changes.
    const mo = new MutationObserver(() => reduced && draw(performance.now()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
