import type { Binder, Opening, Placement } from '../types';

/** Physical measurements of the binder, in millimetres. */
export interface Physical {
  card: { w: number; h: number };
  pocketGap: number;
  spineGap: number;
  /** Opening side of each column on a right-hand page. */
  openings: Opening[];
}

/**
 * The usual build: on a right-hand page every pocket loads from its right edge
 * except the outermost one, which loads from the left — so the last two pockets
 * of each row open towards each other. Mirrored onto a left-hand page that
 * becomes the first two pockets.
 */
export function defaultOpenings(cols: number): Opening[] {
  return Array.from({ length: cols }, (_, i) => (i === cols - 1 ? 'left' : 'right'));
}

export const DEFAULT_PHYSICAL: Omit<Physical, 'openings'> = {
  card: { w: 63, h: 88 },
  pocketGap: 4,
  spineGap: 24,
};

export function physical(binder: Binder): Physical {
  const stored = binder.pocketOpenings;
  const openings =
    Array.isArray(stored) && stored.length === binder.cols && stored.every((o) => o === 'left' || o === 'right')
      ? stored
      : defaultOpenings(binder.cols);
  return {
    card: binder.card ?? DEFAULT_PHYSICAL.card,
    pocketGap: binder.pocketGap ?? DEFAULT_PHYSICAL.pocketGap,
    spineGap: binder.spineGap ?? DEFAULT_PHYSICAL.spineGap,
    openings,
  };
}

const flip = (o: Opening): Opening => (o === 'left' ? 'right' : 'left');

/**
 * The opening pattern as seen on one page. A left-hand page is the back of the
 * same sheet, so the welds sit in the same physical places but left and right
 * swap: its pattern is the right-hand one mirrored.
 */
export function openingsOn(binder: Binder, leftHandPage: boolean): Opening[] {
  const openings = physical(binder).openings;
  return leftHandPage ? [...openings].reverse().map(flip) : openings;
}

/** Pockets whose openings meet, as 1-based column pairs — used for the hints. */
export function facingPairs(openings: Opening[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 1; i < openings.length; i++) {
    if (openings[i - 1] === 'right' && openings[i] === 'left') pairs.push([i, i + 1]);
  }
  return pairs;
}

export function pairsLabel(openings: Opening[]): string {
  const pairs = facingPairs(openings);
  return pairs.length ? pairs.map(([a, b]) => `${a}–${b}`).join(', ') : 'none';
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

/** The boundary immediately left of column `col`, on the page it belongs to. */
export function columnBoundary(binder: Binder, leftHandPage: boolean, col: number): Boundary {
  const openings = openingsOn(binder, leftHandPage);
  return openings[col - 1] === 'right' && openings[col] === 'left' ? 'facing' : 'seam';
}

/**
 * The boundary immediately above `row`. Always a seam: pockets open at the
 * side, so two pockets stacked on top of each other are never continuous and
 * art spanning them has to be cut.
 */
export function rowBoundary(): Boundary {
  return 'seam';
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
export function layoutPlacement(
  binder: Binder,
  placement: Placement,
  m: Metrics,
  isLeftHandPage: (page: number) => boolean,
): PlacementLayout {
  // Which page and column each column of the footprint lands on.
  const columns = Array.from({ length: placement.spanCols }, (_, i) => {
    const abs = placement.col + i;
    return abs < binder.cols
      ? { page: placement.page, col: abs }
      : { page: placement.page + 1, col: abs - binder.cols };
  });

  const colBoundary = (i: number): Boundary =>
    columns[i].page !== columns[i - 1].page
      ? 'spine'
      : columnBoundary(binder, isLeftHandPage(columns[i].page), columns[i].col);

  const xs: number[] = [0];
  for (let i = 1; i < columns.length; i++) {
    xs.push(xs[i - 1] + m.cardW + (colBoundary(i) === 'spine' ? m.spine : m.gap));
  }
  const ys: number[] = [0];
  for (let j = 1; j < placement.spanRows; j++) ys.push(ys[j - 1] + m.cardH + m.gap);

  const colRuns = runs(columns.length, (i) => colBoundary(i) === 'facing');
  const rowRuns = runs(placement.spanRows, () => rowBoundary() === 'facing');

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
