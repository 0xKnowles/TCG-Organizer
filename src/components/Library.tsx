import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtItem, CardItem, LibraryItem } from '../types';
import { useBinder } from '../store';
import { searchCards } from '../lib/api';
import { putBlob } from '../lib/idb';
import { normalizeImage, uid } from '../lib/util';
import { startDrag, endDrag } from '../lib/dnd';
import { useImageUrl } from '../lib/useImage';
import { firstFreeSlot } from '../lib/geometry';

type Tab = 'search' | 'cards' | 'art';

const API_KEY_STORAGE = 'binder-studio:pokemontcg-key';

function Thumb({ item }: { item: LibraryItem }) {
  const url = useImageUrl(item.image);
  if (!url) return <div className="thumb thumb-empty">{item.kind === 'art' ? '🎨' : '🃏'}</div>;
  return <img className="thumb" src={url} alt="" loading="lazy" draggable={false} />;
}

function LibraryRow({
  item,
  placedCount,
  currentPage,
}: {
  item: LibraryItem;
  placedCount: number;
  currentPage: number;
}) {
  const { binder, dispatch } = useBinder();
  const span = item.kind === 'art' ? { c: item.spanCols, r: item.spanRows } : { c: 1, r: 1 };

  function quickPlace() {
    const spot = firstFreeSlot(binder, currentPage, span.c, span.r);
    if (!spot) return;
    dispatch({ type: 'place', itemId: item.id, page: currentPage, col: spot.col, row: spot.row });
  }

  return (
    <li
      className={`lib-row ${placedCount ? 'is-placed' : ''}`}
      draggable
      onDragStart={(e) =>
        startDrag(e, { source: 'library', itemId: item.id, kind: item.kind, spanCols: span.c, spanRows: span.r })
      }
      onDragEnd={endDrag}
      onDoubleClick={quickPlace}
      title="Drag onto a pocket, or double-click to drop it in the first free spot"
    >
      <Thumb item={item} />
      <div className="lib-meta">
        <strong>{item.name}</strong>
        <small>
          {item.kind === 'art' ? (
            <>
              Art · {item.spanCols}×{item.spanRows} slots
            </>
          ) : (
            [item.setName, item.number && `#${item.number}`].filter(Boolean).join(' · ') || 'Card'
          )}
        </small>
      </div>
      <div className="lib-actions">
        {placedCount > 0 && <span className="badge" title="Times placed in this binder">{placedCount}</span>}
        <button type="button" className="icon" onClick={quickPlace} title="Place on the current page">
          ＋
        </button>
        <button
          type="button"
          className="icon danger"
          onClick={() => dispatch({ type: 'removeItem', id: item.id })}
          title="Remove from library"
        >
          ×
        </button>
      </div>
    </li>
  );
}

function SearchPanel() {
  const { dispatch } = useBinder();
  const [query, setQuery] = useState('');
  const [setName, setSetName] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [showKey, setShowKey] = useState(false);
  const [results, setResults] = useState<CardItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
    else localStorage.removeItem(API_KEY_STORAGE);
  }, [apiKey]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setMessage('');
    try {
      const cards = await searchCards(query, { apiKey: apiKey || undefined, setName, signal: controller.signal });
      setResults(cards);
      setStatus('idle');
      if (!cards.length) setMessage('No cards matched.');
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Search failed');
    }
  }

  return (
    <div className="panel">
      <form onSubmit={run} className="search-form">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Card name or number…" />
        <input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Set (optional)" />
        <button className="primary" type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      <button type="button" className="link" onClick={() => setShowKey((v) => !v)}>
        {showKey ? 'Hide' : 'API key (optional)'}
      </button>
      {showKey && (
        <input
          className="api-key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="pokemontcg.io API key — raises the rate limit"
        />
      )}
      {message && <p className={status === 'error' ? 'error' : 'hint'}>{message}</p>}

      <div className="result-grid">
        {results.map((card) => (
          <button
            key={card.id}
            type="button"
            className="result"
            title={`Add ${card.name} to your library`}
            onClick={() => {
              dispatch({ type: 'addItems', items: [{ ...card, id: uid('card') }] });
            }}
          >
            <Thumb item={card} />
            <span>{card.name}</span>
            <small>{[card.setName, card.number && `#${card.number}`].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </div>
      <p className="hint fineprint">
        Card data &amp; images from pokemontcg.io. Nothing is uploaded anywhere — your binder lives in this
        browser.
      </p>
    </div>
  );
}

async function fileToItem(file: File, kind: 'card' | 'art', span: { c: number; r: number }): Promise<LibraryItem> {
  const key = uid('img');
  await putBlob(key, await normalizeImage(file));
  const name = file.name.replace(/\.[^.]+$/, '');
  if (kind === 'art') {
    return { id: uid('art'), kind: 'art', name, image: { type: 'local', key }, spanCols: span.c, spanRows: span.r };
  }
  return { id: uid('card'), kind: 'card', name, image: { type: 'local', key } };
}

function UploadPanel({ kind }: { kind: 'card' | 'art' }) {
  const { dispatch } = useBinder();
  const [spanCols, setSpanCols] = useState(2);
  const [spanRows, setSpanRows] = useState(1);
  const [manualName, setManualName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    try {
      const items: LibraryItem[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        items.push(await fileToItem(file, kind, { c: spanCols, r: spanRows }));
      }
      if (items.length) dispatch({ type: 'addItems', items });
    } finally {
      setBusy(false);
    }
  }

  function addFromUrl() {
    const url = manualUrl.trim();
    if (!url) return;
    const name = manualName.trim() || (kind === 'art' ? 'Fan art' : 'Card');
    const item: LibraryItem =
      kind === 'art'
        ? ({ id: uid('art'), kind: 'art', name, image: { type: 'remote', url }, spanCols, spanRows } satisfies ArtItem)
        : ({ id: uid('card'), kind: 'card', name, image: { type: 'remote', url } } satisfies CardItem);
    dispatch({ type: 'addItems', items: [item] });
    setManualName('');
    setManualUrl('');
  }

  return (
    <div className="panel">
      {kind === 'art' && (
        <div className="span-picker">
          <span className="label">How many pockets should it cover?</span>
          <div className="span-presets">
            {[
              { c: 2, r: 1, label: '2 wide' },
              { c: 1, r: 2, label: '2 tall' },
              { c: 2, r: 2, label: '2 × 2' },
              { c: 3, r: 1, label: '3 wide' },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chip ${spanCols === p.c && spanRows === p.r ? 'is-active' : ''}`}
                onClick={() => {
                  setSpanCols(p.c);
                  setSpanRows(p.r);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              Cols
              <input
                type="number"
                min={1}
                max={8}
                value={spanCols}
                onChange={(e) => setSpanCols(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              />
            </label>
            <label>
              Rows
              <input
                type="number"
                min={1}
                max={8}
                value={spanRows}
                onChange={(e) => setSpanRows(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
        </div>
      )}

      <div
        className={`dropzone ${dropping ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <strong>{busy ? 'Adding…' : kind === 'art' ? 'Drop fan art / photos' : 'Drop card scans'}</strong>
        <small>or click to choose files</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <details className="from-url">
        <summary>Add from an image URL</summary>
        <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Name" />
        <input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://…" />
        <button type="button" onClick={addFromUrl}>
          Add to library
        </button>
      </details>
    </div>
  );
}

export default function Library({ currentPage }: { currentPage: number }) {
  const { binder } = useBinder();
  const [tab, setTab] = useState<Tab>('search');
  const [filter, setFilter] = useState('');
  const [unplacedOnly, setUnplacedOnly] = useState(false);

  const placedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of binder.placements) counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
    return counts;
  }, [binder.placements]);

  const items = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return binder.library.filter((i) => {
      if (unplacedOnly && placedCounts.get(i.id)) return false;
      if (!needle) return true;
      return (
        i.name.toLowerCase().includes(needle) ||
        (i.kind === 'card' && (i.setName ?? '').toLowerCase().includes(needle))
      );
    });
  }, [binder.library, filter, unplacedOnly, placedCounts]);

  return (
    <aside className="library">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>
          Search
        </button>
        <button role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'is-active' : ''} onClick={() => setTab('cards')}>
          Upload cards
        </button>
        <button role="tab" aria-selected={tab === 'art'} className={tab === 'art' ? 'is-active' : ''} onClick={() => setTab('art')}>
          Fan art
        </button>
      </div>

      {tab === 'search' && <SearchPanel />}
      {tab === 'cards' && <UploadPanel kind="card" />}
      {tab === 'art' && <UploadPanel kind="art" />}

      <div className="lib-head">
        <h2>Library ({binder.library.length})</h2>
        <label className="toggle">
          <input type="checkbox" checked={unplacedOnly} onChange={(e) => setUnplacedOnly(e.target.checked)} />
          Unplaced only
        </label>
      </div>
      <input className="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter library…" />

      <ul className="lib-list">
        {items.map((item) => (
          <LibraryRow key={item.id} item={item} placedCount={placedCounts.get(item.id) ?? 0} currentPage={currentPage} />
        ))}
        {!items.length && <li className="empty">Nothing here yet — search or upload above.</li>}
      </ul>
    </aside>
  );
}
