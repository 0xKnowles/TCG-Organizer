import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PocketOpenings } from '../types';
import { useBinder } from '../store';
import { blobUrl } from '../lib/idb';
import { physical } from '../lib/pockets';
import {
  CARD_SIZES,
  DEFAULT_PRINT_OPTIONS,
  PAPERS,
  buildTiles,
  cutGuides,
  dpiGrade,
  packSheets,
  sheetLayout,
  type Natural,
  type PlacedTile,
  type PrintOptions,
  type Sheet,
  type SheetLayout,
} from '../lib/print';

const OPTIONS_STORAGE = 'binder-studio:print-options';

const OPENING_MODES: { id: PocketOpenings; label: string; hint: string }[] = [
  {
    id: 'uniform',
    label: 'All the same way',
    hint: 'Every pocket loads from the same edge. Each pocket takes its own piece.',
  },
  {
    id: 'rows',
    label: 'Rows face',
    hint: 'Rows 1&2, 3&4 open towards each other, so a two-pocket tall piece slides in whole.',
  },
  {
    id: 'columns',
    label: 'Columns face',
    hint: 'Columns 1&2, 3&4 open towards each other, so a two-pocket wide piece slides in whole.',
  },
];

function loadOptions(): PrintOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_STORAGE);
    if (raw) return { ...DEFAULT_PRINT_OPTIONS, ...(JSON.parse(raw) as Partial<PrintOptions>) };
  } catch {
    /* fall back to the defaults */
  }
  return DEFAULT_PRINT_OPTIONS;
}

/** Resolve each item to a URL plus its pixel size, which the slicing maths needs. */
function useNaturals(itemIds: string[]) {
  const { binder } = useBinder();
  const [naturals, setNaturals] = useState<Map<string, Natural>>(new Map());
  const [loading, setLoading] = useState(false);
  const key = itemIds.join(',');

  useEffect(() => {
    let alive = true;
    const ids = key ? key.split(',') : [];
    if (!ids.length) {
      setNaturals(new Map());
      return;
    }
    setLoading(true);
    (async () => {
      const next = new Map<string, Natural>();
      for (const id of ids) {
        const item = binder.library.find((i) => i.id === id);
        if (!item?.image) continue;
        const url = item.image.type === 'remote' ? item.image.url : await blobUrl(item.image.key);
        if (!url) continue;
        const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = url;
        });
        if (size) next.set(id, { url, ...size });
      }
      if (alive) {
        setNaturals(next);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, binder.library]);

  return { naturals, loading };
}

function CutLayer({ sheet, layout, stroke }: { sheet: Sheet; layout: SheetLayout; stroke: number }) {
  return (
    <svg
      className="cut-layer"
      width={`${layout.pageW}mm`}
      height={`${layout.pageH}mm`}
      viewBox={`0 0 ${layout.pageW} ${layout.pageH}`}
      aria-hidden
    >
      {cutGuides(sheet, layout).map((line, i) => (
        <line key={i} {...line} strokeWidth={stroke} strokeDasharray="2 1.5" />
      ))}
    </svg>
  );
}

function Tile({ placed, url, labels }: { placed: PlacedTile; url?: string; labels: boolean }) {
  const { tile } = placed;
  return (
    <div className="tile-wrap" style={{ left: `${placed.x}mm`, top: `${placed.y}mm` }}>
      <div className="tile" style={{ width: `${tile.w}mm`, height: `${tile.h}mm` }}>
        {url && (
          <img
            src={url}
            alt=""
            style={{
              left: `${tile.left}mm`,
              top: `${tile.top}mm`,
              width: `${tile.width}mm`,
              height: `${tile.height}mm`,
              transform: tile.rotation ? `rotate(${tile.rotation}deg)` : undefined,
              transformOrigin: `${tile.originX}mm ${tile.originY}mm`,
            }}
          />
        )}
      </div>
      {labels && (
        <span className="tile-label">
          {placed.index}. {tile.label}
          {tile.uncut ? ' · do not cut' : ''}
        </span>
      )}
    </div>
  );
}

export default function PrintDialog({ onClose }: { onClose: () => void }) {
  const { binder, dispatch } = useBinder();
  const phys = physical(binder);
  const [options, setOptions] = useState<PrintOptions>(loadOptions);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Default to what you actually have to print: your own images and art.
    const placed = new Set(binder.placements.map((p) => p.itemId));
    return new Set(
      binder.library
        .filter((i) => placed.has(i.id) && (i.origin ?? 'upload') !== 'api' && i.owned !== false)
        .map((i) => i.id),
    );
  });
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    localStorage.setItem(OPTIONS_STORAGE, JSON.stringify(options));
  }, [options]);

  const placedItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of binder.placements) {
      counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + p.spanCols * p.spanRows);
    }
    return binder.library
      .filter((i) => counts.has(i.id) && i.image)
      .map((i) => ({ item: i, pockets: counts.get(i.id) ?? 0 }));
  }, [binder.library, binder.placements]);

  const selectedIds = useMemo(
    () => placedItems.filter(({ item }) => selected.has(item.id)).map(({ item }) => item.id),
    [placedItems, selected],
  );
  const { naturals, loading } = useNaturals(selectedIds);

  const layout = useMemo(() => sheetLayout(binder, options), [binder, options]);
  const tiles = useMemo(() => buildTiles(binder, new Set(selectedIds), naturals), [binder, selectedIds, naturals]);
  const sheets = useMemo(() => packSheets(tiles, layout), [tiles, layout]);
  const uncutCount = tiles.filter((t) => t.uncut).length;

  // Fit a sheet to the preview column; printing ignores this transform.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const mmToPx = 96 / 25.4;
      const { width, height } = entry.contentRect;
      setScale(Math.min(1, (width - 8) / (layout.pageW * mmToPx), (height - 8) / (layout.pageH * mmToPx)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.pageW, layout.pageH]);

  // 0.25 mm on paper, but never thinner than a screen pixel in the scaled preview.
  const strokeMm = Math.max(0.25, 1 / (scale * (96 / 25.4)));
  const worst = tiles.reduce((min, t) => Math.min(min, t.dpi), Infinity);
  const paper = PAPERS.find((p) => p.id === options.paperId) ?? PAPERS[0];
  const setPhysical = (patch: Parameters<typeof dispatch>[0] extends never ? never : Partial<typeof phys>) =>
    dispatch({ type: 'setPhysical', patch });

  return createPortal(
    <div className="print-dialog" role="dialog" aria-label="Print sheets">
      <style>{`@page { size: ${paper.id === 'a4' ? 'A4' : 'letter'} ${options.landscape ? 'landscape' : 'portrait'}; margin: 0; }`}</style>

      <header className="print-head">
        <strong>Print sheets</strong>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" disabled={!tiles.length} onClick={() => window.print()}>
          Print
        </button>
      </header>

      <div className="print-body">
        <div className="print-options">
          <div className="opt">
            <span className="sect">Paper</span>
            <div className="seg">
              {PAPERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={options.paperId === p.id}
                  onClick={() => setOptions({ ...options, paperId: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={options.landscape}
                onChange={(e) => setOptions({ ...options, landscape: e.target.checked })}
              />
              Landscape
            </label>
          </div>

          <div className="opt">
            <span className="sect">Card size</span>
            <div className="seg">
              {CARD_SIZES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={phys.card.w === c.w && phys.card.h === c.h}
                  onClick={() => setPhysical({ card: { w: c.w, h: c.h } })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="insp-line">
              <label className="field inline">
                <span>Width mm</span>
                <input
                  type="number"
                  step={0.5}
                  min={20}
                  max={120}
                  value={phys.card.w}
                  onChange={(e) => setPhysical({ card: { ...phys.card, w: Number(e.target.value) || 63 } })}
                />
              </label>
              <label className="field inline">
                <span>Height mm</span>
                <input
                  type="number"
                  step={0.5}
                  min={20}
                  max={160}
                  value={phys.card.h}
                  onChange={(e) => setPhysical({ card: { ...phys.card, h: Number(e.target.value) || 88 } })}
                />
              </label>
            </div>
          </div>

          <div className="opt">
            <span className="sect">Pockets</span>
            <div className="seg wrap">
              {OPENING_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={phys.openings === m.id}
                  onClick={() => setPhysical({ openings: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="note">{OPENING_MODES.find((m) => m.id === phys.openings)?.hint}</p>
            <div className="insp-line">
              <label className="field inline">
                <span>Divider mm</span>
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  max={12}
                  value={phys.pocketGap}
                  onChange={(e) => setPhysical({ pocketGap: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label className="field inline">
                <span>Spine mm</span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={80}
                  value={phys.spineGap}
                  onChange={(e) => setPhysical({ spineGap: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
            <p className="note">
              Measure the strip between two pockets, and the gap across the spine when the binder lies open. Art laid
              across a divider loses the strip hidden behind it; art across facing openings stays whole.
            </p>
          </div>

          <div className="opt">
            <span className="sect">Sheet</span>
            <label className="check">
              <input
                type="checkbox"
                checked={options.cutLines}
                onChange={(e) => setOptions({ ...options, cutLines: e.target.checked })}
              />
              Cut lines
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={options.labels}
                onChange={(e) => setOptions({ ...options, labels: e.target.checked })}
              />
              Pocket labels
            </label>
          </div>

          <div className="opt">
            <span className="sect">What to print</span>
            <ul className="print-list">
              {placedItems.map(({ item, pockets }) => {
                const tileDpi = tiles.find((t) => t.itemId === item.id)?.dpi;
                return (
                  <li key={item.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                      />
                      <span className="print-item">
                        <b>{item.name}</b>
                        <small>
                          {pockets} {pockets === 1 ? 'pocket' : 'pockets'}
                          {item.origin === 'api' ? ' · from search' : ''}
                          {item.owned === false ? ' · not owned' : ''}
                          {tileDpi ? ` · ${Math.round(tileDpi)} dpi` : ''}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
              {!placedItems.length && <li className="note">Place something in the binder first.</li>}
            </ul>
          </div>

          <p className="note">
            {tiles.length} {tiles.length === 1 ? 'piece' : 'pieces'} on {sheets.length}{' '}
            {sheets.length === 1 ? 'sheet' : 'sheets'}
            {uncutCount ? ` · ${uncutCount} slide in whole` : ''}
            {loading ? ' · measuring images' : ''}
          </p>
          {Number.isFinite(worst) && dpiGrade(worst) !== 'good' && (
            <p className="warn">
              Lowest resolution is {Math.round(worst)} dpi. Below about 180 dpi the print looks soft at this size.
            </p>
          )}
          <p className="note">
            In the print dialog set scale to 100% (not “fit to page”) and turn margins off. The ruler on each sheet is
            there to check it.
          </p>
        </div>

        <div className="print-preview" ref={previewRef}>
          <div className="print-scale" style={{ ['--print-scale' as string]: scale }}>
            {sheets.map((sheet, sheetIndex) => (
              <div
                key={sheetIndex}
                className="sheet"
                style={{ width: `${layout.pageW}mm`, height: `${layout.pageH}mm` }}
              >
                <div className="sheet-inner">
                  {sheet.tiles.map((placed) => (
                    <Tile
                      key={placed.tile.id}
                      placed={placed}
                      url={naturals.get(placed.tile.itemId)?.url}
                      labels={options.labels}
                    />
                  ))}
                  <div
                    className="sheet-foot"
                    style={{ height: `${layout.footer}mm`, left: `${layout.marginX}mm`, right: `${layout.marginX}mm` }}
                  >
                    <span>
                      {binder.name} · sheet {sheetIndex + 1} of {sheets.length} · {phys.card.w} × {phys.card.h} mm
                      {sheet.tiles.some((t) => t.tile.uncut) ? ' · pieces marked “do not cut” slide in whole' : ''}
                    </span>
                    <span className="ruler" aria-hidden>
                      <i />
                      <em>50 mm</em>
                    </span>
                  </div>
                </div>
                {options.cutLines && <CutLayer sheet={sheet} layout={layout} stroke={strokeMm} />}
              </div>
            ))}
            {!sheets.length && <p className="note">Nothing selected to print.</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
