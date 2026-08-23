import Anthropic from '@anthropic-ai/sdk';

/**
 * Binder filler art, in two steps.
 *
 * `brief` — Claude looks at the cards on a page and writes an art brief. The
 * instruction that matters is that it describes the *illustration* and ignores
 * everything the card frame adds: borders, text boxes, HP, energy and set
 * symbols, holo pattern, name plates.
 *
 * `image` — an image model renders that brief. Claude has no image generation,
 * so this half goes to another provider; which one is an env var.
 */

/**
 * Image generation runs well past Vercel's 10s default. 60s is the Hobby
 * ceiling; Pro allows more if a bigger model needs it.
 */
export const maxDuration = 60;

interface Req {
  method?: string;
  body?: unknown;
}

interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

type ImageRef = { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string };

const MAX_REFERENCES = 6;

const BRIEF_SYSTEM = `You write art briefs for trading-card binder filler: printed art that sits in empty pockets beside real cards.

You will be shown photographs or scans of cards. Read ONLY the illustration on each card. Ignore everything the card frame adds — borders, name plates, HP, energy and type symbols, attack and rules text, set and rarity symbols, holo or texture patterns, and any stamped logos. Those are printing furniture, not the art.

From the illustrations, work out what the page has in common: setting, time of day, weather, palette, light, depth, and how the art is rendered (brush, airbrush, cel, digital painting, pixel, watercolour).

Then write a prompt for an image model that will produce a BACKGROUND that belongs on the same page.

Rules for that prompt:
- Background and setting only. No creatures, characters, mascots, people, or named beings of any kind.
- No text, letters, numerals, logos, watermarks, signatures, borders, frames, or card shapes.
- Nothing recognisable from an existing franchise. Take the mood, palette, light and painting style — never a specific character or emblem.
- Say it should read as one continuous scene with nothing important near the edges, since it is trimmed by hand and slid behind plastic.
- Name the palette, the light, the depth and the rendering style plainly. Keep it under 120 words.

Reply with JSON only, no prose around it:
{"theme": "one or two sentences on what the page has in common", "palette": ["#rrggbb", "..."], "prompt": "the image prompt"}`;

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function parseBrief(raw: string) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return a brief.');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    theme?: string;
    palette?: unknown;
    prompt?: string;
  };
  if (!parsed.prompt) throw new Error('The brief came back without a prompt.');
  return {
    theme: parsed.theme ?? '',
    palette: Array.isArray(parsed.palette) ? parsed.palette.filter((c): c is string => typeof c === 'string') : [],
    prompt: parsed.prompt,
  };
}

async function brief(references: ImageRef[], aspect: number, hint: string) {
  const client = new Anthropic();
  const shape = aspect > 1.2 ? 'wide landscape' : aspect < 0.85 ? 'tall portrait' : 'square';
  const images: Anthropic.ImageBlockParam[] = references
    .slice(0, MAX_REFERENCES)
    .map((ref) =>
      ref.type === 'url'
        ? { type: 'image', source: { type: 'url', url: ref.url } }
        : { type: 'image', source: { type: 'base64', media_type: ref.media_type as 'image/jpeg', data: ref.data } },
    );

  const message = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: BRIEF_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          ...images,
          {
            type: 'text',
            text: [
              `These ${images.length} card${images.length === 1 ? '' : 's'} share a binder page.`,
              `The art will be printed in a ${shape} space (aspect ratio ${aspect.toFixed(2)}).`,
              hint.trim() ? `The collector adds: ${hint.trim()}` : '',
              'Write the brief.',
            ]
              .filter(Boolean)
              .join(' '),
          },
        ],
      },
    ],
  });

  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined to describe these images.');
  }
  return parseBrief(textOf(message));
}

/* ------------------------------ image models ----------------------------- */

const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1';

function aspectRatio(aspect: number): string {
  const options: [string, number][] = [
    ['1:1', 1],
    ['3:2', 1.5],
    ['16:9', 16 / 9],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16],
  ];
  return options.reduce((best, o) => (Math.abs(o[1] - aspect) < Math.abs(best[1] - aspect) ? o : best))[0];
}

interface GeminiResponse {
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; inlineData?: { data?: string; mimeType?: string } }[] };
  }[];
}

/** Something came back, but not an image — say why rather than "no image". */
function geminiRefusal(body: GeminiResponse): string | null {
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) return `The prompt was blocked (${body.promptFeedback?.blockReasonMessage ?? blocked}).`;
  const candidate = body.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') return `The image model stopped: ${finish}.`;
  // It sometimes answers in words instead of pixels; that text is the reason.
  const said = candidate?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join(' ')
    .trim();
  return said ? `The image model replied with text instead of an image: ${said.slice(0, 300)}` : null;
}

/**
 * The image model takes bytes, not links. Card art usually arrives as a URL, so
 * fetch it here — the reference images are what make the style match, and
 * dropping them would quietly cost most of the resemblance.
 */
async function inlineReference(ref: ImageRef): Promise<{ mime_type: string; data: string } | null> {
  if (ref.type === 'base64') return { mime_type: ref.media_type, data: ref.data };
  try {
    const res = await fetch(ref.url);
    if (!res.ok) return null;
    const mime = res.headers.get('content-type') ?? 'image/png';
    if (!mime.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > 4_000_000) return null;
    return { mime_type: mime.split(';')[0], data: bytes.toString('base64') };
  } catch {
    return null; // a reference that will not load is not worth failing over
  }
}

async function geminiImage(prompt: string, aspect: number, references: ImageRef[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY to generate art.');

  const parts: unknown[] = [{ text: prompt }];
  for (const ref of references) {
    const inlined = await inlineReference(ref);
    if (inlined) parts.push({ inline_data: inlined });
  }
  const ratio = aspectRatio(aspect);

  // The image-generation request shape has moved around between Gemini image
  // models, so try the plausible forms in turn rather than pin one and break.
  const variants: Record<string, unknown>[] = [
    { generationConfig: { imageConfig: { aspectRatio: ratio } } },
    { generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } } },
    { generationConfig: { responseModalities: ['IMAGE'] } },
    {},
  ];

  let lastReason = '';
  for (const extra of variants) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], ...extra }),
    });
    const body = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      const message = body.error?.message ?? `Image model failed (${res.status})`;
      // A bad key or a missing model will not fix itself on the next shape.
      if (res.status === 401 || res.status === 403 || /api key|permission|not found|quota|billing/i.test(message)) {
        throw new Error(message);
      }
      lastReason = message;
      continue;
    }

    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (part?.inlineData?.data) {
      return {
        image: `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`,
        model: GEMINI_MODEL,
      };
    }

    const refusal = geminiRefusal(body);
    // A safety block or a spoken refusal is about the prompt, not the request
    // shape — trying another shape would just repeat it.
    if (refusal) throw new Error(refusal);
    lastReason = 'the response carried no image';
  }

  throw new Error(`The image model returned no image — ${lastReason || 'no reason given'}.`);
}

async function openaiImage(prompt: string, aspect: number) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Set OPENAI_API_KEY to generate art.');
  const size = aspect > 1.2 ? '1536x1024' : aspect < 0.85 ? '1024x1536' : '1024x1024';
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: OPENAI_MODEL, prompt, size, n: 1 }),
  });
  const body = (await res.json()) as { error?: { message?: string }; data?: { b64_json?: string; url?: string }[] };
  if (!res.ok) throw new Error(body.error?.message ?? `Image model failed (${res.status})`);
  const first = body.data?.[0];
  if (first?.b64_json) return { image: `data:image/png;base64,${first.b64_json}`, model: OPENAI_MODEL };
  if (first?.url) return { image: first.url, model: OPENAI_MODEL };
  throw new Error('The image model returned no image.');
}

function renderImage(prompt: string, aspect: number, references: ImageRef[]) {
  const provider = (
    process.env.IMAGE_PROVIDER ?? (process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY ? 'openai' : 'gemini')
  ).toLowerCase();
  return provider === 'openai' ? openaiImage(prompt, aspect) : geminiImage(prompt, aspect, references);
}

/* -------------------------------- handler -------------------------------- */

export async function handleGenerate(payload: unknown) {
  const body = (payload ?? {}) as {
    action?: string;
    references?: ImageRef[];
    aspect?: number;
    hint?: string;
    prompt?: string;
  };
  const references = Array.isArray(body.references) ? body.references : [];
  const aspect = Number.isFinite(body.aspect) && body.aspect! > 0 ? body.aspect! : 1;

  if (body.action === 'brief') {
    if (!references.length) throw new Error('Pick at least one card for the model to look at.');
    return brief(references, aspect, body.hint ?? '');
  }
  if (body.action === 'image') {
    if (!body.prompt?.trim()) throw new Error('Write a prompt first.');
    return renderImage(body.prompt.trim(), aspect, references);
  }
  throw new Error('Unknown action.');
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    const result = await handleGenerate(req.body);
    const image = (result as { image?: string }).image;
    if (image && image.length > 4_000_000) {
      throw new Error(
        'The generated image is too large to pass back (over ~4 MB). Ask the model for a smaller size, or set GEMINI_IMAGE_MODEL to a model that returns 1K images.',
      );
    }
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    res.status(message.includes('Set ') ? 501 : 502).json({ error: message });
  }
}
