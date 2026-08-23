import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BinderSetup from './components/BinderSetup';
import LibraryPanel from './components/LibraryPanel';
import PageView, { type Pending } from './components/PageView';
import Inspector from './components/Inspector';
import TopBar, { type ViewMode } from './components/TopBar';
import PrintDialog from './components/PrintDialog';
import type { LibraryItem } from './types';
import { useBinderCtx } from './store';
import { anchorAt, canDrop, pageAspect, spineFraction, spreadCount, spreadPages } from './lib/geometry';
import { useMediaQuery } from './lib/useMediaQuery';
import { clamp } from './lib/util';

function Workspace() {
  const { binder, dispatch } = useBinderCtx();
  const wide = useMediaQuery('(min-width: 900px)');
  const canDrag = useMediaQuery('(pointer: fine)');

  const [preferredMode, setPreferredMode] = useState<ViewMode>('spread');
  const mode: ViewMode = wide ? preferredMode : 'single';
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const total = binder ? spreadCount(binder, mode) : 1;
  const index = clamp(spreadIndex, 0, Math.max(0, total - 1));
  const pages = useMemo(() => (binder ? spreadPages(binder, index, mode) : []), [binder, index, mode]);
  const activePage = pages.find((p): p is number => p !== null) ?? 0;
  const selected = binder?.placements.find((p) => p.id === selectedId) ?? null;

  // The page is sized from the height available, so a spread always fits.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spreadWidth = useMemo(() => {
    if (!binder || !box.width || !box.height) return undefined;
    const caption = mode === 'spread' ? 24 : 0;
    const aspect = pageAspect(binder);
    const gridHeight = Math.max(80, box.height - caption);
    const pageWidth = gridHeight * aspect;
    // The gap between pages stands in for the binder's spine.
    const gap = pages.length > 1 ? pageWidth * spineFraction(binder) : 0;
    const byHeight = pageWidth * pages.length + gap * (pages.length - 1);
    return { width: Math.min(byHeight, box.width), gap: gap * Math.min(1, box.width / byHeight) };
  }, [binder, box, pages.length, mode]);

  const clearPending = useCallback(() => {
    setPending(null);
    setPlaceError(null);
  }, []);

  const hold = useCallback(
    (item: LibraryItem) => {
      setSelectedId(null);
      setPending((current) =>
        current?.kind === 'place' && current.itemId === item.id
          ? null
          : {
              kind: 'place',
              itemId: item.id,
              spanCols: item.kind === 'art' ? item.spanCols : 1,
              spanRows: item.kind === 'art' ? item.spanRows : 1,
            },
      );
      if (!wide) setLibraryOpen(false);
    },
    [wide],
  );

  const onPocket = useCallback(
    (page: number, col: number, row: number) => {
      if (!pending || !binder) return;
      const { spanCols, spanRows } = pending;
      // Snap the footprint the same way a drag does — it may cross the spine.
      const { col: anchorCol, row: anchorRow } = anchorAt(binder, page, { col, row }, { spanCols, spanRows });
      const except = pending.kind === 'move' ? pending.placementId : undefined;
      if (!canDrop(binder, { page, col: anchorCol, row: anchorRow, spanCols, spanRows }, except)) {
        setPlaceError(`No room for ${spanCols}×${spanRows} there`);
        return;
      }
      if (pending.kind === 'place') {
        dispatch({ type: 'place', itemId: pending.itemId, page, col: anchorCol, row: anchorRow });
      } else {
        dispatch({ type: 'movePlacement', id: pending.placementId, page, col: anchorCol, row: anchorRow });
        setSelectedId(pending.placementId);
      }
      setPending(null);
      setPlaceError(null);
    },
    [binder, dispatch, pending],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (e.key === 'Escape') {
        setPending(null);
        setSelectedId(null);
        setLibraryOpen(false);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        dispatch({ type: 'removePlacement', id: selectedId });
        setSelectedId(null);
      }
      if (e.key === 'ArrowLeft') setSpreadIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setSpreadIndex((i) => Math.min(total - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, selectedId, total]);

  if (!binder) return null;

  const heldItem = pending?.kind === 'place' ? binder.library.find((i) => i.id === pending.itemId) : undefined;
  const movingItem =
    pending?.kind === 'move'
      ? binder.library.find((i) => i.id === binder.placements.find((p) => p.id === pending.placementId)?.itemId)
      : undefined;
  const filled = binder.placements.filter((p) => p.page === activePage).length;

  const shown = pages.filter((p): p is number => p !== null);
  const pageLabel =
    shown.length > 1
      ? `Pages ${shown[0] + 1}\u2013${shown[shown.length - 1] + 1} of ${binder.pageCount}`
      : `Page ${(shown[0] ?? 0) + 1} of ${binder.pageCount}`;

  const pager = (
    <div className="pager">
      <button
        type="button"
        className="btn btn-quiet btn-icon"
        disabled={index === 0}
        onClick={() => setSpreadIndex(index - 1)}
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className="pager-label num">{pageLabel}</span>
      <button
        type="button"
        className="btn btn-quiet btn-icon"
        disabled={index >= total - 1}
        onClick={() => setSpreadIndex(index + 1)}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );

  return (
    <div className="app" data-placing={pending ? 'true' : 'false'}>
      <TopBar
        mode={preferredMode}
        onModeChange={setPreferredMode}
        showModes={wide}
        visiblePages={pages}
        activePage={activePage}
        onPrint={() => setPrinting(true)}
      />

      <div className="workspace">
        {wide ? (
          <LibraryPanel
            open
            heldItemId={heldItem?.id ?? null}
            allowDrag={canDrag}
            currentPage={activePage}
            onHold={hold}
            onClose={() => undefined}
          />
        ) : null}

        <main className="viewer">
          <div className="viewer-bar">
            {pager}
            <span className="pocket-count num">
              {filled} of {binder.cols * binder.rows} pockets filled
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => dispatch({ type: 'addPage', at: activePage + 1 })}
            >
              Add page
            </button>
          </div>

          <div className="canvas" ref={canvasRef} onClick={() => setSelectedId(null)}>
            <div
              className={`spread ${mode === 'spread' ? 'is-spread' : ''}`}
              style={spreadWidth ? { width: spreadWidth.width, gap: spreadWidth.gap } : { visibility: 'hidden' }}
            >
              {pages.map((page, i) => (
                <PageView
                  key={`${page}-${i}`}
                  page={page}
                  caption={mode === 'spread' ? (page === null ? 'Cover' : `Page ${page + 1}`) : ''}
                  selectedId={selectedId}
                  pending={pending}
                  allowDrag={canDrag}
                  hint={i === 0 && page !== null && binder.placements.length === 0}
                  onSelect={setSelectedId}
                  onPocket={onPocket}
                />
              ))}
            </div>
          </div>
        </main>
      </div>

      {!wide && (
        <nav className="tabbar">
          {pager}
          <button type="button" className="btn" onClick={() => setLibraryOpen((v) => !v)} aria-expanded={libraryOpen}>
            Library
          </button>
        </nav>
      )}

      {!wide && (
        <>
          {libraryOpen && (
            <button className="scrim" type="button" aria-label="Close library" onClick={() => setLibraryOpen(false)} />
          )}
          <LibraryPanel
            open={libraryOpen}
            heldItemId={heldItem?.id ?? null}
            allowDrag={canDrag}
            currentPage={activePage}
            onHold={hold}
            onClose={() => setLibraryOpen(false)}
          />
        </>
      )}

      {pending && (
        <div className={`placing ${placeError ? 'is-error' : ''}`}>
          <p>
            {placeError ? (
              placeError
            ) : (
              <>
                Tap a pocket for <b>{(heldItem ?? movingItem)?.name ?? 'this item'}</b>
              </>
            )}
          </p>
          <button type="button" className="btn btn-sm btn-quiet" onClick={clearPending}>
            Cancel
          </button>
        </div>
      )}

      {printing && <PrintDialog onClose={() => setPrinting(false)} />}

      {selected && !pending && (
        <Inspector
          placement={selected}
          onClose={() => setSelectedId(null)}
          onStartMove={() =>
            setPending({
              kind: 'move',
              placementId: selected.id,
              spanCols: selected.spanCols,
              spanRows: selected.spanRows,
            })
          }
        />
      )}
    </div>
  );
}

export default function App() {
  const { binder } = useBinderCtx();
  return binder ? <Workspace /> : <BinderSetup />;
}
