/**
 * Turns transcript segments into an Advanced SubStation (.ass) file that ffmpeg
 * burns into video. Sizes scale with the video so vertical (9:16) and landscape
 * videos both look right.
 */

const MAX_WORDS_PER_CUE = 9;

const SIZE_FACTOR = { small: 0.042, medium: 0.054, large: 0.07 };
const ALIGNMENT = { bottom: 2, middle: 5, top: 8 };

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function escapeAss(text) {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\s+/g, ' ').trim();
}

/** Split long segments into short cues, sharing the segment's time by word count. */
export function toCues(segments) {
  const cues = [];
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const span = Math.max(0.5, seg.end - seg.start);
    const parts = Math.ceil(words.length / MAX_WORDS_PER_CUE);
    const perPart = Math.ceil(words.length / parts);
    for (let p = 0; p < parts; p++) {
      const slice = words.slice(p * perPart, (p + 1) * perPart);
      const from = seg.start + (span * (p * perPart)) / words.length;
      const to = seg.start + (span * Math.min(words.length, (p + 1) * perPart)) / words.length;
      cues.push({ start: from, end: Math.max(to, from + 0.6), text: slice.join(' ') });
    }
  }
  // Never overlap: a cue ends where the next begins.
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
  return cues.filter((c) => c.end > c.start);
}

/**
 * @param {{start:number,end:number,text:string}[]} segments
 * @param {{width:number,height:number}} video
 * @param {{style:'classic'|'boxed'|'social', position:'bottom'|'middle'|'top', size:'small'|'medium'|'large'}} look
 */
export function buildAss(segments, video, look) {
  const width = video.width || 1920;
  const height = video.height || 1080;
  const base = Math.min(width, height);
  let fontSize = Math.round(base * (SIZE_FACTOR[look.size] || SIZE_FACTOR.medium));
  if (look.style === 'social') fontSize = Math.round(fontSize * 1.25);
  const outline = Math.max(2, Math.round(fontSize * 0.08));
  const marginV = Math.round(height * 0.08);
  const marginH = Math.round(width * 0.06);
  const align = ALIGNMENT[look.position] || 2;

  // Colours are &HAABBGGRR (alpha 00 = opaque).
  const styles = {
    classic: { primary: '&H00FFFFFF', outlineColor: '&H00000000', back: '&H64000000', border: 1, outline, shadow: 1 },
    boxed: { primary: '&H00FFFFFF', outlineColor: '&H40000000', back: '&H40000000', border: 3, outline: Math.round(fontSize * 0.3), shadow: 0 },
    social: { primary: '&H0000E5FF', outlineColor: '&H00000000', back: '&H64000000', border: 1, outline: outline + 2, shadow: 2 },
  };
  const s = styles[look.style] || styles.classic;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Noto Sans,${fontSize},${s.primary},&H000000FF,${s.outlineColor},${s.back},-1,0,0,0,100,100,0,0,${s.border},${s.outline},${s.shadow},${align},${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = toCues(segments).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${escapeAss(c.text)}`,
  );
  return [...header, ...events, ''].join('\n');
}
