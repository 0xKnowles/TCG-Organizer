import { useRef, useState } from 'react';
import { useBinderCtx } from '../store';
import { importBinder } from '../lib/transfer';
import { CARD_ASPECT } from '../lib/geometry';

const PRESETS = [
  { cols: 2, rows: 2, label: '2 × 2', note: '4 per page — mini / toploader binders' },
  { cols: 3, rows: 3, label: '3 × 3', note: '9 per page — the classic' },
  { cols: 4, rows: 3, label: '4 × 3', note: '12 per page — wide portfolio' },
  { cols: 4, rows: 4, label: '4 × 4', note: '16 per page — collector binders' },
];

function GridPreview({ cols, rows }: { cols: number; rows: number }) {
  return (
    <div
      className="grid-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        aspectRatio: `${cols * CARD_ASPECT} / ${rows}`,
      }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export default function BinderSetup() {
  const { createBinder, loadBinder } = useBinderCtx();
  const [name, setName] = useState('My Binder');
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onImport(file: File) {
    try {
      loadBinder(await importBinder(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <header className="setup-head">
          <h1>Binder Studio</h1>
          <p>
            Plan a Pokémon TCG binder page by page — drop cards into exact pockets and stretch fan art
            across two or more slots.
          </p>
        </header>

        <label className="field">
          <span>Binder name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Water Types, Master Set…" />
        </label>

        <div className="field">
          <span>Pocket layout</span>
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`preset ${cols === p.cols && rows === p.rows ? 'is-active' : ''}`}
                onClick={() => {
                  setCols(p.cols);
                  setRows(p.rows);
                }}
              >
                <GridPreview cols={p.cols} rows={p.rows} />
                <strong>{p.label}</strong>
                <small>{p.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field custom-size">
          <span>Custom size</span>
          <div className="row">
            <label>
              Columns
              <input
                type="number"
                min={1}
                max={8}
                value={cols}
                onChange={(e) => setCols(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              Rows
              <input
                type="number"
                min={1}
                max={8}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              />
            </label>
            <p className="hint">
              {cols} × {rows} = <strong>{cols * rows}</strong> cards per page
            </p>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="setup-actions">
          <button className="primary" type="button" onClick={() => createBinder(cols, rows, name.trim() || 'My Binder')}>
            Start building
          </button>
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            Open a saved binder…
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
      </div>
    </div>
  );
}
