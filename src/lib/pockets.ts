import type { Binder, Placement, PocketOpenings } from '../types';

/** Physical measurements of the binder, in millimetres. */
export interface Physical {
  card: { w: number; h: number };
  pocketGap: number;
  spineGap: number;
  openings: PocketOpenings;
}

export const DEFAULT_PHYSICAL: Physical = {
  card: { w: 63, h: 88 },
  pocketGap: 4,
  spineGap: 24,
  openings: 'uniform',
};

export function physical(binder: Binder): Physical {
  return {
    card: binder.card ?? DEFAULT_PHYSICAL.card,
    pocketGap: binder.pocketGap ?? DEFAULT_PHYSICAL.pocketGap,
    spineGap: binder.spineGap ?? DEFAULT_PHYSICAL.spineGap,
    openings: binder.openings ?? DEFAULT_PHYSICAL.openings,
  };
}

export function cardAspect(binder: Binder): number {
  const { card } = physical(binder);
  return card.w / card.h;
}

/**
 * What separates two neighbouring pockets.
 * - `facing`: their openings meet, so one uncut piece slides into both.
 * - `seam`: a welded divider, so each pocket needs its own piece.
 * - `spine`: the two pockets are on different pages of a spread.
 */
export type Boundary = 'facing' | 'seam' | 'spine';

/** The boundary immediately left of column `col` on a page. */
export function columnBoundary(binder: Binder, col: number): Boundary {
  return physical(binder).openings === 'columns' && col % 2 === 1 ? 'facing' : 'seam';
}

/** The boundary immediately above row `row`. */
export function rowBoundary(binder: Binder, row: number): Boundary {
  return physical(binder).openings === 'rows' && row % 2 === 1 ? 'facing' : 'seam';
}

/** Distances used to lay a placement out: millimetres in print, page fractions on screen. */
export interface Metrics {
  cardW: number;
  cardH: number;
  gap: number;
  spine: number;
}

export function printMetrics(binder: Binder): Metrics {
  const p = physical(binder);
  return { cardW: p.card.w, cardH: p.card.h, gap: p.pocketGap, spine: p.spineGap };
}

/** One printable piece: the pockets it fills and its rect inside the placement's box. */
export interface Piece {
  page: number;
  col: number;
  row: number;
  spanCols: number;
  spanRows: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementLayout {
  boxW: number;
  boxH: number;
  pieces: Piece[];
  /** True when at least one piece covers more than one pocket. */
  hasUncutPair: boolean;
  crossesSpine: boolean;
}

interface Run {
  start: number;
  end: number;
}

function runs(count: number, isFacing: (index: number) => boolean): Run[] {
  const out: Run[] = [{ start: 0, end: 0 }];
  for (let i = 1; i < count; i++) {
    if (isFacing(i)) out[out.length - 1].end = i;
    else out.push({ start: i, end: i });
  }
  return out;
}

/**
 * Break a placement into the pieces of paper it actually needs, and give each
 * one its rect within the placement's whole image box. Screen rendering and
 * print slicing both use this, so a plan and its print always agree.
 */
export function layoutPlacement(binder: Binder, placement: Placement, m: Metrics): PlacementLayout {
  // Which page and column each column of the footprint lands on.
  const columns = Array.from({ length: placement.spanCols }, (_, i) => {
    const abs = placement.col + i;
    return abs < binder.cols
      ? { page: placement.page, col: abs }
      : { page: placement.page + 1, col: abs - binder.cols };
  });

  const colBoundary = (i: number): Boundary =>
    columns[i].page !== columns[i - 1].page ? 'spine' : columnBoundary(binder, columns[i].col);

  const xs: number[] = [0];
  for (let i = 1; i < columns.length; i++) {
    xs.push(xs[i - 1] + m.cardW + (colBoundary(i) === 'spine' ? m.spine : m.gap));
  }
  const ys: number[] = [0];
  for (let j = 1; j < placement.spanRows; j++) ys.push(ys[j - 1] + m.cardH + m.gap);

  const colRuns = runs(columns.length, (i) => colBoundary(i) === 'facing');
  const rowRuns = runs(placement.spanRows, (j) => rowBoundary(binder, placement.row + j) === 'facing');

  const pieces: Piece[] = [];
  for (const r of rowRuns) {
    for (const c of colRuns) {
      pieces.push({
        page: columns[c.start].page,
        col: columns[c.start].col,
        row: placement.row + r.start,
        spanCols: c.end - c.start + 1,
        spanRows: r.end - r.start + 1,
        x: xs[c.start],
        y: ys[r.start],
        w: xs[c.end] + m.cardW - xs[c.start],
        h: ys[r.end] + m.cardH - ys[r.start],
      });
    }
  }

  return {
    boxW: xs[xs.length - 1] + m.cardW,
    boxH: ys[ys.length - 1] + m.cardH,
    pieces,
    hasUncutPair: pieces.some((p) => p.spanCols * p.spanRows > 1),
    crossesSpine: columns.some((c) => c.page !== placement.page),
  };
}
