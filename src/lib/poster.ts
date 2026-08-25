/**
 * Card display posters: a print sized for a photo printer, with the card art
 * carried outward to the edges of the paper, and one or more windows where the
 * physical cards get mounted on top.
 *
 * Everything here is millimetres, because that is what a printer and a ruler
 * agree on. Inch sizes are converted rather than rounded by hand so a 13 × 19
 * really is 330.2 × 482.6 and not 330 × 483.
 */

import type { Poster } from '../types';

const inch = (n: number) => n * 25.4;

export interface PaperSize {
  id: string;
  label: string;
  /** Portrait dimensions; `landscape` on the poster swaps them. */
  w: number;
  h: number;
}

/** Sizes a 13 × 19 photo printer can actually feed, largest last. */
export const POSTER_SIZES: PaperSize[] = [
  { id: '4x6', label: '4 × 6 in', w: inch(4), h: inch(6) },
  { id: '5x7', label: '5 × 7 in', w: inch(5), h: inch(7) },
  { id: '6x8', label: '6 × 8 in', w: inch(6), h: inch(8) },
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: '8x10', label: '8 × 10 in', w: inch(8), h: inch(10) },
  { id: 'letter', label: '8.5 × 11 in', w: inch(8.5), h: inch(11) },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: '11x14', label: '11 × 14 in', w: inch(11), h: inch(14) },
  { id: 'a3', label: 'A3', w: 297, h: 420 },
  { id: '12x18', label: '12 × 18 in', w: inch(12), h: inch(18) },
  { id: '13x19', label: '13 × 19 in', w: inch(13), h: inch(19) },
];

/** What most photo printers top out at, and the default warning threshold. */
export const PRINTER_MAX = { w: inch(13), h: inch(19) };

export interface Holder {
  id: string;
  label: string;
  w: number;
  h: number;
  note?: string;
}

/**
 * The outside of whatever the card is mounted in — that is the shape the poster
 * has to leave room for, not the card. Nominal sizes: slabs and one-touches
 * vary a little between batches, so measure yours and use Custom if it matters.
 */
export const HOLDERS: Holder[] = [
  { id: 'raw', label: 'Raw card', w: 63, h: 88 },
  { id: 'sleeve', label: 'Sleeved card', w: 66, h: 91 },
  { id: 'toploader', label: 'Toploader', w: 76, h: 102, note: '3 × 4 in' },
  { id: 'onetouch', label: 'One-touch', w: 85, h: 116, note: '35 pt magnetic' },
  { id: 'psa', label: 'PSA slab', w: 83, h: 133 },
  { id: 'bgs', label: 'BGS / CGC slab', w: 89, h: 140 },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function sizeOf(poster: Poster): { w: number; h: number } {
  const size = POSTER_SIZES.find((s) => s.id === poster.sizeId);
  const base = poster.size ?? (size ? { w: size.w, h: size.h } : { w: inch(8), h: inch(10) });
  return poster.landscape ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

export function holderOf(poster: Poster): { w: number; h: number } {
  const holder = HOLDERS.find((h) => h.id === poster.holderId);
  return poster.holder ?? (holder ? { w: holder.w, h: holder.h } : { w: 63, h: 88 });
}

/** The block of windows, centred on the sheet and then nudged by the offset. */
export function windowBlock(poster: Poster): Rect {
  const page = sizeOf(poster);
  const holder = holderOf(poster);
  const w = poster.cols * holder.w + (poster.cols - 1) * poster.gap;
  const h = poster.rows * holder.h + (poster.rows - 1) * poster.gap;
  return {
    x: (page.w - w) / 2 + poster.offsetX,
    y: (page.h - h) / 2 + poster.offsetY,
    w,
    h,
  };
}

/** One rect per mounted card, in reading order. */
export function windowRects(poster: Poster): Rect[] {
  const block = windowBlock(poster);
  const holder = holderOf(poster);
  const rects: Rect[] = [];
  for (let row = 0; row < poster.rows; row += 1) {
    for (let col = 0; col < poster.cols; col += 1) {
      rects.push({
        x: block.x + col * (holder.w + poster.gap),
        y: block.y + row * (holder.h + poster.gap),
        w: holder.w,
        h: holder.h,
      });
    }
  }
  return rects;
}

export function posterAspect(poster: Poster): number {
  const { w, h } = sizeOf(poster);
  return w / h;
}

/** How much bare paper is left around the windows, per edge. */
export function margins(poster: Poster): { top: number; right: number; bottom: number; left: number } {
  const page = sizeOf(poster);
  const block = windowBlock(poster);
  return {
    left: block.x,
    top: block.y,
    right: page.w - block.x - block.w,
    bottom: page.h - block.y - block.h,
  };
}

export interface PosterProblem {
  level: 'warn' | 'error';
  text: string;
}

/** Everything worth saying before ink is spent. */
export function review(poster: Poster, imagePixels?: { w: number; h: number }): PosterProblem[] {
  const page = sizeOf(poster);
  const edge = margins(poster);
  const problems: PosterProblem[] = [];

  const tight = Math.min(edge.top, edge.right, edge.bottom, edge.left);
  if (tight < 0) {
    problems.push({ level: 'error', text: 'The cards do not fit on this sheet. Use a bigger size, or fewer windows.' });
  } else if (tight < 6) {
    problems.push({
      level: 'warn',
      text: `Only ${tight.toFixed(0)} mm of paper on the tightest edge — most printers cannot print that close.`,
    });
  }

  if (page.w > PRINTER_MAX.w + 0.5 || page.h > PRINTER_MAX.h + 0.5) {
    problems.push({ level: 'warn', text: 'Bigger than 13 × 19 in — check your printer takes this size.' });
  }

  if (imagePixels) {
    const dpi = Math.min((imagePixels.w / page.w) * 25.4, (imagePixels.h / page.h) * 25.4);
    if (dpi < 150) {
      problems.push({
        level: 'warn',
        text: `The art lands at ${Math.round(dpi)} dpi at this size. Ask for a larger render, or print smaller.`,
      });
    }
  }
  return problems;
}

/** Print resolution of a given render at this poster's size. */
export function dpiOf(poster: Poster, pixels: { w: number; h: number }): number {
  const page = sizeOf(poster);
  return Math.min((pixels.w / page.w) * 25.4, (pixels.h / page.h) * 25.4);
}

/**
 * Where the cards sit, as fractions of the sheet. This is what the model is
 * told to keep quiet, so nothing worth looking at ends up behind a card.
 */
export function windowHint(poster: Poster): {
  cols: number;
  rows: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
} {
  const page = sizeOf(poster);
  const block = windowBlock(poster);
  const pct = (n: number) => Math.round(n * 100);
  return {
    cols: poster.cols,
    rows: poster.rows,
    xPct: pct(block.x / page.w),
    yPct: pct(block.y / page.h),
    wPct: pct(block.w / page.w),
    hPct: pct(block.h / page.h),
  };
}

export function newPoster(id: string, name = 'Poster'): Poster {
  return {
    id,
    name,
    sizeId: '8x10',
    landscape: false,
    holderId: 'raw',
    cols: 1,
    rows: 1,
    gap: 6,
    offsetX: 0,
    offsetY: 0,
    updatedAt: Date.now(),
  };
}
