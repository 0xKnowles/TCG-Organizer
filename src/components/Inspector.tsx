import type { Placement } from '../types';
import { useBinder } from '../store';
import { canDrop, firstFreeSlot, layoutPlacement } from '../lib/geometry';
import { printMetrics } from '../lib/pockets';
import { useImageUrl } from '../lib/useImage';

export default function Inspector({
  placement,
  onClose,
  onStartMove,
}: {
  placement: Placement;
  onClose: () => void;
  onStartMove: () => void;
}) {
  const { binder, dispatch } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);

  function resize(spanCols: number, spanRows: number) {
    dispatch({ type: 'updatePlacement', id: placement.id, patch: { spanCols, spanRows } });
    if (item?.kind === 'art') dispatch({ type: 'updateItem', id: item.id, patch: { spanCols, spanRows } });
  }

  const fits = (dc: number, dr: number) =>
    canDrop(
      binder,
      {
        page: placement.page,
        col: placement.col,
        row: placement.row,
        spanCols: placement.spanCols + dc,
        spanRows: placement.spanRows + dr,
      },
      placement.id,
    );

  /** Same pocket on the target page when it is free, otherwise the first free one. */
  function toPage(page: number) {
    if (page < 0 || page >= binder.pageCount) return;
    const same = {
      page,
      col: placement.col,
      row: placement.row,
      spanCols: placement.spanCols,
      spanRows: placement.spanRows,
    };
    if (canDrop(binder, same, placement.id)) {
      dispatch({ type: 'movePlacement', id: placement.id, page, col: placement.col, row: placement.row });
      return;
    }
    const spot = firstFreeSlot(binder, page, placement.spanCols, placement.spanRows);
    if (spot) dispatch({ type: 'movePlacement', id: placement.id, page, col: spot.col, row: spot.row });
  }

  // How this footprint turns into paper: one piece per pocket, unless the
  // pockets have facing openings, and never across the spine.
  const laid = layoutPlacement(binder, placement, printMetrics(binder));
  const printNote = [
    `${laid.pieces.length} ${laid.pieces.length === 1 ? 'piece' : 'pieces'} to print`,
    laid.hasUncutPair ? 'facing pockets stay whole' : null,
    laid.crossesSpine ? 'crosses the spine' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="inspector" role="dialog" aria-label="Placement settings" onClick={(e) => e.stopPropagation()}>
      <div className="insp-head">
        {url && <img src={url} alt="" />}
        <div>
          <b>{item?.name ?? 'Item'}</b>
          <span className="num">
            Page {placement.page + 1} · column {placement.col + 1}, row {placement.row + 1}
          </span>
        </div>
        <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="insp-body">
        <div className="insp-line">
          <span className="sect">Size</span>
          <div className="stepper">
            <button
              type="button"
              disabled={placement.spanCols <= 1}
              onClick={() => resize(placement.spanCols - 1, placement.spanRows)}
              aria-label="Narrower"
            >
              −
            </button>
            <span>{placement.spanCols} wide</span>
            <button
              type="button"
              disabled={!fits(1, 0)}
              onClick={() => resize(placement.spanCols + 1, placement.spanRows)}
              aria-label="Wider"
            >
              +
            </button>
          </div>
          <div className="stepper">
            <button
              type="button"
              disabled={placement.spanRows <= 1}
              onClick={() => resize(placement.spanCols, placement.spanRows - 1)}
              aria-label="Shorter"
            >
              −
            </button>
            <span>{placement.spanRows} tall</span>
            <button
              type="button"
              disabled={!fits(0, 1)}
              onClick={() => resize(placement.spanCols, placement.spanRows + 1)}
              aria-label="Taller"
            >
              +
            </button>
          </div>
          <span className="note">{printNote}</span>
        </div>

        <div className="insp-line">
          <span className="sect">Place</span>
          <div className="stepper">
            <button
              type="button"
              disabled={placement.page === 0}
              onClick={() => toPage(placement.page - 1)}
              aria-label="Previous page"
            >
              −
            </button>
            <span>Page {placement.page + 1}</span>
            <button
              type="button"
              disabled={placement.page >= binder.pageCount - 1}
              onClick={() => toPage(placement.page + 1)}
              aria-label="Next page"
            >
              +
            </button>
          </div>
          <button type="button" className="btn btn-sm" onClick={onStartMove}>
            Move to pocket
          </button>
        </div>

        <div className="insp-line">
          <span className="sect">Image</span>
          <div className="seg">
            <button
              type="button"
              aria-pressed={placement.fit === 'cover'}
              onClick={() => dispatch({ type: 'updatePlacement', id: placement.id, patch: { fit: 'cover' } })}
            >
              Fill
            </button>
            <button
              type="button"
              aria-pressed={placement.fit === 'contain'}
              onClick={() => dispatch({ type: 'updatePlacement', id: placement.id, patch: { fit: 'contain' } })}
            >
              Fit
            </button>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              dispatch({
                type: 'updatePlacement',
                id: placement.id,
                patch: { rotation: ((placement.rotation + 90) % 360) as Placement['rotation'] },
              })
            }
          >
            Rotate
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            style={{ marginLeft: 'auto' }}
            onClick={() => dispatch({ type: 'removePlacement', id: placement.id })}
          >
            Remove
          </button>
        </div>

        {placement.fit === 'cover' && placement.spanCols * placement.spanRows > 1 && (
          <div className="insp-line">
            <span className="sect">Pan</span>
            <label className="slider">
              X
              <input
                type="range"
                min={0}
                max={100}
                value={placement.focusX}
                onChange={(e) =>
                  dispatch({ type: 'updatePlacement', id: placement.id, patch: { focusX: Number(e.target.value) } })
                }
              />
            </label>
            <label className="slider">
              Y
              <input
                type="range"
                min={0}
                max={100}
                value={placement.focusY}
                onChange={(e) =>
                  dispatch({ type: 'updatePlacement', id: placement.id, patch: { focusY: Number(e.target.value) } })
                }
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
