import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBinder } from '../store';
import { blobUrl } from '../lib/idb';
import {
  CARD_SIZES,
  DEFAULT_PRINT_OPTIONS,
  PAPERS,
  buildTiles,
  chunk,
  cutGuides,
  dpiGrade,
  sheetLayout,
  type Natural,
  type PrintOptions,
  type PrintTile,
} from '../lib/print';

const OPTIONS_STORAGE = 'binder-studio:print-options';

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

function Tile({
  tile,
  url,
  card,
  labels,
  index,
}: {
  tile: PrintTile;
  url?: string;
  card: { w: number; h: number };
  labels: boolean;
  index: number;
}) {
  return (
    <div className="tile-wrap">
      <div className="tile" style={{ width: `${card.w}mm`, height: `${card.h}mm` }}>
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
          {index}. {tile.label}
        </span>
      )}
    </div>
  );
}

/** Dashed cut lines drawn over a sheet, in millimetre user units. */
function CutLayer({
  layout,
  options,
  tiles,
  stroke,
}: {
  layout: ReturnType<typeof sheetLayout>;
  options: PrintOptions;
  tiles: number;
  stroke: number;
}) {
  return (
    <svg
      className="cut-layer"
      width={`${layout.pageW}mm`}
      height={`${layout.pageH}mm`}
      viewBox={`0 0 ${layout.pageW} ${layout.pageH}`}
      aria-hidden
    >
      {cutGuides(layout, options, tiles).map((line, i) => (
        <line key={i} {...line} strokeWidth={stroke} strokeDasharray="2 1.5" />
      ))}
    </svg>
  );
}

export default function PrintDialog({ onClose }: { onClose: () => void }) {
  const { binder } = useBinder();
  const [options, setOptions] = useState<PrintOptions>(loadOptions);
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Default to what you actually have to print: your own images and art.
    const placed = new Set(binder.placements.map((p) => p.itemId));
    return new Set(binder.library.filter((i) => placed.has(i.id) && (i.origin ?? 'upload') !== 'api').map((i) => i.id));
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
      .map((i) => ({ item: i, pieces: counts.get(i.id) ?? 0 }));
  }, [binder.library, binder.placements]);

  const selectedIds = useMemo(
    () => placedItems.filter(({ item }) => selected.has(item.id)).map(({ item }) => item.id),
    [placedItems, selected],
  );
  const { naturals, loading } = useNaturals(selectedIds);

  const layout = useMemo(() => sheetLayout(options), [options]);
  const tiles = useMemo(
    () => buildTiles(binder, new Set(selectedIds), naturals, options),
    [binder, selectedIds, naturals, options],
  );
  const sheets = useMemo(() => chunk(tiles, layout.perSheet), [tiles, layout.perSheet]);

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

  // Rendered outside the app so printing can hide the app entirely.
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
                  aria-pressed={options.card.w === c.w && options.card.h === c.h}
                  onClick={() => setOptions({ ...options, card: { w: c.w, h: c.h } })}
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
                  value={options.card.w}
                  onChange={(e) =>
                    setOptions({ ...options, card: { ...options.card, w: Number(e.target.value) || 63 } })
                  }
                />
              </label>
              <label className="field inline">
                <span>Height mm</span>
                <input
                  type="number"
                  step={0.5}
                  min={20}
                  max={160}
                  value={options.card.h}
                  onChange={(e) =>
                    setOptions({ ...options, card: { ...options.card, h: Number(e.target.value) || 88 } })
                  }
                />
              </label>
            </div>
          </div>

          <div className="opt">
            <span className="sect">Pocket divider</span>
            <div className="insp-line">
              <label className="field inline">
                <span>Gap mm</span>
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  max={12}
                  value={options.pocketGap}
                  onChange={(e) => setOptions({ ...options, pocketGap: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            </div>
            <p className="note">
              Measure the black strip between two pockets. Art that spans pockets is laid out across the whole span and
              the strips hidden behind a divider are dropped, so lines stay straight across the seam. Set 0 to slice the
              image into equal pieces instead.
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
              {placedItems.map(({ item, pieces }) => {
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
                          {pieces} {pieces === 1 ? 'piece' : 'pieces'}
                          {item.origin === 'api' ? ' · from search' : ''}
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
            {sheets.length === 1 ? 'sheet' : 'sheets'} · {layout.cols} × {layout.rows} per sheet
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
            {sheets.map((sheetTiles, sheetIndex) => (
              <div
                key={sheetIndex}
                className="sheet"
                style={{ width: `${layout.pageW}mm`, height: `${layout.pageH}mm` }}
              >
                <div className="sheet-inner" style={{ padding: `${layout.marginY}mm ${layout.marginX}mm` }}>
                  <div
                    className="sheet-grid"
                    style={{
                      gridTemplateColumns: `repeat(${layout.cols}, ${options.card.w}mm)`,
                      gap: `${layout.gap}mm`,
                    }}
                  >
                    {sheetTiles.map((tile, i) => (
                      <Tile
                        key={tile.id}
                        tile={tile}
                        url={naturals.get(tile.itemId)?.url}
                        card={options.card}
                        labels={options.labels}
                        index={sheetIndex * layout.perSheet + i + 1}
                      />
                    ))}
                  </div>
                  <div className="sheet-foot" style={{ height: `${layout.footer}mm` }}>
                    <span>
                      {binder.name} · sheet {sheetIndex + 1} of {sheets.length} · {options.card.w} × {options.card.h} mm
                    </span>
                    <span className="ruler" aria-hidden>
                      <i />
                      <em>50 mm</em>
                    </span>
                  </div>
                </div>
                {options.cutLines && (
                  <CutLayer layout={layout} options={options} tiles={sheetTiles.length} stroke={strokeMm} />
                )}
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
