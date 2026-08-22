import type { Binder, ImageSrc, Placement } from '../types';

/**
 * Print geometry. Everything here is in millimetres, because that is what a
 * ruler and a binder pocket speak. A pocket holds one piece of paper, so a
 * placement that spans several pockets prints as several separate tiles.
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

export interface CardSize {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const CARD_SIZES: CardSize[] = [
  { id: 'standard', label: 'Standard 63×88', w: 63, h: 88 },
  { id: 'japanese', label: 'Japanese 59×86', w: 59, h: 86 },
];

export interface PrintOptions {
  paperId: string;
  landscape: boolean;
  card: { w: number; h: number };
  /** Width of the divider between two pockets, measured on the real binder. */
  pocketGap: number;
  cutMarks: boolean;
  labels: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  paperId: 'letter',
  landscape: false,
  card: { w: 63, h: 88 },
  pocketGap: 4,
  cutMarks: true,
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
}

const MIN_MARGIN = 6;
const GUTTER = 4;
const FOOTER = 9;

export function sheetLayout(options: PrintOptions): SheetLayout {
  const paper = PAPERS.find((p) => p.id === options.paperId) ?? PAPERS[0];
  const pageW = options.landscape ? paper.h : paper.w;
  const pageH = options.landscape ? paper.w : paper.h;

  const usableW = pageW - 2 * MIN_MARGIN;
  const usableH = pageH - 2 * MIN_MARGIN - FOOTER;
  const cols = Math.max(1, Math.floor((usableW + GUTTER) / (options.card.w + GUTTER)));
  const rows = Math.max(1, Math.floor((usableH + GUTTER) / (options.card.h + GUTTER)));

  const blockW = cols * options.card.w + (cols - 1) * GUTTER;
  const blockH = rows * options.card.h + (rows - 1) * GUTTER;

  return {
    pageW,
    pageH,
    cols,
    rows,
    perSheet: cols * rows,
    gap: GUTTER,
    marginX: (pageW - blockW) / 2,
    marginY: Math.max(MIN_MARGIN, (pageH - FOOTER - blockH) / 2),
    footer: FOOTER,
  };
}

export interface PrintTile {
  id: string;
  itemId: string;
  name: string;
  /** Where this piece goes: page, column, row (1-based, for the label). */
  label: string;
  image: ImageSrc;
  /** The image's box inside the tile, in mm, relative to the tile's top-left. */
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  originX: number;
  originY: number;
  /** Resolution the source image lands at once printed, in dots per inch. */
  dpi: number;
}

export interface Natural {
  url: string;
  w: number;
  h: number;
}

/**
 * Slice one placement into the pieces of paper it needs.
 *
 * With a pocket gap set, the art is laid out across the full span the binder
 * gives it — dividers included — and the strips that would sit behind a divider
 * are simply not printed. Lines then run true across the seam, which is what
 * makes a two-pocket mural look like one picture. A gap of 0 slices the image
 * into equal pieces instead, keeping every pixel.
 */
export function tilesForPlacement(
  placement: Placement,
  itemId: string,
  name: string,
  image: ImageSrc,
  natural: { w: number; h: number },
  options: PrintOptions,
): PrintTile[] {
  const { card, pocketGap } = options;
  const boxW = placement.spanCols * card.w + (placement.spanCols - 1) * pocketGap;
  const boxH = placement.spanRows * card.h + (placement.spanRows - 1) * pocketGap;

  const scale =
    placement.fit === 'cover'
      ? Math.max(boxW / natural.w, boxH / natural.h)
      : Math.min(boxW / natural.w, boxH / natural.h);
  const drawW = natural.w * scale;
  const drawH = natural.h * scale;
  const offsetX = placement.fit === 'cover' ? (boxW - drawW) * (placement.focusX / 100) : (boxW - drawW) / 2;
  const offsetY = placement.fit === 'cover' ? (boxH - drawH) * (placement.focusY / 100) : (boxH - drawH) / 2;
  const dpi = (natural.w / drawW) * 25.4;

  const tiles: PrintTile[] = [];
  for (let row = 0; row < placement.spanRows; row++) {
    for (let col = 0; col < placement.spanCols; col++) {
      const tileX = col * (card.w + pocketGap);
      const tileY = row * (card.h + pocketGap);
      tiles.push({
        id: `${placement.id}-${col}-${row}`,
        itemId,
        name,
        label: `P${placement.page + 1} · C${placement.col + col + 1} R${placement.row + row + 1}`,
        image,
        left: offsetX - tileX,
        top: offsetY - tileY,
        width: drawW,
        height: drawH,
        rotation: placement.rotation,
        originX: boxW / 2 - tileX,
        originY: boxH / 2 - tileY,
        dpi,
      });
    }
  }
  return tiles;
}

/** Every tile the chosen placements need, in the order you would fill the binder. */
export function buildTiles(
  binder: Binder,
  selectedItemIds: Set<string>,
  naturals: Map<string, Natural>,
  options: PrintOptions,
): PrintTile[] {
  const ordered = [...binder.placements].sort((a, b) => a.page - b.page || a.row - b.row || a.col - b.col);
  const tiles: PrintTile[] = [];
  for (const placement of ordered) {
    if (!selectedItemIds.has(placement.itemId)) continue;
    const item = binder.library.find((i) => i.id === placement.itemId);
    const natural = naturals.get(placement.itemId);
    if (!item?.image || !natural) continue;
    tiles.push(...tilesForPlacement(placement, item.id, item.name, item.image, natural, options));
  }
  return tiles;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function dpiGrade(dpi: number): 'good' | 'fair' | 'poor' {
  if (dpi >= 280) return 'good';
  if (dpi >= 180) return 'fair';
  return 'poor';
}
