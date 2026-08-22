import type { Binder, Placement, Rect } from '../types';

export const CARD_ASPECT = 63 / 88; // a real Pokemon card, width / height

/** Page padding and pocket gap, as fractions of the page's width. */
export const PAGE_PAD = 0.034;
export const PAGE_GAP = 0.032;

/** Width of one pocket, as a fraction of the page width. */
export function pocketWidth(cols: number): number {
  return (1 - 2 * PAGE_PAD - (cols - 1) * PAGE_GAP) / cols;
}

/** Page width / height, chosen so every pocket keeps a real card's proportions. */
export function pageAspect(cols: number, rows: number): number {
  const height = 2 * PAGE_PAD + (rows * pocketWidth(cols)) / CARD_ASPECT + (rows - 1) * PAGE_GAP;
  return 1 / height;
}

export function rectOf(p: Placement): Rect {
  return { page: p.page, col: p.col, row: p.row, spanCols: p.spanCols, spanRows: p.spanRows };
}

export function inBounds(rect: Rect, cols: number, rows: number): boolean {
  return (
    rect.col >= 0 &&
    rect.row >= 0 &&
    rect.spanCols >= 1 &&
    rect.spanRows >= 1 &&
    rect.col + rect.spanCols <= cols &&
    rect.row + rect.spanRows <= rows
  );
}

export function overlaps(a: Rect, b: Rect): boolean {
  if (a.page !== b.page) return false;
  return (
    a.col < b.col + b.spanCols && b.col < a.col + a.spanCols && a.row < b.row + b.spanRows && b.row < a.row + a.spanRows
  );
}

export function occupantsOf(placements: Placement[], rect: Rect, exceptId?: string): Placement[] {
  return placements.filter((p) => p.id !== exceptId && overlaps(rectOf(p), rect));
}

/** True when a footprint can legally sit at `rect` (empty, or a clean 1x1 swap). */
export function canDrop(binder: Binder, rect: Rect, exceptId?: string): boolean {
  if (!inBounds(rect, binder.cols, binder.rows)) return false;
  const hit = occupantsOf(binder.placements, rect, exceptId);
  if (hit.length === 0) return true;
  // A single-slot item may swap with another single-slot item.
  return (
    rect.spanCols === 1 && rect.spanRows === 1 && hit.length === 1 && hit[0].spanCols === 1 && hit[0].spanRows === 1
  );
}

export function firstFreeSlot(
  binder: Binder,
  page: number,
  spanCols = 1,
  spanRows = 1,
): { col: number; row: number } | null {
  for (let row = 0; row + spanRows <= binder.rows; row++) {
    for (let col = 0; col + spanCols <= binder.cols; col++) {
      const rect = { page, col, row, spanCols, spanRows };
      if (occupantsOf(binder.placements, rect).length === 0) return { col, row };
    }
  }
  return null;
}

/** Which page indexes are showing, given the view mode and binder settings. */
export function spreadPages(binder: Binder, spreadIndex: number, mode: 'single' | 'spread'): (number | null)[] {
  if (mode === 'single') return [spreadIndex];
  if (binder.firstPageAlone) {
    if (spreadIndex === 0) return [null, 0];
    const left = spreadIndex * 2 - 1;
    return [left, left + 1];
  }
  return [spreadIndex * 2, spreadIndex * 2 + 1];
}

export function spreadCount(binder: Binder, mode: 'single' | 'spread'): number {
  if (mode === 'single') return binder.pageCount;
  return binder.firstPageAlone ? Math.ceil((binder.pageCount + 1) / 2) : Math.ceil(binder.pageCount / 2);
}
