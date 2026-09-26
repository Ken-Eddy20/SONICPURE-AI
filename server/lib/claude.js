/**
 * Meeting minutes with Claude: summary, decisions and action items as structured JSON.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';

export function minutesConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const MINUTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'keyPoints', 'decisions', 'actionItems', 'topics'],
  properties: {
    title: { type: 'string', description: 'Short meeting title (under 10 words).' },
    summary: { type: 'string', description: 'One or two paragraphs covering purpose, discussion and outcome.' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'owner', 'due'],
        properties: {
          task: { type: 'string' },
          owner: { type: 'string', description: 'Person or group responsible, or an empty string if not stated.' },
          due: { type: 'string', description: 'Deadline as said in the meeting, or an empty string if not stated.' },
        },
      },
    },
    topics: {
      type: 'array',
      description: 'Main agenda topics in the order discussed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'title'],
        properties: {
          start: { type: 'number', description: 'Seconds from the start of the recording where the topic begins.' },
          title: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You write clear, accurate meeting minutes for organisations in Ghana (businesses, churches, schools, associations and NGOs).
Work only from the transcript. Never invent names, figures, decisions or deadlines; if something is unclear, leave it out or say it is unclear.
Use the speaker names exactly as they appear in the transcript. Write in plain English that a busy reader can scan.
Decisions are things the group agreed. Action items are specific tasks someone must do after the meeting.`;

const timecode = (s) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * @param {{start:number,end:number,text:string,speaker?:string}[]} segments English segments
 * @param {{title:string,date:string,language:string,note?:string}} meta
 */
export async function generateMinutes(segments, meta) {
  const transcript = segments
    .map((s) => `[${timecode(s.start)} | ${Math.round(s.start)}s]${s.speaker ? ` ${s.speaker}:` : ''} ${s.text}`)
    .join('\n');

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: MINUTES_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Meeting: ${meta.title}
Date: ${meta.date || 'not given'}
${meta.note ? `${meta.note}\n` : ''}
<transcript>
${transcript}
</transcript>

Write the minutes for this meeting.`,
      },
    ],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('The minutes could not be written for this recording.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The minutes were cut off. Try again.');
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const minutes = JSON.parse(text);
  return {
    ...minutes,
    model: message.model,
    generatedAt: new Date(),
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}
