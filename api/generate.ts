/**
 * Binder filler art, in two steps, both on Gemini.
 *
 * `brief` — a vision model looks at the cards on a page and writes an art
 * brief. The instruction that matters is that it describes the *illustration*
 * and ignores everything the card frame adds: borders, text boxes, HP, energy
 * and set symbols, holo pattern, name plates.
 *
 * `image` — an image model renders that brief, with the same card art passed
 * back as reference images.
 *
 * Keeping them apart is what makes the brief editable before anything is
 * rendered, so a wrong theme costs nothing to fix.
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

const POSTER_SYSTEM = `You write art briefs for a card display poster: a photo print that a collector mounts real trading cards on top of, so the poster carries the world of the card outward to the edges of the paper.

You will be shown photographs or scans of the cards that will be mounted. Read ONLY the illustration on each card. Ignore everything the card frame adds — borders, name plates, HP, energy and type symbols, attack and rules text, set and rarity symbols, holo or texture patterns, and any stamped logos. Those are printing furniture, not the art.

From the illustrations, work out the place the art belongs to: setting, time of day, weather, palette, light, depth, and how it is rendered (brush, airbrush, cel, digital painting, watercolour).

Then write a prompt for an image model that will produce that same place seen WIDER — the scene the card is a window into, filling a whole sheet of paper.

Rules for that prompt:
- One continuous scene, edge to edge. No border, frame, mat, vignette, drop shadow or card shape drawn into the art.
- Setting only. No creatures, characters, mascots, people or named beings of any kind — the mounted card supplies the character.
- No text, letters, numerals, logos, watermarks or signatures.
- Nothing recognisable from an existing franchise. Take the mood, palette, light and painting style — never a specific character or emblem.
- The cards are mounted over the area named below. Keep that area quiet — open sky, still water, mist, plain ground, a soft gradient — with no focal detail, so nothing worth seeing ends up hidden behind a card.
- Compose the interest around that area and let it lead the eye there: horizon, light source, foliage, architecture, depth.
- Say the composition should hold together with nothing important in the outermost few percent, since the sheet is trimmed and framed by hand.
- Name the palette, the light, the depth and the rendering style plainly. Keep it under 150 words.

Reply with JSON only, no prose around it:
{"theme": "one or two sentences on the world these cards belong to", "palette": ["#rrggbb", "..."], "prompt": "the image prompt"}`;

const EXTEND_SYSTEM = `You write art briefs for extending a trading card's illustration past its edge, so a printed piece in the next binder pocket reads as the same picture carrying on.

You will be shown one card. Read ONLY the illustration. Ignore everything the card frame adds — borders, name plates, HP, energy and type symbols, attack and rules text, set and rarity symbols, holo or texture patterns, and stamped logos. Those are printing furniture; the picture behind them is the subject.

Work out what the illustration is a view of: the place, the time of day, the weather, where the light comes from, how deep the scene goes, and how it is painted (brush, airbrush, cel, digital painting, watercolour). Then work out what would be there just outside the named edge — the rest of the shoreline, the far side of the valley, more sky, the ground continuing.

Then write a prompt for an image model that will paint that continuation.

Rules for that prompt:
- Describe the continuation only, as a piece of the same picture. Not a new scene "in the same style" — the same place, a step further along.
- Carry across whatever crosses the join: the horizon at its height, the waterline, a ridge, the ground plane, a colour gradient, the direction the light falls.
- Setting only. No creatures, characters, mascots, people or named beings — the card keeps those.
- No text, letters, numerals, logos, watermarks, signatures, borders, frames or card shapes.
- Nothing recognisable from an existing franchise. Take the place, the palette, the light and the painting style — never a specific character or emblem.
- Name the palette, the light, the depth and the rendering style plainly. Keep it under 120 words.

Reply with JSON only, no prose around it:
{"theme": "one or two sentences on what the card is a view of and what lies past that edge", "palette": ["#rrggbb", "..."], "prompt": "the image prompt"}`;

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

/** Where the cards will sit, in the words the model is asked to compose around. */
interface Windows {
  cols: number;
  rows: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

function windowSentence(windows: Windows): string {
  const count = windows.cols * windows.rows;
  const grid =
    count === 1 ? 'One card will be mounted' : `${count} cards will be mounted in a ${windows.cols} by ${windows.rows} grid`;
  return (
    `${grid} over the area from ${windows.xPct}% to ${windows.xPct + windows.wPct}% across ` +
    `and ${windows.yPct}% to ${windows.yPct + windows.hPct}% down the sheet. Keep that area quiet.`
  );
}

/** Which way a card's illustration is being carried, and how far. */
interface Extend {
  direction: 'left' | 'right' | 'up' | 'down';
  /** Percentage of the working canvas that is new art rather than card. */
  artPct: number;
}

/** "up" is a direction to travel; "top" is a place in the frame. The model is
 *  being told about places, so the two vocabularies are kept apart. */
const SIDE = { left: 'left', right: 'right', up: 'top', down: 'bottom' } as const;
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;

/** Where in the frame the untouched card sits, spelled out for the model. */
function extendSentence({ direction, artPct }: Extend): string {
  return (
    `The reference image is a working canvas. The card's own illustration fills the ` +
    `${SIDE[OPPOSITE[direction]]} ${100 - artPct}% of it. The remaining ${artPct}% at the ` +
    `${SIDE[direction]} is a blurred smear standing in for art that does not exist yet: repaint that part ` +
    `as the picture continuing, with everything that crosses the join — horizon, waterline, ground, ridge, ` +
    `gradient, the fall of the light — carrying straight through at the same height. Leave the card's own ` +
    `illustration exactly as it is. No creatures, characters, people, text, logos, borders, frames or card ` +
    `shapes anywhere.`
  );
}

async function brief(references: ImageRef[], aspect: number, hint: string, windows?: Windows, extend?: Extend) {
  const shape = aspect > 1.2 ? 'wide landscape' : aspect < 0.85 ? 'tall portrait' : 'square';

  // The model reads bytes, not links, and card art usually arrives as a URL.
  const parts: unknown[] = [];
  for (const ref of references.slice(0, MAX_REFERENCES)) {
    const inlined = await inlineReference(ref);
    if (inlined) parts.push({ inline_data: inlined });
  }
  if (!parts.length) throw new Error('None of the chosen card images could be loaded.');

  const count = parts.length;
  parts.push({
    text: [
      extend
        ? `This card's illustration is being carried past its ${extend.direction} edge.`
        : windows
          ? `These ${count} card${count === 1 ? '' : 's'} will be mounted on this poster.`
          : `These ${count} card${count === 1 ? '' : 's'} share a binder page.`,
      `The art will be printed in a ${shape} space (aspect ratio ${aspect.toFixed(2)}).`,
      windows ? windowSentence(windows) : '',
      extend ? `Describe what lies just past that ${extend.direction} edge.` : '',
      hint.trim() ? `The collector adds: ${hint.trim()}` : '',
      'Write the brief.',
    ]
      .filter(Boolean)
      .join(' '),
  });

  const system = extend ? EXTEND_SYSTEM : windows ? POSTER_SYSTEM : BRIEF_SYSTEM;
  const { ok, status, body } = await callGemini(GEMINI_TEXT_MODEL, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    // Asking for JSON directly beats hoping the prose happens to parse.
    generationConfig: { responseMimeType: 'application/json' },
  });
  if (!ok) throw new Error(body.error?.message ?? `Reading the cards failed (${status}).`);

  const blocked = geminiBlocked(body);
  if (blocked) throw new Error(blocked);
  return parseBrief(geminiText(body));
}

/* ------------------------------ image models ----------------------------- */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
// Google retires model ids and answers with "no longer available to new users",
// naming the successor. Both are overridable so a rename is an env var, not a
// deploy, and that message reaches the panel verbatim when neither is set.
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';

/**
 * One generateContent call. The status comes back with the body rather than as
 * an exception, because the image half tries several request shapes and needs
 * to tell "that shape is wrong" from "this key is not going to work".
 */
async function callGemini(model: string, body: Record<string, unknown>) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY to generate art.');
  const res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  return {
    ok: res.ok,
    status: res.status,
    body: (await res.json().catch(() => ({}))) as GeminiResponse,
  };
}

/**
 * Nearest ratio the image model offers. Photo paper sizes land all over the
 * place — 5 x 7 is 0.71, 8 x 10 is 0.80, 13 x 19 is 0.68 — so the near-square
 * ratios matter here in a way they never did for a pocket.
 */
function aspectRatio(aspect: number): string {
  const options: [string, number][] = [
    ['1:1', 1],
    ['5:4', 1.25],
    ['4:3', 4 / 3],
    ['3:2', 1.5],
    ['16:9', 16 / 9],
    ['4:5', 0.8],
    ['3:4', 0.75],
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

/** A blocked prompt or a generation that stopped early, in words. */
function geminiBlocked(body: GeminiResponse): string | null {
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) return `The prompt was blocked (${body.promptFeedback?.blockReasonMessage ?? blocked}).`;
  const finish = body.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') return `The model stopped: ${finish}.`;
  return null;
}

function geminiText(body: GeminiResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Something came back, but not an image — say why rather than "no image". */
function geminiRefusal(body: GeminiResponse): string | null {
  const blocked = geminiBlocked(body);
  if (blocked) return blocked;
  // It sometimes answers in words instead of pixels; that text is the reason.
  const said = geminiText(body);
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

/** 1K is plenty for a pocket; a poster needs every pixel it can carry back. */
type ImageSize = '1K' | '2K' | '4K';

async function geminiImage(
  prompt: string,
  aspect: number,
  references: ImageRef[],
  imageSize?: ImageSize,
  extend?: Extend,
) {
  // The canvas instruction is mechanical, so it is kept out of the prompt the
  // collector edits: there is nothing there for them to get right or wrong.
  const parts: unknown[] = [{ text: extend ? `${extendSentence(extend)}\n\nPaint it as: ${prompt}` : prompt }];
  for (const ref of references) {
    const inlined = await inlineReference(ref);
    if (inlined) parts.push({ inline_data: inlined });
  }
  const ratio = aspectRatio(aspect);

  // The image-generation request shape has moved around between Gemini image
  // models, so try the plausible forms in turn rather than pin one and break.
  // The documented shape comes first: ask for both modalities, since the model
  // may narrate alongside the picture, and name the aspect ratio.
  const variants: Record<string, unknown>[] = [
    // Only when a size was asked for, so a request that does not need one is
    // not spending an attempt on a field the model may not know.
    ...(imageSize
      ? [{ generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio, imageSize } } }]
      : []),
    { generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio } } },
    { generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
    { generationConfig: { imageConfig: { aspectRatio: ratio } } },
    {},
  ];

  let lastReason = '';
  for (const extra of variants) {
    const { ok, status, body } = await callGemini(GEMINI_MODEL, { contents: [{ parts }], ...extra });

    if (!ok) {
      const message = body.error?.message ?? `Image model failed (${status})`;
      // A bad key or a missing model will not fix itself on the next shape.
      if (status === 401 || status === 403 || /api key|permission|not found|quota|billing/i.test(message)) {
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

/* -------------------------------- handler -------------------------------- */

const SIZES: ImageSize[] = ['1K', '2K', '4K'];

export async function handleGenerate(payload: unknown) {
  const body = (payload ?? {}) as {
    action?: string;
    references?: ImageRef[];
    aspect?: number;
    hint?: string;
    prompt?: string;
    /** Present when the target is a poster: where the cards will be mounted. */
    windows?: Windows;
    /** Present when a card's art is being carried into the next pocket. */
    extend?: Extend;
    imageSize?: string;
  };
  const references = Array.isArray(body.references) ? body.references : [];
  const aspect = Number.isFinite(body.aspect) && body.aspect! > 0 ? body.aspect! : 1;
  const imageSize = SIZES.find((size) => size === body.imageSize);

  if (body.action === 'brief') {
    if (!references.length) throw new Error('Pick at least one card for the model to look at.');
    return brief(references, aspect, body.hint ?? '', body.windows, body.extend);
  }
  if (body.action === 'image') {
    if (!body.prompt?.trim()) throw new Error('Write a prompt first.');
    return geminiImage(body.prompt.trim(), aspect, references, imageSize, body.extend);
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
        'The generated image is too large to pass back (over ~4 MB). Drop the render size — 4K posters rarely fit — or set GEMINI_IMAGE_MODEL to a model that returns smaller images.',
      );
    }
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    res.status(message.includes('Set ') ? 501 : 502).json({ error: message });
  }
}
