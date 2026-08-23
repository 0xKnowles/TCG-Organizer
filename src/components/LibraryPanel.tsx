import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtItem, CardItem, LibraryItem } from '../types';
import { useBinder } from '../store';
import { lookupCards, searchCards } from '../lib/api';
import { type ColumnMap, type Field, guessColumns, looksLikeHeader, parseCsv, readRows } from '../lib/csv';
import { putBlob } from '../lib/idb';
import { normalizeImage, uid } from '../lib/util';
import { startDrag, endDrag } from '../lib/dnd';
import { useImageUrl } from '../lib/useImage';

const API_KEY_STORAGE = 'binder-studio:pokemontcg-key';
const SPANS = [
  { c: 2, r: 1, label: '2 wide' },
  { c: 1, r: 2, label: '2 tall' },
  { c: 2, r: 2, label: '2 × 2' },
  { c: 3, r: 1, label: '3 wide' },
];

function Thumb({ item, className }: { item: LibraryItem; className: string }) {
  const url = useImageUrl(item.image);
  return url ? (
    <img className={className} src={url} alt="" loading="lazy" draggable={false} />
  ) : (
    <span className={className} />
  );
}

function subtitle(item: LibraryItem): string {
  const base =
    item.kind === 'art'
      ? `Art · ${item.spanCols}×${item.spanRows}`
      : [item.setName, item.number && `No. ${item.number}`].filter(Boolean).join(' · ') || 'Card';
  return item.owned === false ? `${base} · needed` : base;
}

/* --------------------------------- csv ---------------------------------- */

function CsvImport({ onDone }: { onDone: () => void }) {
  const { dispatch } = useBinder();
  const [text, setText] = useState('');
  const [map, setMap] = useState<ColumnMap>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [lookUp, setLookUp] = useState(true);
  const [asNeeded, setAsNeeded] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const grid = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);

  function load(next: string) {
    setText(next);
    setError(null);
    const rows = parseCsv(next);
    if (!rows.length) return;
    const header = looksLikeHeader(rows[0]);
    setHasHeader(header);
    setMap(header ? guessColumns(rows[0]) : { name: 0 });
  }

  const rows = useMemo(() => (grid.length ? readRows(grid, map, hasHeader) : []), [grid, map, hasHeader]);
  const headings = grid.length ? grid[0].map((h, i) => (hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}`)) : [];

  async function run() {
    if (!rows.length) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    try {
      let matches: (CardItem | undefined)[] = [];
      if (lookUp) {
        setProgress('Looking up cards…');
        matches = await lookupCards(rows, {
          apiKey: localStorage.getItem(API_KEY_STORAGE) ?? undefined,
          signal: controller.signal,
          onProgress: (done, total) => setProgress(`Looking up ${done} of ${total} names…`),
        });
      }
      const items: LibraryItem[] = rows.map((row, i) => {
        const found = matches[i];
        return {
          id: uid('card'),
          kind: 'card',
          origin: 'csv',
          name: found?.name ?? row.name,
          setName: found?.setName ?? row.setName,
          number: found?.number ?? row.number,
          image: found?.image,
          quantity: row.quantity,
          owned: asNeeded ? false : row.quantity === 0 ? false : undefined,
        } satisfies CardItem;
      });
      dispatch({ type: 'addItems', items });
      setProgress(null);
      onDone();
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Import failed.');
      setProgress(null);
    }
  }

  return (
    <>
      <div className="add-row">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Choose CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) load(await file.text());
            e.target.value = '';
          }}
        />
      </div>
      <textarea
        className="csv-text"
        value={text}
        onChange={(e) => load(e.target.value)}
        placeholder={'…or paste rows here\nQuantity,Name,Set,Card Number\n1,Lapras,Jungle,25'}
        rows={4}
      />

      {grid.length > 0 && (
        <>
          <label className="check">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            First row is a header
          </label>
          <div className="csv-map">
            {(['name', 'set', 'number', 'quantity'] as Field[]).map((field) => (
              <label key={field} className="field inline">
                <span>{field === 'set' ? 'Set' : field[0].toUpperCase() + field.slice(1)}</span>
                <select
                  value={map[field] ?? -1}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setMap({ ...map, [field]: value < 0 ? undefined : value });
                  }}
                >
                  <option value={-1}>—</option>
                  {headings.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={lookUp} onChange={(e) => setLookUp(e.target.checked)} />
            Find images on pokemontcg.io
          </label>
          <label className="check">
            <input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} />
            This is a want list (mark every card as needed)
          </label>
          <p className="note">
            {rows.length} {rows.length === 1 ? 'card' : 'cards'} ready
            {rows[0] ? ` · first: ${rows[0].name}` : ''}
          </p>
        </>
      )}

      {progress && <p className="note">{progress}</p>}
      {error && <p className="warn">{error}</p>}
      <div>
        <button type="button" className="btn btn-primary" disabled={!rows.length || !!progress} onClick={run}>
          Import {rows.length || ''}
        </button>
      </div>
    </>
  );
}

/* --------------------------------- add ---------------------------------- */

type Source = 'search' | 'upload' | 'link' | 'csv';

function AddView({ onDone, allowDrag }: { onDone: () => void; allowDrag: boolean }) {
  const { dispatch } = useBinder();
  const [source, setSource] = useState<Source>('search');
  const [asArt, setAsArt] = useState(false);
  const [span, setSpan] = useState({ c: 2, r: 1 });
  const [query, setQuery] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? '');
  const [results, setResults] = useState<CardItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
    else localStorage.removeItem(API_KEY_STORAGE);
  }, [apiKey]);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setMessage('');
    try {
      const cards = await searchCards(query, {
        apiKey: apiKey || undefined,
        signal: controller.signal,
      });
      setResults(cards);
      setMessage(cards.length ? '' : 'No matches.');
    } catch (err) {
      if (!controller.signal.aborted) setMessage(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      if (!controller.signal.aborted) setStatus('idle');
    }
  }

  async function addFiles(files: FileList | File[]) {
    const items: LibraryItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const key = uid('img');
      await putBlob(key, await normalizeImage(file));
      const label = file.name.replace(/\.[^.]+$/, '');
      items.push(
        asArt
          ? {
              id: uid('art'),
              kind: 'art',
              origin: 'upload',
              name: label,
              image: { type: 'local', key },
              spanCols: span.c,
              spanRows: span.r,
            }
          : {
              id: uid('card'),
              kind: 'card',
              origin: 'upload',
              name: label,
              image: { type: 'local', key },
            },
      );
    }
    if (items.length) {
      dispatch({ type: 'addItems', items });
      onDone();
    }
  }

  function addLink() {
    const href = url.trim();
    if (!href) return;
    const label = name.trim() || (asArt ? 'Art' : 'Card');
    const item: LibraryItem = asArt
      ? ({
          id: uid('art'),
          kind: 'art',
          origin: 'link',
          name: label,
          image: { type: 'remote', url: href },
          spanCols: span.c,
          spanRows: span.r,
        } satisfies ArtItem)
      : ({
          id: uid('card'),
          kind: 'card',
          origin: 'link',
          name: label,
          image: { type: 'remote', url: href },
        } satisfies CardItem);
    dispatch({ type: 'addItems', items: [item] });
    setName('');
    setUrl('');
    onDone();
  }

  const typeToggle = (
    <div className="seg">
      <button type="button" aria-pressed={!asArt} onClick={() => setAsArt(false)}>
        Cards
      </button>
      <button type="button" aria-pressed={asArt} onClick={() => setAsArt(true)}>
        Art
      </button>
    </div>
  );

  return (
    <>
      <div className="library-head">
        <button type="button" className="btn btn-quiet btn-icon" onClick={onDone} aria-label="Back to library">
          ←
        </button>
        <strong style={{ flex: 1, fontSize: 14 }}>Add to library</strong>
      </div>

      <div className="library-sub">
        <div className="seg">
          <button type="button" aria-pressed={source === 'search'} onClick={() => setSource('search')}>
            Search
          </button>
          <button type="button" aria-pressed={source === 'upload'} onClick={() => setSource('upload')}>
            Upload
          </button>
          <button type="button" aria-pressed={source === 'link'} onClick={() => setSource('link')}>
            Link
          </button>
          <button type="button" aria-pressed={source === 'csv'} onClick={() => setSource('csv')}>
            CSV
          </button>
        </div>
      </div>

      <div
        className="add"
        style={{
          borderTop: 0,
          flex: '1 1 auto',
          alignContent: 'start',
          overflow: 'auto',
        }}
      >
        {source === 'search' && (
          <>
            <form className="add-row" onSubmit={runSearch}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Card name or number" />
              <button className="btn" type="submit" disabled={status === 'loading'}>
                {status === 'loading' ? '…' : 'Search'}
              </button>
            </form>
            {message && <p className="note">{message}</p>}
            {results.length > 0 && (
              <div className="results">
                {results.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="result"
                    title={`${card.name}${card.setName ? ` · ${card.setName}` : ''}`}
                    onClick={() =>
                      dispatch({
                        type: 'addItems',
                        items: [{ ...card, id: uid('card') }],
                      })
                    }
                  >
                    <Thumb item={card} className="" />
                  </button>
                ))}
              </div>
            )}
            <label className="field">
              <span>API key (optional, raises the rate limit)</span>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="pokemontcg.io key" />
            </label>
            <p className="note">Card data from pokemontcg.io.</p>
          </>
        )}

        {source === 'csv' && <CsvImport onDone={onDone} />}

        {(source === 'upload' || source === 'link') && (
          <div className="insp-line">
            <span className="sect">Type</span>
            {typeToggle}
          </div>
        )}

        {(source === 'upload' || source === 'link') && asArt && (
          <div className="spans">
            {SPANS.map((s) => (
              <button
                key={s.label}
                type="button"
                className="span-btn"
                aria-pressed={span.c === s.c && span.r === s.r}
                onClick={() => setSpan({ c: s.c, r: s.r })}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {source === 'upload' && (
          <>
            <button
              type="button"
              className={`drop ${over ? 'over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
              }}
            >
              <b style={{ fontWeight: 500 }}>Choose images</b>
              <small>{allowDrag ? 'or drop files here' : 'photos, scans, fan art'}</small>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}

        {source === 'link' && (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lugia mural" />
            </label>
            <label className="field">
              <span>Image URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </label>
            <div>
              <button className="btn btn-primary" type="button" onClick={addLink}>
                Add
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------- browse --------------------------------- */

export default function LibraryPanel({
  open,
  heldItemId,
  allowDrag,
  onHold,
  onClose,
}: {
  open: boolean;
  heldItemId: string | null;
  allowDrag: boolean;
  onHold: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const { binder, dispatch } = useBinder();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const [scope, setScope] = useState<'all' | 'unplaced' | 'needed'>('all');

  const placed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of binder.placements) counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
    return counts;
  }, [binder.placements]);

  const needed = binder.library.filter((i) => i.owned === false).length;

  const items = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return binder.library.filter((i) => {
      if (scope === 'unplaced' && placed.get(i.id)) return false;
      if (scope === 'needed' && i.owned !== false) return false;
      if (!needle) return true;
      return (
        i.name.toLowerCase().includes(needle) || (i.kind === 'card' && (i.setName ?? '').toLowerCase().includes(needle))
      );
    });
  }, [binder.library, filter, scope, placed]);

  return (
    <div className="library" data-open={open}>
      <button className="grabber" type="button" onClick={onClose} aria-label="Close library">
        <i />
      </button>

      {adding ? (
        <AddView onDone={() => setAdding(false)} allowDrag={allowDrag} />
      ) : (
        <>
          <div className="library-head">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Search ${binder.library.length} items`}
            />
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              Add
            </button>
          </div>

          <div className="library-sub">
            <div className="seg">
              {(['all', 'unplaced', 'needed'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
                  {s === 'all' ? 'All' : s === 'unplaced' ? 'Unplaced' : 'Needed'}
                </button>
              ))}
            </div>
            <span className="sect count">{needed} needed</span>
          </div>

          <ul className="items">
            {items.map((item) => {
              const count = placed.get(item.id) ?? 0;
              return (
                <li key={item.id} className="item-row">
                  <button
                    type="button"
                    className="item"
                    aria-pressed={heldItemId === item.id}
                    draggable={allowDrag}
                    onDragStart={(e) =>
                      startDrag(e, {
                        source: 'library',
                        itemId: item.id,
                        kind: item.kind,
                        spanCols: item.kind === 'art' ? item.spanCols : 1,
                        spanRows: item.kind === 'art' ? item.spanRows : 1,
                      })
                    }
                    onDragEnd={endDrag}
                    onClick={() => onHold(item)}
                  >
                    <Thumb item={item} className="item-thumb" />
                    <span className="item-text">
                      <b>{item.name}</b>
                      <span>{subtitle(item)}</span>
                    </span>
                    <span className="item-tag">{count > 0 ? `×${count}` : ''}</span>
                  </button>
                  <button
                    type="button"
                    className="item-x"
                    aria-label={`Remove ${item.name} from library`}
                    onClick={() => dispatch({ type: 'removeItem', id: item.id })}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {!items.length && (
              <li className="empty">
                {binder.library.length
                  ? 'Nothing matches that filter.'
                  : 'No cards yet. Use Add to search or upload images.'}
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
