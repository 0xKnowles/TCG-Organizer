import type { Binder, ImageSrc, Placement } from '../types';
import { layoutPlacement } from './geometry';
import { physical, printMetrics, type Piece } from './pockets';

/**
 * Print geometry, in millimetres — what a ruler and a binder pocket speak.
 * A pocket holds one piece of paper, except where two pockets have their
 * openings facing each other: that pair takes a single uncut piece.
 */

export interface Paper {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const PAPERS: Paper[] = [
  { id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
];

export const CARD_SIZES = [
  { id: 'standard', label: 'Standard 63×88', w: 63, h: 88 },
  { id: 'japanese', label: 'Japanese 59×86', w: 59, h: 86 },
];

export interface PrintOptions {
  paperId: string;
  landscape: boolean;
  cutLines: boolean;
  labels: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paperId: 'letter',
  landscape: false,
  cutLines: true,
  labels: true,
};

export interface SheetLayout {
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  perSheet: number;
  gap: number;
  marginX: number;
  marginY: number;
  footer: number;
  cell: { w: number; h: number };
}

const MIN_MARGIN = 6;
const MIN_GUTTER = 4;
const FOOTER = 9;
export const CUT_OVERHANG = 7;

export function sheetLayout(binder: Binder, options: PrintOptions): SheetLayout {
  const { card, pocketGap } = physical(binder);
  const paper = PAPERS.find((p) => p.id === options.paperId) ?? PAPERS[0];
  const pageW = options.landscape ? paper.h : paper.w;
  const pageH = options.landscape ? paper.w : paper.h;
  // Cells are spaced at least as far apart as the binder's own pockets, so a
  // piece covering two pockets still fits the cell block it is given.
  const gutter = Math.max(MIN_GUTTER, pocketGap);

  const usableW = pageW - 2 * MIN_MARGIN;
  const usableH = pageH - 2 * MIN_MARGIN - FOOTER;
  const cols = Math.max(1, Math.floor((usableW + gutter) / (card.w + gutter)));
  const rows = Math.max(1, Math.floor((usableH + gutter) / (card.h + gutter)));
  const blockW = cols * card.w + (cols - 1) * gutter;
  const blockH = rows * card.h + (rows - 1) * gutter;

  return {
    pageW,
    pageH,
    cols,
    rows,
    perSheet: cols * rows,
    gap: gutter,
    marginX: (pageW - blockW) / 2,
    marginY: Math.max(MIN_MARGIN, (pageH - FOOTER - blockH) / 2),
    footer: FOOTER,
    cell: card,
  };
}

export interface PrintTile {
  id: string;
  itemId: string;
  name: string;
  label: string;
  image: ImageSrc;
  /** Size of the piece of paper, in mm. */
  w: number;
  h: number;
  /** Cells it takes up on the sheet. */
  cellCols: number;
  cellRows: number;
  /** True when this piece fills more than one pocket, so it must not be cut. */
  uncut: boolean;
  /** The image's box inside the piece, in mm, relative to the piece's top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  originX: number;
  originY: number;
  dpi: number;
}

export interface Natural {
  url: string;
  w: number;
  h: number;
}

function pieceLabel(piece: Piece): string {
  const cols = piece.spanCols > 1 ? `C${piece.col + 1}–${piece.col + piece.spanCols}` : `C${piece.col + 1}`;
  const rows = piece.spanRows > 1 ? `R${piece.row + 1}–${piece.row + piece.spanRows}` : `R${piece.row + 1}`;
  return `P${piece.page + 1} · ${cols} ${rows}`;
}

/** Slice one placement into the pieces of paper it needs. */
export function tilesForPlacement(
  binder: Binder,
  placement: Placement,
  itemId: string,
  name: string,
  image: ImageSrc,
  natural: { w: number; h: number },
): PrintTile[] {
  const metrics = printMetrics(binder);
  const laid = layoutPlacement(binder, placement, metrics);

  const scale =
    placement.fit === 'cover'
      ? Math.max(laid.boxW / natural.w, laid.boxH / natural.h)
      : Math.min(laid.boxW / natural.w, laid.boxH / natural.h);
  const drawW = natural.w * scale;
  const drawH = natural.h * scale;
  const offsetX = placement.fit === 'cover' ? (laid.boxW - drawW) * (placement.focusX / 100) : (laid.boxW - drawW) / 2;
  const offsetY = placement.fit === 'cover' ? (laid.boxH - drawH) * (placement.focusY / 100) : (laid.boxH - drawH) / 2;
  const dpi = (natural.w / drawW) * 25.4;

  return laid.pieces.map((piece) => ({
    id: `${placement.id}-${piece.page}-${piece.col}-${piece.row}`,
    itemId,
    name,
    label: pieceLabel(piece),
    image,
    w: piece.w,
    h: piece.h,
    cellCols: piece.spanCols,
    cellRows: piece.spanRows,
    uncut: piece.spanCols * piece.spanRows > 1,
    left: offsetX - piece.x,
    top: offsetY - piece.y,
    width: drawW,
    height: drawH,
    rotation: placement.rotation,
    originX: laid.boxW / 2 - piece.x,
    originY: laid.boxH / 2 - piece.y,
    dpi,
  }));
}

/** Every piece the chosen placements need, in the order you would fill the binder. */
export function buildTiles(binder: Binder, selectedItemIds: Set<string>, naturals: Map<string, Natural>): PrintTile[] {
  const ordered = [...binder.placements].sort((a, b) => a.page - b.page || a.row - b.row || a.col - b.col);
  const tiles: PrintTile[] = [];
  for (const placement of ordered) {
    if (!selectedItemIds.has(placement.itemId)) continue;
    const item = binder.library.find((i) => i.id === placement.itemId);
    const natural = naturals.get(placement.itemId);
    if (!item?.image || !natural) continue;
    tiles.push(...tilesForPlacement(binder, placement, item.id, item.name, item.image, natural));
  }
  return tiles;
}

export interface PlacedTile {
  tile: PrintTile;
  col: number;
  row: number;
  x: number;
  y: number;
  index: number;
}

export interface Sheet {
  tiles: PlacedTile[];
}

/**
 * Lay pieces onto sheets. Pieces are card-sized or bigger, so this is a small
 * first-fit pack over the sheet's grid of cells that keeps binder order.
 */
export function packSheets(tiles: PrintTile[], layout: SheetLayout): Sheet[] {
  const sheets: Sheet[] = [];
  let grid: boolean[][] = [];
  let current: PlacedTile[] = [];
  let index = 0;

  const startSheet = () => {
    grid = Array.from({ length: layout.rows }, () => new Array<boolean>(layout.cols).fill(false));
    current = [];
  };
  const fits = (col: number, row: number, w: number, h: number) => {
    if (col + w > layout.cols || row + h > layout.rows) return false;
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (grid[r][c]) return false;
    return true;
  };
  const occupy = (col: number, row: number, w: number, h: number) => {
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) grid[r][c] = true;
  };

  startSheet();
  for (const tile of tiles) {
    let spot: { col: number; row: number } | null = null;
    for (let row = 0; row < layout.rows && !spot; row++) {
      for (let col = 0; col < layout.cols && !spot; col++) {
        if (fits(col, row, tile.cellCols, tile.cellRows)) spot = { col, row };
      }
    }
    if (!spot) {
      sheets.push({ tiles: current });
      startSheet();
      spot = { col: 0, row: 0 };
      if (!fits(0, 0, tile.cellCols, tile.cellRows)) continue; // too big for any sheet
    }
    occupy(spot.col, spot.row, tile.cellCols, tile.cellRows);
    current.push({
      tile,
      col: spot.col,
      row: spot.row,
      x: layout.marginX + spot.col * (layout.cell.w + layout.gap),
      y: layout.marginY + spot.row * (layout.cell.h + layout.gap),
      index: ++index,
    });
  }
  if (current.length) sheets.push({ tiles: current });
  return sheets;
}

export interface CutLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Cut lines around each piece — never through one, so a two-pocket piece stays
 * whole. Collinear edges are merged so a ruler can follow one line across the
 * sheet, and every line runs a little past the pieces it serves.
 */
export function cutGuides(sheet: Sheet, layout: SheetLayout): CutLine[] {
  const clampX = (v: number) => Math.max(2.5, Math.min(layout.pageW - 2.5, v));
  const clampY = (v: number) => Math.max(2.5, Math.min(layout.pageH - 2.5, v));

  const vertical = new Map<number, [number, number][]>();
  const horizontal = new Map<number, [number, number][]>();
  const add = (map: Map<number, [number, number][]>, at: number, from: number, to: number) => {
    const key = Math.round(at * 100) / 100;
    const list = map.get(key) ?? [];
    list.push([from, to]);
    map.set(key, list);
  };

  for (const { tile, x, y } of sheet.tiles) {
    add(vertical, x, y, y + tile.h);
    add(vertical, x + tile.w, y, y + tile.h);
    add(horizontal, y, x, x + tile.w);
    add(horizontal, y + tile.h, x, x + tile.w);
  }

  const merge = (ranges: [number, number][]): [number, number][] => {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    for (const [from, to] of sorted) {
      const last = out[out.length - 1];
      if (last && from <= last[1] + layout.gap + 0.01) last[1] = Math.max(last[1], to);
      else out.push([from, to]);
    }
    return out;
  };

  const lines: CutLine[] = [];
  for (const [x, ranges] of vertical) {
    for (const [from, to] of merge(ranges)) {
      lines.push({ x1: x, y1: clampY(from - CUT_OVERHANG), x2: x, y2: clampY(to + CUT_OVERHANG) });
    }
  }
  for (const [y, ranges] of horizontal) {
    for (const [from, to] of merge(ranges)) {
      lines.push({ x1: clampX(from - CUT_OVERHANG), y1: y, x2: clampX(to + CUT_OVERHANG), y2: y });
    }
  }
  return lines;
}

export function dpiGrade(dpi: number): 'good' | 'fair' | 'poor' {
  if (dpi >= 280) return 'good';
  if (dpi >= 180) return 'fair';
  return 'poor';
}
