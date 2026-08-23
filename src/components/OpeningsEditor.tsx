import { useBinder } from '../store';
import { openingsOn, pairsLabel, physical } from '../lib/pockets';
import type { Opening } from '../types';

const arrow = (side: Opening) => (side === 'left' ? '←' : '→');

/**
 * Which edge each pocket loads from. Only the right-hand page is editable: a
 * left-hand page is the back of the same sheet, so its pattern is the mirror.
 */
export default function OpeningsEditor() {
  const { binder, dispatch } = useBinder();
  const right = physical(binder).openings;
  const left = openingsOn(binder, true);

  function toggle(index: number) {
    const next = right.map((side, i) => (i === index ? (side === 'left' ? 'right' : 'left') : side));
    dispatch({ type: 'setPhysical', patch: { pocketOpenings: next as Opening[] } });
  }

  return (
    <div className="openings">
      <div className="openings-row">
        <span className="openings-label">Right pages</span>
        <div className="openings-arrows" role="group" aria-label="Pocket openings on a right-hand page">
          {right.map((side, i) => (
            <button
              key={i}
              type="button"
              className="opening"
              onClick={() => toggle(i)}
              aria-label={`Column ${i + 1} opens on the ${side}`}
              title={`Column ${i + 1} opens on the ${side}`}
            >
              {arrow(side)}
            </button>
          ))}
        </div>
        <span className="openings-pairs num">{pairsLabel(right)}</span>
      </div>
      <div className="openings-row is-derived">
        <span className="openings-label">Left pages</span>
        <div className="openings-arrows" aria-hidden>
          {left.map((side, i) => (
            <span key={i} className="opening">
              {arrow(side)}
            </span>
          ))}
        </div>
        <span className="openings-pairs num">{pairsLabel(left)}</span>
      </div>
      <p className="note">
        An arrow points at the edge a card slides in from. Where two neighbours point at each other there is no divider
        between them, so one piece of art covers both uncut. Left-hand pages are the back of the same sheet, so they
        mirror.
      </p>
    </div>
  );
}
