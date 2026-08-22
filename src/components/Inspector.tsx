import type { Placement } from '../types';
import { useBinder } from '../store';
import { canDrop, firstFreeSlot } from '../lib/geometry';
import { useImageUrl } from '../lib/useImage';

export default function Inspector({
  placement,
  onClose,
}: {
  placement: Placement;
  onClose: () => void;
}) {
  const { binder, dispatch } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);

  function resize(spanCols: number, spanRows: number) {
    dispatch({ type: 'updatePlacement', id: placement.id, patch: { spanCols, spanRows } });
    if (item?.kind === 'art') dispatch({ type: 'updateItem', id: item.id, patch: { spanCols, spanRows } });
  }

  /** Send the item to another page, keeping its pocket when that pocket is free. */
  function moveToPage(page: number) {
    if (page < 0 || page >= binder.pageCount) return;
    const here = { ...placement, page };
    if (canDrop(binder, here, placement.id)) {
      dispatch({ type: 'movePlacement', id: placement.id, page, col: placement.col, row: placement.row });
      return;
    }
    const spot = firstFreeSlot(binder, page, placement.spanCols, placement.spanRows);
    if (spot) dispatch({ type: 'movePlacement', id: placement.id, page, col: spot.col, row: spot.row });
  }

  const canGrow = (dc: number, dr: number) =>
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

  return (
    <div className="inspector" onClick={(e) => e.stopPropagation()}>
      <header>
        <div className="inspector-title">
          {url && <img src={url} alt="" />}
          <div>
            <strong>{item?.name ?? 'Unknown item'}</strong>
            <small>
              Page {placement.page + 1} · col {placement.col + 1}, row {placement.row + 1}
            </small>
          </div>
        </div>
        <button type="button" className="icon" onClick={onClose} title="Close">
          ×
        </button>
      </header>

      <div className="inspector-row">
        <span className="label">Footprint</span>
        <div className="stepper">
          <button type="button" disabled={placement.spanCols <= 1} onClick={() => resize(placement.spanCols - 1, placement.spanRows)}>
            −
          </button>
          <span>{placement.spanCols} wide</span>
          <button type="button" disabled={!canGrow(1, 0)} onClick={() => resize(placement.spanCols + 1, placement.spanRows)}>
            +
          </button>
        </div>
        <div className="stepper">
          <button type="button" disabled={placement.spanRows <= 1} onClick={() => resize(placement.spanCols, placement.spanRows - 1)}>
            −
          </button>
          <span>{placement.spanRows} tall</span>
          <button type="button" disabled={!canGrow(0, 1)} onClick={() => resize(placement.spanCols, placement.spanRows + 1)}>
            +
          </button>
        </div>
      </div>

      <div className="inspector-row">
        <span className="label">Page</span>
        <div className="stepper">
          <button type="button" disabled={placement.page === 0} onClick={() => moveToPage(placement.page - 1)}>
            −
          </button>
          <span>Page {placement.page + 1}</span>
          <button
            type="button"
            disabled={placement.page >= binder.pageCount - 1}
            onClick={() => moveToPage(placement.page + 1)}
          >
            +
          </button>
        </div>
        <p className="hint">Moves it to the same pocket on that page, or the first free one.</p>
      </div>

      <div className="inspector-row">
        <span className="label">Fit</span>
        <div className="segmented">
          {(['cover', 'contain'] as const).map((fit) => (
            <button
              key={fit}
              type="button"
              className={placement.fit === fit ? 'is-active' : ''}
              onClick={() => dispatch({ type: 'updatePlacement', id: placement.id, patch: { fit } })}
            >
              {fit === 'cover' ? 'Fill' : 'Fit whole image'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            dispatch({
              type: 'updatePlacement',
              id: placement.id,
              patch: { rotation: (((placement.rotation + 90) % 360) as Placement['rotation']) },
            })
          }
        >
          Rotate {placement.rotation}°
        </button>
      </div>

      {placement.fit === 'cover' && (
        <div className="inspector-row sliders">
          <label>
            Pan X
            <input
              type="range"
              min={0}
              max={100}
              value={placement.focusX}
              onChange={(e) => dispatch({ type: 'updatePlacement', id: placement.id, patch: { focusX: Number(e.target.value) } })}
            />
          </label>
          <label>
            Pan Y
            <input
              type="range"
              min={0}
              max={100}
              value={placement.focusY}
              onChange={(e) => dispatch({ type: 'updatePlacement', id: placement.id, patch: { focusY: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      <div className="inspector-row">
        <button type="button" className="danger" onClick={() => dispatch({ type: 'removePlacement', id: placement.id })}>
          Remove from page
        </button>
        <p className="hint">Drag it to another pocket, or press Delete.</p>
      </div>
    </div>
  );
}
