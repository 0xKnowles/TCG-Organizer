import { useMemo, useRef, useState } from 'react';
import type { Placement } from '../types';
import { useBinder } from '../store';
import { anchorAt, canDrop, layoutPlacement, pageStyle, placementsOnPage, screenMetrics } from '../lib/geometry';
import type { Piece } from '../lib/pockets';
import { endDrag, peekDrag, readDrag, startDrag } from '../lib/dnd';
import { useImageUrl } from '../lib/useImage';
import { clamp } from '../lib/util';

export type Pending =
  | { kind: 'place'; itemId: string; spanCols: number; spanRows: number }
  | { kind: 'move'; placementId: string; spanCols: number; spanRows: number }
  | null;

/** One piece of a placement: the part of the image that fills these pockets. */
function CardPiece({
  placement,
  piece,
  box,
  selected,
  draggable,
  onActivate,
}: {
  placement: Placement;
  piece: Piece;
  box: { w: number; h: number };
  selected: boolean;
  draggable: boolean;
  /** Reports the pocket that was tapped, in page coordinates. */
  onActivate: (col: number, row: number) => void;
}) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);
  const ghost = item?.owned === false;
  const pockets = piece.spanCols * piece.spanRows;

  // Where this piece sits inside the placement, counted in pockets.
  const offsetCol = piece.page === placement.page ? piece.col - placement.col : binder.cols - placement.col + piece.col;
  const offsetRow = piece.row - placement.row;

  function pocketUnder(e: React.MouseEvent | React.DragEvent) {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const local = {
      col: clamp(Math.floor(((e.clientX - b.left) / b.width) * piece.spanCols), 0, piece.spanCols - 1),
      row: clamp(Math.floor(((e.clientY - b.top) / b.height) * piece.spanRows), 0, piece.spanRows - 1),
    };
    return {
      page: { col: piece.col + local.col, row: piece.row + local.row },
      // Which pocket of the placement was grabbed, so a drag keeps its position.
      grab: { col: offsetCol + local.col, row: offsetRow + local.row },
    };
  }

  return (
    <button
      type="button"
      className={`card ${selected ? 'sel' : ''} ${ghost ? 'ghost' : ''}`}
      data-placement={placement.id}
      style={{
        gridColumn: `${piece.col + 1} / span ${piece.spanCols}`,
        gridRow: `${piece.row + 1} / span ${piece.spanRows}`,
      }}
      draggable={draggable}
      onDragStart={(e) => {
        // No state updates here: a re-render during dragstart cancels the drag.
        const { grab } = pocketUnder(e);
        startDrag(e, {
          source: 'placement',
          placementId: placement.id,
          kind: placement.kind,
          spanCols: placement.spanCols,
          spanRows: placement.spanRows,
          grabCol: grab.col,
          grabRow: grab.row,
        });
      }}
      onDragEnd={endDrag}
      onClick={(e) => {
        e.stopPropagation();
        const { page: pocket } = pocketUnder(e);
        onActivate(pocket.col, pocket.row);
      }}
      aria-label={item?.name ?? 'Card'}
    >
      {url ? (
        <span
          className="art"
          style={{
            left: `${(-piece.x / piece.w) * 100}%`,
            top: `${(-piece.y / piece.h) * 100}%`,
            width: `${(box.w / piece.w) * 100}%`,
            height: `${(box.h / piece.h) * 100}%`,
          }}
        >
          <img
            src={url}
            alt=""
            style={{
              objectFit: placement.fit,
              objectPosition: `${placement.focusX}% ${placement.focusY}%`,
              transform: placement.rotation ? `rotate(${placement.rotation}deg)` : undefined,
            }}
          />
        </span>
      ) : (
        <span className="card-missing">{item?.name ?? 'Image missing'}</span>
      )}
      {pockets > 1 && (
        <span className="seams" aria-hidden>
          {Array.from({ length: pockets }, (_, i) => (
            <i key={i} style={{ width: `${100 / piece.spanCols}%`, height: `${100 / piece.spanRows}%` }} />
          ))}
        </span>
      )}
      {ghost && <span className="ghost-tag">need</span>}
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
  selectedId: string | null;
  pending: Pending;
  allowDrag: boolean;
  hint: boolean;
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

  const style = pageStyle(binder);
  const metrics = screenMetrics(binder);

  // Everything showing on this page, including art running in across the spine.
  const drawn = useMemo(() => {
    if (page === null) return [];
    return placementsOnPage(binder, page).flatMap((placement) => {
      const laid = layoutPlacement(binder, placement, metrics);
      return laid.pieces
        .filter((piece) => piece.page === page)
        .map((piece) => ({ placement, piece, box: { w: laid.boxW, h: laid.boxH } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binder, page]);

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
    if (page === null) return { col: 0, row: 0 };
    return anchorAt(binder, page, cell, { spanCols, spanRows }, grab);
  }

  return (
    <section className={`page ${page === null ? 'blank' : ''}`}>
      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${binder.cols}, 1fr)`,
          gridTemplateRows: `repeat(${binder.rows}, 1fr)`,
          aspectRatio: `${style.aspect}`,
          gap: `${style.gap * 100}cqw`,
          padding: `${style.pad * 100}cqw`,
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
            spanCols: Math.min(payload.spanCols, binder.cols - col),
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
                onClick={(e) => {
                  // Stop here: the canvas clears the selection on click, which
                  // would immediately deselect what we just placed or moved.
                  e.stopPropagation();
                  if (pending) onPocket(page, col, row);
                  else onSelect(null);
                }}
              />
            );
          })}

        {drawn.map(({ placement, piece, box }) => (
          <CardPiece
            key={`${placement.id}-${piece.col}-${piece.row}`}
            placement={placement}
            piece={piece}
            box={box}
            selected={placement.id === selectedId}
            draggable={allowDrag}
            onActivate={(col, row) => {
              if (pending && page !== null) onPocket(page, col, row);
              else onSelect(placement.id);
            }}
          />
        ))}

        {ghost && (
          <div
            className={`ghost-drop ${ghost.ok ? 'ok' : 'no'}`}
            style={{
              gridColumn: `${ghost.col + 1} / span ${Math.max(1, ghost.spanCols)}`,
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
      {caption && <p className="page-cap">{caption}</p>}
    </section>
  );
}
