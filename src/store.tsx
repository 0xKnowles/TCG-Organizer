import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ArtItem, Binder, CardItem, LibraryItem, Placement } from './types';
import { canDrop, firstFreeSlot, inBounds, occupantsOf, rectOf } from './lib/geometry';
import { allKeys, deleteBlob } from './lib/idb';
import { clamp, uid } from './lib/util';

const STORAGE_KEY = 'binder-studio:binder:v1';

export function makeBinder(cols: number, rows: number, name = 'My Binder'): Binder {
  return {
    id: uid('binder'),
    name,
    cols,
    rows,
    pageCount: 4,
    firstPageAlone: false,
    library: [],
    placements: [],
    updatedAt: Date.now(),
  };
}

export type Action =
  | { type: 'load'; binder: Binder }
  | { type: 'reset' }
  | { type: 'rename'; name: string }
  | { type: 'setLayout'; cols: number; rows: number }
  | { type: 'setFirstPageAlone'; value: boolean }
  | { type: 'setPhysical'; patch: Partial<Pick<Binder, 'card' | 'pocketGap' | 'spineGap' | 'openings'>> }
  | { type: 'addItems'; items: LibraryItem[] }
  | { type: 'updateItem'; id: string; patch: Partial<CardItem> & Partial<ArtItem> }
  | { type: 'removeItem'; id: string }
  | { type: 'addPage'; at?: number }
  | { type: 'removePage'; index: number }
  | { type: 'place'; itemId: string; page: number; col: number; row: number }
  | { type: 'movePlacement'; id: string; page: number; col: number; row: number }
  | { type: 'updatePlacement'; id: string; patch: Partial<Placement> }
  | { type: 'removePlacement'; id: string }
  | { type: 'clearPage'; page: number }
  | { type: 'autoFill'; page: number };

function touch(b: Binder): Binder {
  return { ...b, updatedAt: Date.now() };
}

function findItem(b: Binder, id: string): LibraryItem | undefined {
  return b.library.find((i) => i.id === id);
}

export function reducer(state: Binder, action: Action): Binder {
  switch (action.type) {
    case 'load':
      return action.binder;

    case 'reset':
      return makeBinder(state.cols, state.rows, state.name);

    case 'rename':
      return touch({ ...state, name: action.name });

    case 'setLayout': {
      const cols = clamp(Math.round(action.cols), 1, 8);
      const rows = clamp(Math.round(action.rows), 1, 8);
      const next = { ...state, cols, rows };
      // Anything that no longer fits the new grid goes back to the library.
      return touch({ ...next, placements: state.placements.filter((p) => inBounds(next, rectOf(p))) });
    }

    case 'setFirstPageAlone': {
      // Which pages face each other changes, so art across the spine may no
      // longer line up. Pull those back onto a single page rather than lie.
      const next = { ...state, firstPageAlone: action.value };
      const placements = next.placements.map((p) =>
        inBounds(next, rectOf(p)) ? p : { ...p, spanCols: Math.max(1, next.cols - p.col) },
      );
      return touch({ ...next, placements });
    }

    case 'setPhysical':
      return touch({ ...state, ...action.patch });

    case 'addItems':
      return touch({ ...state, library: [...action.items, ...state.library] });

    case 'updateItem': {
      const library = state.library.map((i) => (i.id === action.id ? ({ ...i, ...action.patch } as LibraryItem) : i));
      return touch({ ...state, library });
    }

    case 'removeItem':
      return touch({
        ...state,
        library: state.library.filter((i) => i.id !== action.id),
        placements: state.placements.filter((p) => p.itemId !== action.id),
      });

    case 'addPage': {
      const at = action.at ?? state.pageCount;
      const placements = state.placements.map((p) => (p.page >= at ? { ...p, page: p.page + 1 } : p));
      return touch({ ...state, pageCount: state.pageCount + 1, placements });
    }

    case 'removePage': {
      if (state.pageCount <= 1) return state;
      const placements = state.placements
        .filter((p) => p.page !== action.index)
        .map((p) => (p.page > action.index ? { ...p, page: p.page - 1 } : p));
      return touch({ ...state, pageCount: state.pageCount - 1, placements });
    }

    case 'place': {
      const item = findItem(state, action.itemId);
      if (!item) return state;
      const spanCols = item.kind === 'art' ? item.spanCols : 1;
      const spanRows = item.kind === 'art' ? item.spanRows : 1;
      const rect = { page: action.page, col: action.col, row: action.row, spanCols, spanRows };
      if (!canDrop(state, rect)) return state;
      // A 1x1 drop onto an occupied slot replaces what was there.
      const displaced = occupantsOf(state, rect).map((p) => p.id);
      const placement: Placement = {
        id: uid('pl'),
        itemId: item.id,
        kind: item.kind,
        page: action.page,
        col: action.col,
        row: action.row,
        spanCols,
        spanRows,
        fit: 'cover',
        focusX: 50,
        focusY: 50,
        rotation: 0,
      };
      return touch({
        ...state,
        placements: [...state.placements.filter((p) => !displaced.includes(p.id)), placement],
      });
    }

    case 'movePlacement': {
      const moving = state.placements.find((p) => p.id === action.id);
      if (!moving) return state;
      const rect = {
        page: action.page,
        col: action.col,
        row: action.row,
        spanCols: moving.spanCols,
        spanRows: moving.spanRows,
      };
      if (!canDrop(state, rect, moving.id)) return state;
      const other = occupantsOf(state, rect, moving.id)[0];
      const placements = state.placements.map((p) => {
        if (p.id === moving.id) return { ...p, page: action.page, col: action.col, row: action.row };
        // Single-slot collisions swap seats instead of failing.
        if (other && p.id === other.id) return { ...p, page: moving.page, col: moving.col, row: moving.row };
        return p;
      });
      return touch({ ...state, placements });
    }

    case 'updatePlacement': {
      const target = state.placements.find((p) => p.id === action.id);
      if (!target) return state;
      const next = { ...target, ...action.patch };
      if (next.spanCols !== target.spanCols || next.spanRows !== target.spanRows) {
        if (!canDrop(state, rectOf(next), target.id)) return state;
      }
      return touch({ ...state, placements: state.placements.map((p) => (p.id === action.id ? next : p)) });
    }

    case 'removePlacement':
      return touch({ ...state, placements: state.placements.filter((p) => p.id !== action.id) });

    case 'clearPage':
      return touch({ ...state, placements: state.placements.filter((p) => p.page !== action.page) });

    case 'autoFill': {
      const placedIds = new Set(state.placements.map((p) => p.itemId));
      const queue = state.library.filter((i) => i.kind === 'card' && !placedIds.has(i.id));
      let next = state;
      for (const item of queue) {
        const spot = firstFreeSlot(next, action.page);
        if (!spot) break;
        next = reducer(next, { type: 'place', itemId: item.id, page: action.page, col: spot.col, row: spot.row });
      }
      return next;
    }

    default:
      return state;
  }
}

function loadInitial(): Binder | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Binder;
    if (!parsed || typeof parsed.cols !== 'number' || !Array.isArray(parsed.library)) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface Ctx {
  binder: Binder | null;
  dispatch: (action: Action) => void;
  createBinder: (cols: number, rows: number, name: string) => void;
  loadBinder: (binder: Binder) => void;
  closeBinder: () => void;
}

const BinderContext = createContext<Ctx | null>(null);

export function BinderProvider({ children }: { children: React.ReactNode }) {
  const [binder, setBinder] = useState<Binder | null>(() => loadInitial());

  const dispatch = useCallback((action: Action) => {
    setBinder((current) => (current ? reducer(current, action) : current));
  }, []);

  const createBinder = useCallback((cols: number, rows: number, name: string) => {
    setBinder(makeBinder(cols, rows, name));
  }, []);

  const loadBinder = useCallback((next: Binder) => setBinder(next), []);

  const closeBinder = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setBinder(null);
  }, []);

  useEffect(() => {
    if (!binder) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(binder));
    } catch (err) {
      console.warn('Could not save binder (storage may be full)', err);
    }
  }, [binder]);

  // Housekeeping: drop image blobs nothing points at any more.
  useEffect(() => {
    if (!binder) return;
    const timer = setTimeout(async () => {
      try {
        const referenced = new Set(
          binder.library
            .map((i) => i.image)
            .filter((img): img is { type: 'local'; key: string } => !!img && img.type === 'local')
            .map((img) => img.key),
        );
        for (const key of await allKeys()) {
          if (typeof key === 'string' && !referenced.has(key)) await deleteBlob(key);
        }
      } catch {
        /* best effort only */
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [binder?.library]);

  const value = useMemo<Ctx>(
    () => ({ binder, dispatch, createBinder, loadBinder, closeBinder }),
    [binder, dispatch, createBinder, loadBinder, closeBinder],
  );
  return <BinderContext.Provider value={value}>{children}</BinderContext.Provider>;
}

export function useBinderCtx(): Ctx {
  const ctx = useContext(BinderContext);
  if (!ctx) throw new Error('useBinderCtx must be used inside <BinderProvider>');
  return ctx;
}

/** Convenience for the many components that only render with a live binder. */
export function useBinder(): { binder: Binder; dispatch: (action: Action) => void } {
  const { binder, dispatch } = useBinderCtx();
  if (!binder) throw new Error('No binder in context');
  return { binder, dispatch };
}

export { STORAGE_KEY };
