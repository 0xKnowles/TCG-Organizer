import { useEffect, useMemo, useRef, useState } from 'react';
import BinderSetup from './components/BinderSetup';
import Library from './components/Library';
import PageGrid from './components/PageGrid';
import Inspector from './components/Inspector';
import Toolbar, { type ViewMode } from './components/Toolbar';
import { useBinderCtx } from './store';
import { CARD_ASPECT, spreadCount, spreadPages } from './lib/geometry';
import { clamp } from './lib/util';

function Workspace() {
  const { binder, dispatch } = useBinderCtx();
  const [mode, setMode] = useState<ViewMode>('spread');
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  const total = binder ? spreadCount(binder, mode) : 0;
  const index = clamp(spreadIndex, 0, Math.max(0, total - 1));
  const pages = useMemo(
    () => (binder ? spreadPages(binder, index, mode) : []),
    [binder, index, mode],
  );
  const activePage = pages.find((p): p is number => p !== null) ?? 0;

  const selected = binder?.placements.find((p) => p.id === selectedId) ?? null;

  // A binder page is sized from the height available on screen: measure the
  // stage, then hand the spread an explicit width so the grid never overflows.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewport((prev) => (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spreadWidth = useMemo(() => {
    if (!binder || !viewport.width || !viewport.height) return undefined;
    const LABEL = 26; // page caption under each grid
    const GAP = 18;
    const FRAME = 30; // padding of the page frame
    const pageAspect = (binder.cols * CARD_ASPECT) / binder.rows;
    const gridHeight = Math.max(80, viewport.height - LABEL - FRAME);
    const count = pages.length;
    const byHeight = gridHeight * pageAspect * count + GAP * (count - 1) + FRAME;
    const scale = Math.min(1, (viewport.width - 4) / byHeight) * (zoom / 100);
    return byHeight * scale;
  }, [binder, viewport, pages.length, zoom]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        dispatch({ type: 'removePlacement', id: selectedId });
        setSelectedId(null);
      }
      if (e.key === 'ArrowLeft') setSpreadIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setSpreadIndex((i) => Math.min(total - 1, i + 1));
      if (e.key === 'Escape') setSelectedId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, selectedId, total]);

  if (!binder) return null;

  const placedOnPage = binder.placements.filter((p) => p.page === activePage).length;
  const capacity = binder.cols * binder.rows;

  return (
    <div className={`app ${selected ? 'has-inspector' : ''}`}>
      <Toolbar mode={mode} onModeChange={setMode} visiblePages={pages} zoom={zoom} onZoomChange={setZoom} />

      <div className="body">
        <Library currentPage={activePage} />

        <main className="stage" onClick={() => setSelectedId(null)}>
          <div className="page-bar">
            <div className="nav">
              <button type="button" className="ghost" onClick={() => setSpreadIndex(Math.max(0, index - 1))} disabled={index === 0}>
                ←
              </button>
              <span className="page-count">
                {mode === 'spread' ? 'Spread' : 'Page'} {index + 1} / {total}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => setSpreadIndex(Math.min(total - 1, index + 1))}
                disabled={index >= total - 1}
              >
                →
              </button>
            </div>

            <div className="page-tools">
              <span className="fill-count">
                Page {activePage + 1}: {placedOnPage} placed · {capacity} pockets
              </span>
              <button type="button" className="ghost" onClick={() => dispatch({ type: 'autoFill', page: activePage })}>
                Auto-fill
              </button>
              <button type="button" className="ghost" onClick={() => dispatch({ type: 'clearPage', page: activePage })}>
                Clear page
              </button>
              <button type="button" className="ghost" onClick={() => dispatch({ type: 'addPage', at: activePage + 1 })}>
                Add page
              </button>
              <button
                type="button"
                className="ghost danger"
                disabled={binder.pageCount <= 1}
                onClick={() => dispatch({ type: 'removePage', index: activePage })}
              >
                Delete page
              </button>
            </div>
          </div>

          <div className="stage-viewport" ref={viewportRef}>
            <div className={`spread is-${mode}`} style={spreadWidth ? { width: `${spreadWidth}px` } : { visibility: 'hidden' }}>
              {pages.map((page, i) => (
                <PageGrid
                  key={`${page}-${i}`}
                  page={page}
                  label={page === null ? 'Inside cover' : `Page ${page + 1}`}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          </div>

          <p className="stage-hint">
            Drag cards and art from the library into any pocket · drag placed items to rearrange · click one to
            resize or pan it.
          </p>
        </main>
      </div>

      {selected && <Inspector placement={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

export default function App() {
  const { binder } = useBinderCtx();
  return binder ? <Workspace /> : <BinderSetup />;
}
