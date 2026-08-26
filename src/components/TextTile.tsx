import { useEffect, useMemo, useState } from 'react';
import type { ArtItem, LibraryItem, TextSpec } from '../types';
import { useBinder } from '../store';
import { physical } from '../lib/pockets';
import { putBlob } from '../lib/idb';
import { uid } from '../lib/util';
import { dataUrlToBlob } from '../lib/artGen';
import { DEFAULT_TEXT, FONTS, renderText } from '../lib/textArt';

const SPANS: { label: string; spanCols: number; spanRows: number }[] = [
  { label: '1 pocket', spanCols: 1, spanRows: 1 },
  { label: '2 wide', spanCols: 2, spanRows: 1 },
  { label: '2 tall', spanCols: 1, spanRows: 2 },
  { label: 'A row', spanCols: 3, spanRows: 1 },
];

const SWATCHES = ['#16161a', '#f4f4f2', '#b4241f', '#12304a', '#1d5c46', '#c9a227', '#5b2d82', ''];

/**
 * Words in a pocket: a set name, a line title, a divider label. Rendered to a
 * picture at print resolution so everything downstream — placing, exporting,
 * printing to size — treats it as ordinary art.
 */
export default function TextTile({ editing, onDone }: { editing?: ArtItem; onDone: () => void }) {
  const { binder, dispatch } = useBinder();
  const [spec, setSpec] = useState<TextSpec>(editing?.text ?? DEFAULT_TEXT);
  const [span, setSpan] = useState(() => ({
    spanCols: editing?.spanCols ?? 2,
    spanRows: editing?.spanRows ?? 1,
  }));
  const [error, setError] = useState<string | null>(null);

  const { card, pocketGap } = physical(binder);
  const aspect =
    (span.spanCols * card.w + (span.spanCols - 1) * pocketGap) /
    (span.spanRows * card.h + (span.spanRows - 1) * pocketGap);

  const patch = (next: Partial<TextSpec>) => setSpec((s) => ({ ...s, ...next }));

  // Re-rendered on every keystroke: it is a canvas draw, not a network call.
  const preview = useMemo(() => {
    if (!spec.text.trim()) return null;
    try {
      return renderText(spec, aspect);
    } catch {
      return null;
    }
  }, [spec, aspect]);

  useEffect(() => setError(null), [spec, span]);

  async function save() {
    if (!preview) return;
    try {
      const key = uid('img');
      await putBlob(key, await dataUrlToBlob(preview));
      const name = spec.text.trim().split('\n')[0].slice(0, 40) || 'Text';
      if (editing) {
        dispatch({
          type: 'updateItem',
          id: editing.id,
          patch: { name, text: spec, image: { type: 'local', key }, ...span },
        });
      } else {
        const item: LibraryItem = {
          id: uid('art'),
          kind: 'art',
          origin: 'text',
          name,
          text: spec,
          image: { type: 'local', key },
          ...span,
        };
        dispatch({ type: 'addItems', items: [item] });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That would not save.');
    }
  }

  return (
    <>
      <label className="field">
        <span>Words</span>
        <textarea
          className="csv-text"
          rows={3}
          value={spec.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder={'Twilight Masquerade\nor a line name, a year, a divider'}
        />
      </label>

      <div className="opt">
        <span className="sect">Size</span>
        <div className="seg wrap" role="group" aria-label="Size">
          {SPANS.map((choice) => (
            <button
              key={choice.label}
              type="button"
              aria-pressed={span.spanCols === choice.spanCols && span.spanRows === choice.spanRows}
              onClick={() => setSpan({ spanCols: choice.spanCols, spanRows: choice.spanRows })}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="opt">
        <span className="sect">Type</span>
        <div className="seg wrap" role="group" aria-label="Font">
          {FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              aria-pressed={spec.fontId === font.id}
              onClick={() => patch({ fontId: font.id })}
              style={{ fontFamily: font.stack }}
            >
              {font.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Weight">
          <button type="button" aria-pressed={spec.weight === 400} onClick={() => patch({ weight: 400 })}>
            Regular
          </button>
          <button type="button" aria-pressed={spec.weight === 700} onClick={() => patch({ weight: 700 })}>
            Bold
          </button>
        </div>
        <div className="seg" role="group" aria-label="Alignment">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button key={align} type="button" aria-pressed={spec.align === align} onClick={() => patch({ align })}>
              {align === 'center' ? 'Centre' : align === 'left' ? 'Left' : 'Right'}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Turn">
          {([0, 90, 270] as const).map((rotate) => (
            <button key={rotate} type="button" aria-pressed={spec.rotate === rotate} onClick={() => patch({ rotate })}>
              {rotate === 0 ? 'Across' : rotate === 90 ? 'Turn ↻' : 'Turn ↺'}
            </button>
          ))}
        </div>
      </div>

      <div className="opt">
        <span className="sect">Ink</span>
        <div className="swatch-row" role="group" aria-label="Text colour">
          {SWATCHES.filter(Boolean).map((colour) => (
            <button
              key={colour}
              type="button"
              className="swatch"
              aria-label={`Text ${colour}`}
              aria-pressed={spec.colour === colour}
              style={{ background: colour }}
              onClick={() => patch({ colour })}
            />
          ))}
        </div>
        <span className="sect">Paper</span>
        <div className="swatch-row" role="group" aria-label="Background colour">
          {SWATCHES.map((colour) => (
            <button
              key={colour || 'none'}
              type="button"
              className={colour ? 'swatch' : 'swatch swatch-none'}
              aria-label={colour ? `Background ${colour}` : 'No background'}
              aria-pressed={spec.background === colour}
              style={colour ? { background: colour } : undefined}
              onClick={() => patch({ background: colour })}
            />
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={spec.rule} onChange={(e) => patch({ rule: e.target.checked })} />
          Hairline border
        </label>
        <label className="field">
          <span>Margin {spec.padding}%</span>
          <input
            type="range"
            min={2}
            max={30}
            value={spec.padding}
            onChange={(e) => patch({ padding: Number(e.target.value) })}
          />
        </label>
      </div>

      {preview ? (
        <div className="gen-preview">
          <img className="text-preview" src={preview} alt="" style={{ aspectRatio: `${aspect}` }} />
          <div className="add-row">
            <button type="button" className="btn btn-primary" onClick={save}>
              {editing ? 'Save changes' : 'Add to library'}
            </button>
          </div>
        </div>
      ) : (
        <p className="note">Type something and it appears here, sized to the pockets you picked.</p>
      )}
      {error && <p className="warn">{error}</p>}
      <p className="note fineprint">
        Rendered at just over 300 dpi for the size you chose, so it prints as crisply as the rest of the sheet. No
        background means bare paper.
      </p>
    </>
  );
}
