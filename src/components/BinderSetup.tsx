import { useRef, useState } from 'react';
import { useBinderCtx } from '../store';
import { importBinder } from '../lib/transfer';

const LAYOUTS = [
  { cols: 2, rows: 2 },
  { cols: 3, rows: 3 },
  { cols: 4, rows: 3 },
  { cols: 4, rows: 4 },
];

function Mini({ cols, rows }: { cols: number; rows: number }) {
  return (
    <span className="mini" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} aria-hidden>
      {Array.from({ length: cols * rows }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

export default function BinderSetup() {
  const { createBinder, loadBinder } = useBinderCtx();
  const [name, setName] = useState('');
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function open(file: File) {
    try {
      loadBinder(await importBinder(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that file.');
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>New binder</h1>
        <p className="note">Set the pocket layout. You can change it later.</p>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My binder" />
        </label>

        <div className="field">
          <span>Layout</span>
          <div className="layouts">
            {LAYOUTS.map((l) => (
              <button
                key={`${l.cols}x${l.rows}`}
                type="button"
                className="layout"
                aria-pressed={cols === l.cols && rows === l.rows}
                onClick={() => {
                  setCols(l.cols);
                  setRows(l.rows);
                }}
              >
                <Mini cols={l.cols} rows={l.rows} />
                <b>
                  {l.cols}×{l.rows}
                </b>
              </button>
            ))}
          </div>
        </div>

        <div className="size-row">
          <label className="field">
            <span>Columns</span>
            <input
              type="number"
              min={1}
              max={8}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="field">
            <span>Rows</span>
            <input
              type="number"
              min={1}
              max={8}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            />
          </label>
          <p className="note num">{cols * rows} cards per page</p>
        </div>

        {error && (
          <p className="warn" style={{ marginTop: 14 }}>
            {error}
          </p>
        )}

        <div className="setup-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => createBinder(cols, rows, name.trim() || 'My binder')}
          >
            Create binder
          </button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            Open file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
