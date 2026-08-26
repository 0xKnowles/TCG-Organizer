/**
 * Extending a card's art into the pockets beside it.
 *
 * Not "something in the same style" — the actual continuation of one card's
 * illustration off one of its edges, so the two sit in the binder as one scene
 * with a divider across it.
 *
 * The way that is done is outpainting: build a canvas holding the card at one
 * edge and empty space where the new art goes, have the model paint the empty
 * part, then crop the card back off. Composing the canvas here rather than
 * describing it in words is what makes the seam line up.
 */

import type { Binder } from '../types';
import { physical } from './pockets';

export type Direction = 'left' | 'right' | 'up' | 'down';

export const DIRECTIONS: { id: Direction; label: string; arrow: string }[] = [
  { id: 'left', label: 'Left', arrow: '←' },
  { id: 'right', label: 'Right', arrow: '→' },
  { id: 'up', label: 'Up', arrow: '↑' },
  { id: 'down', label: 'Down', arrow: '↓' },
];

export const isHorizontal = (direction: Direction) => direction === 'left' || direction === 'right';

export interface ExtendPlan {
  direction: Direction;
  /** Pockets of new art. Along the direction only: sideways is always one. */
  length: 1 | 2;
}

export interface Fraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Composite {
  /** Whole canvas in mm: the card's pocket, the divider, then the new art. */
  w: number;
  h: number;
  /** Where the card sits, as fractions of the canvas. */
  card: Fraction;
  /** Where the new art sits, as fractions of the canvas. */
  art: Fraction;
  /** Footprint of the finished piece, in pockets. */
  spanCols: number;
  spanRows: number;
}

/**
 * The card pocket, the divider gap, then the art pockets. Including the gap is
 * what keeps this honest: on the page a strip of the scene really is hidden
 * behind the divider, and the print step drops exactly that strip.
 */
export function composite(binder: Binder, plan: ExtendPlan): Composite {
  const { card, pocketGap } = physical(binder);
  const across = isHorizontal(plan.direction);
  const artLong = plan.length * (across ? card.w : card.h) + (plan.length - 1) * pocketGap;
  const cardLong = across ? card.w : card.h;
  const total = cardLong + pocketGap + artLong;

  // The card sits on the side the art is growing away from.
  const cardFirst = plan.direction === 'right' || plan.direction === 'down';
  const cardStart = cardFirst ? 0 : total - cardLong;
  const artStart = cardFirst ? total - artLong : 0;

  const span = (start: number, length: number): Fraction =>
    across
      ? { x: start / total, y: 0, w: length / total, h: 1 }
      : { x: 0, y: start / total, w: 1, h: length / total };

  return {
    w: across ? total : card.w,
    h: across ? card.h : total,
    card: span(cardStart, cardLong),
    art: span(artStart, artLong),
    spanCols: across ? plan.length : 1,
    spanRows: across ? 1 : plan.length,
  };
}

/** Which side of the canvas the untouched card is on — the model needs telling. */
export function cardSide(direction: Direction): Direction {
  return direction === 'right' ? 'left' : direction === 'left' ? 'right' : direction === 'down' ? 'up' : 'down';
}

export function aspectOfArt(binder: Binder, plan: ExtendPlan): number {
  const { card, pocketGap } = physical(binder);
  const long = plan.length * (isHorizontal(plan.direction) ? card.w : card.h) + (plan.length - 1) * pocketGap;
  return isHorizontal(plan.direction) ? long / card.h : card.w / long;
}

/**
 * A remote card image would taint the canvas, and a tainted canvas cannot be
 * read back. Everything remote goes through the app's own image proxy so the
 * pixels arrive same-origin.
 */
function sourceFor(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That card image could not be read.'));
    img.src = sourceFor(url);
  });
}

/** Longest edge of the working canvas. Enough detail to match, small to send. */
const CANVAS_EDGE = 1024;

/**
 * The part of a card image that is the illustration, as fractions of the whole.
 * A card is mostly furniture — border, name plate, HP, text box, set symbols —
 * and handing all of that to the model is what makes it carry the border
 * outward instead of the picture. Only what is inside this box is extended.
 */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CARD: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Percentages from the model, clamped into something drawable. */
export function cropFromPercent(box: { x?: number; y?: number; w?: number; h?: number } | undefined): Crop {
  if (!box) return FULL_CARD;
  const at = (n: number | undefined, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) / 100 : fallback;
  const x = at(box.x, 0);
  const y = at(box.y, 0);
  const w = Math.min(at(box.w, 1), 1 - x);
  const h = Math.min(at(box.h, 1), 1 - y);
  // A degenerate box is worse than no box at all.
  return w < 0.15 || h < 0.15 ? FULL_CARD : { x, y, w, h };
}

/** Read a card image out as bytes small enough to send. */
export async function cardBytes(url: string, maxEdge = 768): Promise<string> {
  const img = await load(url);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give up a canvas to work on.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

/**
 * The card at one edge, and the empty part filled by smearing the card's
 * adjacent edge across it. A flat colour gives the model nothing to work with;
 * a smear already has the horizon and the light in roughly the right places,
 * so what comes back tends to line up instead of merely rhyming.
 */
export async function buildComposite(cardUrl: string, box: Composite, crop: Crop = FULL_CARD): Promise<string> {
  const img = await load(cardUrl);
  // The illustration, in source pixels. Everything outside it is furniture.
  const src = {
    x: crop.x * img.naturalWidth,
    y: crop.y * img.naturalHeight,
    w: crop.w * img.naturalWidth,
    h: crop.h * img.naturalHeight,
  };
  const scale = CANVAS_EDGE / Math.max(box.w, box.h);
  const W = Math.round(box.w * scale);
  const H = Math.round(box.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give up a canvas to work on.');

  const cardBox = { x: box.card.x * W, y: box.card.y * H, w: box.card.w * W, h: box.card.h * H };
  const artBox = { x: box.art.x * W, y: box.art.y * H, w: box.art.w * W, h: box.art.h * H };

  // Fill the card's slot with the illustration rather than stretching it to
  // fit: trimming a little beats distorting the scene the extension has to
  // continue. `fill` is the part of the crop that actually lands in the slot.
  const slotAspect = cardBox.w / cardBox.h;
  const fill =
    src.w / src.h > slotAspect
      ? { w: src.h * slotAspect, h: src.h }
      : { w: src.w, h: src.w / slotAspect };
  const fillBox = { x: src.x + (src.w - fill.w) / 2, y: src.y + (src.h - fill.h) / 2, w: fill.w, h: fill.h };

  // Smear the strip of illustration nearest the join across the empty area
  // first, so the card is drawn over the top of it and stays crisp.
  const strip = 0.06;
  const across = box.w > box.h;
  const cardAfter = artBox.x < cardBox.x || artBox.y < cardBox.y;
  ctx.filter = 'blur(10px)';
  if (across) {
    const sw = Math.max(1, fillBox.w * strip);
    const sx = cardAfter ? fillBox.x : fillBox.x + fillBox.w - sw;
    ctx.drawImage(img, sx, fillBox.y, sw, fillBox.h, artBox.x, artBox.y, artBox.w, artBox.h);
  } else {
    const sh = Math.max(1, fillBox.h * strip);
    const sy = cardAfter ? fillBox.y : fillBox.y + fillBox.h - sh;
    ctx.drawImage(img, fillBox.x, sy, fillBox.w, sh, artBox.x, artBox.y, artBox.w, artBox.h);
  }
  ctx.filter = 'none';
  ctx.drawImage(img, fillBox.x, fillBox.y, fillBox.w, fillBox.h, cardBox.x, cardBox.y, cardBox.w, cardBox.h);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Take the new art back out of what the model returned. The model repaints the
 * whole canvas, card included, so the finished piece is the art region cropped
 * out by the same fractions the canvas was built from.
 */
export async function cropExtension(url: string, box: Composite): Promise<string> {
  const img = await load(url);
  const sx = box.art.x * img.naturalWidth;
  const sy = box.art.y * img.naturalHeight;
  const sw = box.art.w * img.naturalWidth;
  const sh = box.art.h * img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give up a canvas to work on.');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
