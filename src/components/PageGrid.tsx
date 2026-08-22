import { useRef, useState } from 'react';
import type { Placement } from '../types';
import { useBinder } from '../store';
import { CARD_ASPECT, canDrop } from '../lib/geometry';
import { endDrag, peekDrag, readDrag, startDrag } from '../lib/dnd';
import { useImageUrl } from '../lib/useImage';
import { clamp } from '../lib/util';

interface HoverState {
  col: number;
  row: number;
  spanCols: number;
  spanRows: number;
  valid: boolean;
}

function PlacedItem({
  placement,
  selected,
  onSelect,
}: {
  placement: Placement;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { binder, dispatch } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);

  const style: React.CSSProperties = {
    gridColumn: `${placement.col + 1} / span ${placement.spanCols}`,
    gridRow: `${placement.row + 1} / span ${placement.spanRows}`,
  };

  const imgStyle: React.CSSProperties = {
    objectFit: placement.fit,
    objectPosition: `${placement.focusX}% ${placement.focusY}%`,
    transform: placement.rotation ? `rotate(${placement.rotation}deg)` : undefined,
  };

  return (
    <div
      className={`placed ${placement.kind === 'art' ? 'is-art' : ''} ${selected ? 'is-selected' : ''}`}
      style={style}
      draggable
      onDragStart={(e) => {
        // Note: no state updates here — a re-render mid-dragstart makes
        // Chromium abandon the drag.
        // Remember which slot inside the footprint was grabbed, so a wide piece
        // of art keeps its position under the cursor while it moves.
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const grabCol = clamp(Math.floor(((e.clientX - box.left) / box.width) * placement.spanCols), 0, placement.spanCols - 1);
        const grabRow = clamp(Math.floor(((e.clientY - box.top) / box.height) * placement.spanRows), 0, placement.spanRows - 1);
        startDrag(e, {
          source: 'placement',
          placementId: placement.id,
          kind: placement.kind,
          spanCols: placement.spanCols,
          spanRows: placement.spanRows,
          grabCol,
          grabRow,
        });
      }}
      onDragEnd={endDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(placement.id);
      }}
      title={item?.name}
    >
      {url ? (
        <img src={url} alt={item?.name ?? ''} style={imgStyle} draggable={false} />
      ) : (
        <div className="placed-missing">{item?.name ?? 'Missing image'}</div>
      )}
      {placement.kind === 'art' && placement.spanCols * placement.spanRows > 1 && (
        <div className="slot-seams" aria-hidden>
          {Array.from({ length: placement.spanCols * placement.spanRows }, (_, i) => (
            <span key={i} style={{ width: `${100 / placement.spanCols}%`, height: `${100 / placement.spanRows}%` }} />
          ))}
        </div>
      )}
      <button
        type="button"
        className="remove"
        title="Take out of the binder"
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'removePlacement', id: placement.id });
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function PageGrid({
  page,
  label,
  selectedId,
  onSelect,
}: {
  page: number | null;
  label: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { binder, dispatch } = useBinder();
  const gridRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const placements = page === null ? [] : binder.placements.filter((p) => p.page === page);

  function cellFromEvent(e: React.DragEvent): { col: number; row: number } | null {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const col = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * binder.cols), 0, binder.cols - 1);
    const row = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * binder.rows), 0, binder.rows - 1);
    return { col, row };
  }

  function onDragOver(e: React.DragEvent) {
    if (page === null) return;
    const payload = peekDrag();
    if (!payload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { spanCols, spanRows } = payload;
    const grabCol = payload.source === 'placement' ? payload.grabCol : 0;
    const grabRow = payload.source === 'placement' ? payload.grabRow : 0;
    // Anchor on the grabbed slot, then keep the footprint inside the page.
    const col = clamp(cell.col - grabCol, 0, Math.max(0, binder.cols - spanCols));
    const row = clamp(cell.row - grabRow, 0, Math.max(0, binder.rows - spanRows));
    const exceptId = payload.source === 'placement' ? payload.placementId : undefined;
    const valid = canDrop(binder, { page, col, row, spanCols, spanRows }, exceptId);
    setHover({ col, row, spanCols, spanRows, valid });
  }

  function onDrop(e: React.DragEvent) {
    if (page === null) return;
    e.preventDefault();
    const payload = readDrag(e);
    setHover(null);
    endDrag();
    if (!payload) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const grabCol = payload.source === 'placement' ? payload.grabCol : 0;
    const grabRow = payload.source === 'placement' ? payload.grabRow : 0;
    const col = clamp(cell.col - grabCol, 0, Math.max(0, binder.cols - payload.spanCols));
    const row = clamp(cell.row - grabRow, 0, Math.max(0, binder.rows - payload.spanRows));
    if (payload.source === 'library') {
      dispatch({ type: 'place', itemId: payload.itemId, page, col, row });
    } else {
      dispatch({ type: 'movePlacement', id: payload.placementId, page, col, row });
      onSelect(payload.placementId);
    }
  }

  return (
    <section className={`page ${page === null ? 'is-blank' : ''}`}>
      <div
        ref={gridRef}
        className="page-grid"
        style={{
          gridTemplateColumns: `repeat(${binder.cols}, 1fr)`,
          gridTemplateRows: `repeat(${binder.rows}, 1fr)`,
          aspectRatio: `${binder.cols * CARD_ASPECT} / ${binder.rows}`,
        }}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!gridRef.current?.contains(e.relatedTarget as Node)) setHover(null);
        }}
        onDrop={onDrop}
        onClick={() => onSelect(null)}
      >
        {page !== null &&
          Array.from({ length: binder.cols * binder.rows }, (_, i) => (
            <div
              key={i}
              className="slot"
              style={{ gridColumn: (i % binder.cols) + 1, gridRow: Math.floor(i / binder.cols) + 1 }}
            />
          ))}

        {placements.map((p) => (
          <PlacedItem key={p.id} placement={p} selected={p.id === selectedId} onSelect={onSelect} />
        ))}

        {hover && (
          <div
            className={`drop-hint ${hover.valid ? 'is-valid' : 'is-invalid'}`}
            style={{
              gridColumn: `${hover.col + 1} / span ${hover.spanCols}`,
              gridRow: `${hover.row + 1} / span ${hover.spanRows}`,
            }}
            aria-hidden
          />
        )}
      </div>
      <footer className="page-label">{label}</footer>
    </section>
  );
}
