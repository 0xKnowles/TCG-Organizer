import { useRef, useState } from 'react';
import type { Placement } from '../types';
import { useBinder } from '../store';
import { PAGE_GAP, PAGE_PAD, canDrop, pageAspect } from '../lib/geometry';
import { endDrag, peekDrag, readDrag, startDrag } from '../lib/dnd';
import { useImageUrl } from '../lib/useImage';
import { clamp } from '../lib/util';

export type Pending =
  | { kind: 'place'; itemId: string; spanCols: number; spanRows: number }
  | { kind: 'move'; placementId: string; spanCols: number; spanRows: number }
  | null;

function Card({
  placement,
  selected,
  draggable,
  onActivate,
}: {
  placement: Placement;
  selected: boolean;
  draggable: boolean;
  onActivate: (col: number, row: number) => void;
}) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);
  const spans = placement.spanCols * placement.spanRows;

  return (
    <button
      type="button"
      className={`card ${selected ? 'sel' : ''}`}
      style={{
        gridColumn: `${placement.col + 1} / span ${placement.spanCols}`,
        gridRow: `${placement.row + 1} / span ${placement.spanRows}`,
      }}
      draggable={draggable}
      onDragStart={(e) => {
        // No state updates here: a re-render during dragstart cancels the drag.
        const box = e.currentTarget.getBoundingClientRect();
        startDrag(e, {
          source: 'placement',
          placementId: placement.id,
          kind: placement.kind,
          spanCols: placement.spanCols,
          spanRows: placement.spanRows,
          grabCol: clamp(
            Math.floor(((e.clientX - box.left) / box.width) * placement.spanCols),
            0,
            placement.spanCols - 1,
          ),
          grabRow: clamp(
            Math.floor(((e.clientY - box.top) / box.height) * placement.spanRows),
            0,
            placement.spanRows - 1,
          ),
        });
      }}
      onDragEnd={endDrag}
      onClick={(e) => {
        e.stopPropagation();
        onActivate(placement.col, placement.row);
      }}
      aria-label={item?.name ?? 'Card'}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            objectFit: placement.fit,
            objectPosition: `${placement.focusX}% ${placement.focusY}%`,
            transform: placement.rotation ? `rotate(${placement.rotation}deg)` : undefined,
          }}
        />
      ) : (
        <span className="card-missing">{item?.name ?? 'Image missing'}</span>
      )}
      {spans > 1 && (
        <span className="seams" aria-hidden>
          {Array.from({ length: spans }, (_, i) => (
            <i key={i} style={{ width: `${100 / placement.spanCols}%`, height: `${100 / placement.spanRows}%` }} />
          ))}
        </span>
      )}
    </button>
  );
}

export default function PageView({
  page,
  caption,
  selectedId,
  pending,
  allowDrag,
  hint,
  onSelect,
  onPocket,
}: {
  page: number | null;
  caption: string;
  hint: boolean;
  selectedId: string | null;
  pending: Pending;
  allowDrag: boolean;
  onSelect: (id: string | null) => void;
  onPocket: (page: number, col: number, row: number) => void;
}) {
  const { binder, dispatch } = useBinder();
  const gridRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{
    col: number;
    row: number;
    spanCols: number;
    spanRows: number;
    ok: boolean;
  } | null>(null);

  const placements = page === null ? [] : binder.placements.filter((p) => p.page === page);

  function cellFrom(e: React.DragEvent) {
    const el = gridRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      col: clamp(Math.floor(((e.clientX - box.left) / box.width) * binder.cols), 0, binder.cols - 1),
      row: clamp(Math.floor(((e.clientY - box.top) / box.height) * binder.rows), 0, binder.rows - 1),
    };
  }

  function anchorFor(
    cell: { col: number; row: number },
    spanCols: number,
    spanRows: number,
    grab: { col: number; row: number },
  ) {
    return {
      col: clamp(cell.col - grab.col, 0, Math.max(0, binder.cols - spanCols)),
      row: clamp(cell.row - grab.row, 0, Math.max(0, binder.rows - spanRows)),
    };
  }

  function activate(col: number, row: number) {
    if (page === null) return;
    onPocket(page, col, row);
  }

  return (
    <section className={`page ${page === null ? 'blank' : ''}`}>
      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${binder.cols}, 1fr)`,
          gridTemplateRows: `repeat(${binder.rows}, 1fr)`,
          aspectRatio: `${pageAspect(binder.cols, binder.rows)}`,
          gap: `${PAGE_GAP * 100}cqw`,
          padding: `${PAGE_PAD * 100}cqw`,
        }}
        onDragOver={(e) => {
          if (page === null) return;
          const payload = peekDrag();
          if (!payload) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const cell = cellFrom(e);
          if (!cell) return;
          const grab =
            payload.source === 'placement' ? { col: payload.grabCol, row: payload.grabRow } : { col: 0, row: 0 };
          const { col, row } = anchorFor(cell, payload.spanCols, payload.spanRows, grab);
          const except = payload.source === 'placement' ? payload.placementId : undefined;
          setGhost({
            col,
            row,
            spanCols: payload.spanCols,
            spanRows: payload.spanRows,
            ok: canDrop(binder, { page, col, row, spanCols: payload.spanCols, spanRows: payload.spanRows }, except),
          });
        }}
        onDragLeave={(e) => {
          if (!gridRef.current?.contains(e.relatedTarget as Node)) setGhost(null);
        }}
        onDrop={(e) => {
          if (page === null) return;
          e.preventDefault();
          const payload = readDrag(e);
          setGhost(null);
          endDrag();
          const cell = payload && cellFrom(e);
          if (!payload || !cell) return;
          const grab =
            payload.source === 'placement' ? { col: payload.grabCol, row: payload.grabRow } : { col: 0, row: 0 };
          const { col, row } = anchorFor(cell, payload.spanCols, payload.spanRows, grab);
          if (payload.source === 'library') {
            dispatch({ type: 'place', itemId: payload.itemId, page, col, row });
          } else {
            dispatch({ type: 'movePlacement', id: payload.placementId, page, col, row });
            onSelect(payload.placementId);
          }
        }}
      >
        {page !== null &&
          Array.from({ length: binder.cols * binder.rows }, (_, i) => {
            const col = i % binder.cols;
            const row = Math.floor(i / binder.cols);
            return (
              <button
                key={i}
                type="button"
                className="pocket"
                style={{ gridColumn: col + 1, gridRow: row + 1 }}
                tabIndex={pending ? 0 : -1}
                aria-label={`Pocket ${col + 1}, ${row + 1}`}
                onClick={() => (pending ? activate(col, row) : onSelect(null))}
              />
            );
          })}

        {placements.map((p) => (
          <Card
            key={p.id}
            placement={p}
            selected={p.id === selectedId}
            draggable={allowDrag}
            onActivate={(col, row) => (pending ? activate(col, row) : onSelect(p.id))}
          />
        ))}

        {ghost && (
          <div
            className={`ghost ${ghost.ok ? 'ok' : 'no'}`}
            style={{
              gridColumn: `${ghost.col + 1} / span ${ghost.spanCols}`,
              gridRow: `${ghost.row + 1} / span ${ghost.spanRows}`,
            }}
            aria-hidden
          />
        )}

        {hint && !pending && (
          <div className="canvas-empty" aria-hidden>
            <p>
              {allowDrag ? 'Drag a card here, or tap a pocket after picking one' : 'Pick a card, then tap a pocket'}
            </p>
          </div>
        )}
      </div>
      <p className="page-cap">{caption}</p>
    </section>
  );
}
