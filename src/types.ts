/** Where the pixels for an item live. Remote = a URL, local = a blob in IndexedDB. */
export type ImageSrc = { type: 'remote'; url: string } | { type: 'local'; key: string };

export interface CardItem {
  id: string;
  kind: 'card';
  name: string;
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

export interface Binder {
  id: string;
  name: string;
  cols: number;
  rows: number;
  pageCount: number;
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
