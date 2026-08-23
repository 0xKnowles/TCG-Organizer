import type { Binder, Placement } from '../types';
import { physical } from './pockets';

/**
 * Generating binder filler art happens in two steps: Claude reads the cards on
 * the page and writes an art brief, then an image model renders it. Splitting
 * them means the brief can be edited before anything is rendered.
 */

/** An image source in the shape the Messages API takes, so it passes straight through. */
export type ImageRef = { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string };

export interface ArtBrief {
  /** What the page looks like, in the model's words. */
  theme: string;
  palette: string[];
  /** The prompt handed to the image model. Editable before generating. */
  prompt: string;
}

export interface GenerateSpan {
  spanCols: number;
  spanRows: number;
}

export const SPAN_CHOICES: { label: string; span: GenerateSpan }[] = [
  { label: '1 pocket', span: { spanCols: 1, spanRows: 1 } },
  { label: '2 wide', span: { spanCols: 2, spanRows: 1 } },
  { label: '2 tall', span: { spanCols: 1, spanRows: 2 } },
];

/** Printed proportions of the target, so the render matches the pockets it fills. */
export function aspectFor(binder: Binder, span: GenerateSpan): number {
  const { card, pocketGap } = physical(binder);
  const w = span.spanCols * card.w + (span.spanCols - 1) * pocketGap;
  const h = span.spanRows * card.h + (span.spanRows - 1) * pocketGap;
  return w / h;
}

export function aspectLabel(aspect: number): string {
  if (aspect > 1.2) return '3:2 landscape';
  if (aspect < 0.55) return '9:16 tall';
  if (aspect < 0.85) return '2:3 portrait';
  return '1:1 square';
}

/** Shrink a local image before sending it: a card only needs to be legible. */
async function downscale(url: string, maxEdge = 640): Promise<ImageRef | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = url;
  });
  if (!img) return null;
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    return { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] };
  } catch {
    // A remote image taints the canvas; send the URL and let the API fetch it.
    return null;
  }
}

/**
 * Turn placed cards into references. Remote art is passed by URL — the API
 * fetches it itself, which sidesteps the browser's CORS rules.
 */
export async function referencesFor(
  binder: Binder,
  placements: Placement[],
  resolve: (placement: Placement) => string | undefined,
): Promise<ImageRef[]> {
  const refs: ImageRef[] = [];
  for (const placement of placements) {
    const item = binder.library.find((i) => i.id === placement.itemId);
    if (!item?.image) continue;
    if (item.image.type === 'remote') {
      refs.push({ type: 'url', url: item.image.url });
      continue;
    }
    const url = resolve(placement);
    if (!url) continue;
    const shrunk = await downscale(url);
    if (shrunk) refs.push(shrunk);
  }
  return refs;
}

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (!isJson) {
    throw new Error('Art generation needs the server side of this app — it is not available here.');
  }
  const parsed = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(parsed.error ?? `Generation failed (${res.status})`);
  return parsed;
}

export function readPage(refs: ImageRef[], aspect: number, hint: string, signal?: AbortSignal): Promise<ArtBrief> {
  return post<ArtBrief>({ action: 'brief', references: refs, aspect, hint }, signal);
}

export function renderArt(
  prompt: string,
  aspect: number,
  refs: ImageRef[],
  signal?: AbortSignal,
): Promise<{ image: string; model: string }> {
  return post<{ image: string; model: string }>(
    { action: 'image', prompt, aspect, references: refs.slice(0, 3) },
    signal,
  );
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
