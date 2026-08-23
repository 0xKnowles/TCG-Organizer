import type { Binder, Placement, Rect } from '../types';
import { cardAspect, layoutPlacement as layoutPieces, physical, type Metrics } from './pockets';

/** Page border, as a fraction of the page's width. */
export const PAGE_PAD = 0.034;

/** Gap between pockets, in pocket widths — taken from the binder's real measurements. */
export function gapRatio(binder: Binder): number {
  const p = physical(binder);
  return p.pocketGap / p.card.w;
}

export function spineRatio(binder: Binder): number {
  const p = physical(binder);
  return p.spineGap / p.card.w;
}

/** Width of one pocket, as a fraction of the page width. */
export function pocketWidth(cols: number, ratio: number): number {
  return (1 - 2 * PAGE_PAD) / (cols + (cols - 1) * ratio);
}

/** Page width / height, so every pocket keeps the card's real proportions. */
export function pageAspect(binder: Binder): number {
  const w = pocketWidth(binder.cols, gapRatio(binder));
  const gap = w * gapRatio(binder);
  const height = 2 * PAGE_PAD + (binder.rows * w) / cardAspect(binder) + (binder.rows - 1) * gap;
  return 1 / height;
}

/** Everything the page grid needs, in fractions of the page width. */
export function pageStyle(binder: Binder) {
  const pocket = pocketWidth(binder.cols, gapRatio(binder));
  return { pad: PAGE_PAD, gap: pocket * gapRatio(binder), pocket, aspect: pageAspect(binder) };
}

/** Screen counterpart of `printMetrics`, in fractions of the page width. */
export function screenMetrics(binder: Binder): Metrics {
  const { pocket, gap } = pageStyle(binder);
  return { cardW: pocket, cardH: pocket / cardAspect(binder), gap, spine: pocket * spineRatio(binder) };
}

/** The gap drawn between the two pages of a spread, as a fraction of a page's width. */
export function spineFraction(binder: Binder): number {
  return pageStyle(binder).pocket * spineRatio(binder);
}

export function rectOf(p: Placement): Rect {
  return { page: p.page, col: p.col, row: p.row, spanCols: p.spanCols, spanRows: p.spanRows };
}

/**
 * Art may run across the spine onto the facing page, so a footprint can cover
 * two pages. This splits it into one rect per page.
 */
export function rectsOf(binder: Binder, rect: Rect): Rect[] {
  const overflow = rect.col + rect.spanCols - binder.cols;
  if (overflow <= 0) return [rect];
  return [
    { ...rect, spanCols: binder.cols - rect.col },
    { page: rect.page + 1, col: 0, row: rect.row, spanCols: overflow, spanRows: rect.spanRows },
  ];
}

/**
 * True when this page sits on the left of a spread. A binder opens on its front
 * page alone on the right, so with that setting the left-hand pages are the odd
 * ones. Which side a page is on decides its pocket openings and whether art can
 * run across the spine.
 */
export function isLeftPage(binder: Binder, page: number): boolean {
  return binder.firstPageAlone ? page % 2 === 1 : page % 2 === 0;
}

/** True when art on this page can run across the spine onto the facing page. */
export function canSpanSpine(binder: Binder, page: number): boolean {
  return page + 1 < binder.pageCount && isLeftPage(binder, page);
}

/** Slice a placement into printable pieces, resolving each page's opening pattern. */
export function layoutPlacement(binder: Binder, placement: Placement, m: Metrics) {
  return layoutPieces(binder, placement, m, (page) => isLeftPage(binder, page));
}

export function inBounds(binder: Binder, rect: Rect): boolean {
  if (rect.col < 0 || rect.row < 0 || rect.spanCols < 1 || rect.spanRows < 1) return false;
  if (rect.row + rect.spanRows > binder.rows) return false;
  if (rect.page < 0 || rect.page >= binder.pageCount) return false;
  const overflow = rect.col + rect.spanCols - binder.cols;
  if (overflow <= 0) return true;
  // Running onto the facing page is only real if the pages actually face.
  return canSpanSpine(binder, rect.page) && rect.col < binder.cols && overflow <= binder.cols;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  if (a.page !== b.page) return false;
  return (
    a.col < b.col + b.spanCols && b.col < a.col + a.spanCols && a.row < b.row + b.spanRows && b.row < a.row + a.spanRows
  );
}

export function overlaps(binder: Binder, a: Rect, b: Rect): boolean {
  return rectsOf(binder, a).some((ra) => rectsOf(binder, b).some((rb) => rectsOverlap(ra, rb)));
}

export function occupantsOf(binder: Binder, rect: Rect, exceptId?: string): Placement[] {
  return binder.placements.filter((p) => p.id !== exceptId && overlaps(binder, rectOf(p), rect));
}

/** True when a footprint can legally sit at `rect` (empty, or a clean 1x1 swap). */
export function canDrop(binder: Binder, rect: Rect, exceptId?: string): boolean {
  if (!inBounds(binder, rect)) return false;
  const hit = occupantsOf(binder, rect, exceptId);
  if (hit.length === 0) return true;
  return (
    rect.spanCols === 1 && rect.spanRows === 1 && hit.length === 1 && hit[0].spanCols === 1 && hit[0].spanRows === 1
  );
}

/**
 * Snap a pointer to a legal anchor for a footprint: art may hang over the spine
 * on a left-hand page, but never off the edge of the binder.
 */
export function anchorAt(
  binder: Binder,
  page: number,
  cell: { col: number; row: number },
  span: { spanCols: number; spanRows: number },
  grab: { col: number; row: number } = { col: 0, row: 0 },
): { col: number; row: number } {
  const maxCol = canSpanSpine(binder, page) ? binder.cols - 1 : binder.cols - span.spanCols;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), v));
  return {
    col: clamp(cell.col - grab.col, maxCol),
    row: clamp(cell.row - grab.row, binder.rows - span.spanRows),
  };
}

export function firstFreeSlot(
  binder: Binder,
  page: number,
  spanCols = 1,
  spanRows = 1,
): { col: number; row: number } | null {
  for (let row = 0; row + spanRows <= binder.rows; row++) {
    for (let col = 0; col + spanCols <= binder.cols; col++) {
      if (occupantsOf(binder, { page, col, row, spanCols, spanRows }).length === 0) return { col, row };
    }
  }
  return null;
}

/** Placements with any part on this page, including art running in from the page before. */
export function placementsOnPage(binder: Binder, page: number): Placement[] {
  return binder.placements.filter((p) => rectsOf(binder, rectOf(p)).some((r) => r.page === page));
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
