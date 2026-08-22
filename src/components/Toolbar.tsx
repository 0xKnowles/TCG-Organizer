import { useRef, useState } from 'react';
import { useBinderCtx, useBinder } from '../store';
import { exportBinder, importBinder } from '../lib/transfer';
import { renderPagesToPng } from '../lib/exportImage';
import { download, slugify } from '../lib/util';

export type ViewMode = 'single' | 'spread';

export default function Toolbar({
  mode,
  onModeChange,
  visiblePages,
  zoom,
  onZoomChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  visiblePages: (number | null)[];
  zoom: number;
  onZoomChange: (zoom: number) => void;
}) {
  const { binder, dispatch } = useBinder();
  const { loadBinder, closeBinder } = useBinderCtx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showLayout, setShowLayout] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveJson() {
    setBusy('json');
    try {
      download(await exportBinder(binder), `${slugify(binder.name)}.binder.json`);
    } finally {
      setBusy(null);
    }
  }

  async function savePng() {
    setBusy('png');
    setError(null);
    try {
      const blob = await renderPagesToPng(binder, visiblePages);
      const pageNames = visiblePages.filter((p): p is number => p !== null).map((p) => p + 1);
      download(blob, `${slugify(binder.name)}-page-${pageNames.join('-')}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PNG export failed');
    } finally {
      setBusy(null);
    }
  }

  async function onImport(file: File) {
    try {
      loadBinder(await importBinder(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  const outOfGrid = (cols: number, rows: number) =>
    binder.placements.filter((p) => p.col + p.spanCols > cols || p.row + p.spanRows > rows).length;

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo" aria-hidden>
          ◲
        </span>
        <input
          className="binder-name"
          value={binder.name}
          onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
          aria-label="Binder name"
        />
      </div>

      <div className="toolbar-group">
        <button type="button" className="ghost" onClick={() => setShowLayout((v) => !v)} aria-expanded={showLayout}>
          {binder.cols} × {binder.rows} pockets
        </button>
        {showLayout && (
          <div className="popover" onMouseLeave={() => setShowLayout(false)}>
            <p className="hint">Changing the grid returns anything that no longer fits to your library.</p>
            <div className="row">
              <label>
                Columns
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={binder.cols}
                  onChange={(e) => dispatch({ type: 'setLayout', cols: Number(e.target.value) || 1, rows: binder.rows })}
                />
              </label>
              <label>
                Rows
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={binder.rows}
                  onChange={(e) => dispatch({ type: 'setLayout', cols: binder.cols, rows: Number(e.target.value) || 1 })}
                />
              </label>
            </div>
            {outOfGrid(binder.cols, binder.rows) > 0 && (
              <p className="error">{outOfGrid(binder.cols, binder.rows)} placed item(s) no longer fit.</p>
            )}
            <label className="toggle">
              <input
                type="checkbox"
                checked={binder.firstPageAlone}
                onChange={(e) => dispatch({ type: 'setFirstPageAlone', value: e.target.checked })}
              />
              Page 1 sits alone (like a real binder cover)
            </label>
          </div>
        )}

        <div className="segmented">
          <button type="button" className={mode === 'single' ? 'is-active' : ''} onClick={() => onModeChange('single')}>
            Page
          </button>
          <button type="button" className={mode === 'spread' ? 'is-active' : ''} onClick={() => onModeChange('spread')}>
            Spread
          </button>
        </div>

        <label className="zoom">
          Zoom
          <input type="range" min={50} max={140} value={zoom} onChange={(e) => onZoomChange(Number(e.target.value))} />
        </label>
      </div>

      <div className="toolbar-group right">
        <button type="button" className="ghost" onClick={savePng} disabled={busy === 'png'}>
          {busy === 'png' ? 'Rendering…' : 'Export PNG'}
        </button>
        <button type="button" className="ghost" onClick={saveJson} disabled={busy === 'json'}>
          Save file
        </button>
        <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
          Open
        </button>
        <button
          type="button"
          className="ghost danger"
          onClick={() => {
            if (confirm('Start a new binder? The current one is only kept if you saved it to a file.')) closeBinder();
          }}
        >
          New
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="toolbar-error">{error}</p>}
    </header>
  );
}
