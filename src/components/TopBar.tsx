import { useEffect, useRef, useState } from 'react';
import { useBinder, useBinderCtx } from '../store';
import { exportBinder, importBinder } from '../lib/transfer';
import { renderPagesToPng } from '../lib/exportImage';
import { download, slugify } from '../lib/util';

export type ViewMode = 'single' | 'spread';

export default function TopBar({
  mode,
  onModeChange,
  showModes,
  visiblePages,
  activePage,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  showModes: boolean;
  visiblePages: (number | null)[];
  activePage: number;
}) {
  const { binder, dispatch } = useBinder();
  const { loadBinder, closeBinder } = useBinderCtx();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function savePng() {
    setBusy('png');
    setError(null);
    try {
      const blob = await renderPagesToPng(binder, visiblePages);
      const names = visiblePages.filter((p): p is number => p !== null).map((p) => p + 1);
      download(blob, `${slugify(binder.name)}-page-${names.join('-')}.png`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  async function saveJson() {
    setBusy('json');
    try {
      download(await exportBinder(binder), `${slugify(binder.name)}.binder.json`);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  async function openFile(file: File) {
    try {
      loadBinder(await importBinder(await file.text()));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that file.');
    }
  }

  return (
    <header className="topbar">
      <input
        className="title-input"
        value={binder.name}
        onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
        aria-label="Binder name"
        spellCheck={false}
      />

      <span className="spacer" />

      <div className="topbar-actions">
        {showModes && (
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === 'single'} onClick={() => onModeChange('single')}>
              Page
            </button>
            <button type="button" aria-pressed={mode === 'spread'} onClick={() => onModeChange('spread')}>
              Spread
            </button>
          </div>
        )}

        <div className="menu-wrap">
          <button
            type="button"
            className="btn btn-icon"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Binder menu"
            onClick={() => setOpen((v) => !v)}
          >
            •••
          </button>

          {open && (
            <>
              <button className="scrim" type="button" aria-label="Close menu" onClick={() => setOpen(false)} />
              <div className="menu" role="menu">
                <div className="menu-section">
                  <span className="sect">Layout</span>
                  <div className="insp-line">
                    <div className="stepper">
                      <button
                        type="button"
                        disabled={binder.cols <= 1}
                        onClick={() => dispatch({ type: 'setLayout', cols: binder.cols - 1, rows: binder.rows })}
                      >
                        −
                      </button>
                      <span>{binder.cols} cols</span>
                      <button
                        type="button"
                        disabled={binder.cols >= 8}
                        onClick={() => dispatch({ type: 'setLayout', cols: binder.cols + 1, rows: binder.rows })}
                      >
                        +
                      </button>
                    </div>
                    <div className="stepper">
                      <button
                        type="button"
                        disabled={binder.rows <= 1}
                        onClick={() => dispatch({ type: 'setLayout', cols: binder.cols, rows: binder.rows - 1 })}
                      >
                        −
                      </button>
                      <span>{binder.rows} rows</span>
                      <button
                        type="button"
                        disabled={binder.rows >= 8}
                        onClick={() => dispatch({ type: 'setLayout', cols: binder.cols, rows: binder.rows + 1 })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={binder.firstPageAlone}
                      onChange={(e) => dispatch({ type: 'setFirstPageAlone', value: e.target.checked })}
                    />
                    Page 1 on its own
                  </label>
                </div>

                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    dispatch({ type: 'addPage', at: activePage + 1 });
                    setOpen(false);
                  }}
                >
                  Insert page after {activePage + 1}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    dispatch({ type: 'autoFill', page: activePage });
                    setOpen(false);
                  }}
                >
                  Fill page with unplaced
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    dispatch({ type: 'clearPage', page: activePage });
                    setOpen(false);
                  }}
                >
                  Clear page {activePage + 1}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={binder.pageCount <= 1}
                  onClick={() => {
                    dispatch({ type: 'removePage', index: activePage });
                    setOpen(false);
                  }}
                >
                  Delete page {activePage + 1}
                </button>

                <hr />
                <button type="button" role="menuitem" onClick={savePng} disabled={busy === 'png'}>
                  Export PNG <span>{busy === 'png' ? 'working' : 'this view'}</span>
                </button>
                <button type="button" role="menuitem" onClick={saveJson} disabled={busy === 'json'}>
                  Save to file <span>.json</span>
                </button>
                <button type="button" role="menuitem" onClick={() => fileRef.current?.click()}>
                  Open file
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (confirm('Start a new binder? Save this one to a file first if you want to keep it.'))
                      closeBinder();
                  }}
                >
                  New binder
                </button>
                {error && (
                  <p className="warn" style={{ padding: '4px 9px 8px' }}>
                    {error}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
