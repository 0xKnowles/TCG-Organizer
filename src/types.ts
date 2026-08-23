/** Where the pixels for an item live. Remote = a URL, local = a blob in IndexedDB. */
export type ImageSrc = { type: 'remote'; url: string } | { type: 'local'; key: string };

/** Where an item came from, so printing can default to what you must print. */
export type Origin = 'api' | 'upload' | 'link' | 'csv';

export interface CardItem {
  id: string;
  kind: 'card';
  name: string;
  origin?: Origin;
  /** False marks a card you still need: it shows as a ghost in its pocket. */
  owned?: boolean;
  /** How many you have (or want), carried over from a CSV import. */
  quantity?: number;
  setName?: string;
  number?: string;
  image?: ImageSrc;
  /** Free-form note: condition, language, "need to buy", etc. */
  note?: string;
}

export interface ArtItem {
  id: string;
  kind: 'art';
  name: string;
  origin?: Origin;
  owned?: boolean;
  image: ImageSrc;
  /** Default footprint in slots when dropped into a page. */
  spanCols: number;
  spanRows: number;
}

export type LibraryItem = CardItem | ArtItem;

export interface Placement {
  id: string;
  itemId: string;
  kind: 'card' | 'art';
  /** 0-based page index. */
  page: number;
  /** 0-based anchor slot (top-left corner of the footprint). */
  col: number;
  row: number;
  spanCols: number;
  spanRows: number;
  /** How the image sits inside its footprint. */
  fit: 'cover' | 'contain';
  /** Focal point for `cover`, in percent. */
  focusX: number;
  focusY: number;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Which edge a pocket loads from. Pockets open at the side, never the top or
 * bottom, so only side-by-side pockets can have their openings facing each
 * other — a pair like that takes one uncut piece of art. Two pockets stacked
 * vertically are always separated by a weld and always need cutting.
 */
export type Opening = 'left' | 'right';

export interface Binder {
  id: string;
  name: string;
  cols: number;
  rows: number;
  pageCount: number;
  /** Card size in mm. Drives pocket proportions on screen and in print. */
  card?: { w: number; h: number };
  /** Millimetres between two pockets on the same page. */
  pocketGap?: number;
  /** Millimetres between the facing pockets either side of the spine. */
  spineGap?: number;
  /**
   * Opening side of each column, for a right-hand page. A left-hand page is the
   * other face of the same sheet, so its pattern is this one mirrored.
   */
  pocketOpenings?: Opening[];
  /** Real binders open on a single page 1, then true left/right spreads. */
  firstPageAlone: boolean;
  library: LibraryItem[];
  placements: Placement[];
  updatedAt: number;
}

export interface Rect {
  page: number;
  col: number;
  row: number;
  spanCols: number;
  spanRows: number;
}

/** Payload carried by an HTML5 drag from the library or from another slot. */
export type DragPayload =
  | { source: 'library'; itemId: string; kind: 'card' | 'art'; spanCols: number; spanRows: number }
  | {
      source: 'placement';
      placementId: string;
      kind: 'card' | 'art';
      spanCols: number;
      spanRows: number;
      grabCol: number;
      grabRow: number;
    };
