import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItem, Placement } from '../types';
import { useBinder } from '../store';
import { placementsOnPage } from '../lib/geometry';
import { facingPairs, openingsOn } from '../lib/pockets';
import { isLeftPage } from '../lib/geometry';
import { putBlob } from '../lib/idb';
import { uid } from '../lib/util';
import { useImageUrl } from '../lib/useImage';
import {
  DIRECTIONS,
  FULL_CARD,
  aspectOfArt,
  buildComposite,
  cardBytes,
  composite,
  cropExtension,
  cropFromPercent,
  isHorizontal,
  type Crop,
  type Direction,
  type ExtendPlan,
} from '../lib/extend';
import { dataUrlToBlob, readPage, renderArt, type ArtBrief } from '../lib/artGen';

function CardTile({ placement, picked, onPick }: { placement: Placement; picked: boolean; onPick: () => void }) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
  const url = useImageUrl(item?.image);
  return (
    <button type="button" className="ref-card" aria-pressed={picked} onClick={onPick} title={item?.name}>
      {url ? <img src={url} alt="" /> : <span className="ref-empty">{item?.name ?? 'Card'}</span>}
      <span className="ref-check" aria-hidden>
        {picked ? '✓' : ''}
      </span>
    </button>
  );
}

export default function GenerateArt({ page, onDone }: { page: number; onDone: () => void }) {
  const { binder, dispatch } = useBinder();
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('right');
  const [length, setLength] = useState<1 | 2>(1);
  const [hint, setHint] = useState('');
  const [brief, setBrief] = useState<ArtBrief | null>(null);
  const [prompt, setPrompt] = useState('');
  const [crop, setCrop] = useState<Crop>(FULL_CARD);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'brief' | 'image' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cards on this page are what can be extended.
  const onPage = useMemo(
    () => placementsOnPage(binder, page).filter((p) => binder.library.find((i) => i.id === p.itemId)?.image),
    [binder, page],
  );
  const anchor = onPage.find((p) => p.id === anchorId) ?? onPage[0];
  const anchorItem = binder.library.find((i) => i.id === anchor?.itemId);
  const anchorUrl = useImageUrl(anchorItem?.image);

  const plan: ExtendPlan = { direction, length };
  const box = composite(binder, plan);
  const artAspect = aspectOfArt(binder, plan);
  const across = isHorizontal(direction);
  const artPct = Math.round((across ? box.art.w : box.art.h) * 100);
  const cardFirst = direction === 'right' || direction === 'down';
  // Whatever the card and the art do not cover is the divider between them.
  const gapFraction = 1 - (across ? box.card.w + box.art.w : box.card.h + box.art.h);

  // A pair with facing openings prints as one uncut piece; worth saying.
  const pairs = facingPairs(openingsOn(binder, isLeftPage(binder, page)));
  const uncut = box.spanCols === 2 && pairs.length > 0;

  // Rendering takes tens of seconds; show that something is still happening.
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [busy]);

  async function run(step: 'brief' | 'image') {
    if (!anchorUrl) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(step);
    setError(null);
    try {
      const extend = { direction, artPct };

      if (step === 'brief') {
        // Reading happens on the whole card, frame and all: the model has to
        // see the frame to tell us where it ends.
        const refs = [{ type: 'base64' as const, media_type: 'image/jpeg', data: await cardBytes(anchorUrl) }];
        const result = await readPage(refs, artAspect, hint, { signal: controller.signal, extend });
        setBrief(result);
        setPrompt(result.prompt);
        setCrop(cropFromPercent(result.art));
      } else {
        // Painting happens on the illustration alone, cropped out of the card.
        const canvas = await buildComposite(anchorUrl, box, crop);
        const refs = [{ type: 'base64' as const, media_type: 'image/jpeg', data: canvas.split(',')[1] }];
        const { image } = await renderArt(prompt, box.w / box.h, refs, { signal: controller.signal, extend });
        setPreview(await cropExtension(image, box));
      }
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      if (!aborted) setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function keep() {
    if (!preview) return;
    const key = uid('img');
    await putBlob(key, await dataUrlToBlob(preview));
    const item: LibraryItem = {
      id: uid('art'),
      kind: 'art',
      origin: 'generated',
      name: anchorItem ? `${anchorItem.name}, ${direction}` : 'Extended art',
      image: { type: 'local', key },
      spanCols: box.spanCols,
      spanRows: box.spanRows,
    };
    dispatch({ type: 'addItems', items: [item] });
    onDone();
  }

  return (
    <>
      <div className="opt">
        <span className="sect">Card to extend</span>
        {onPage.length ? (
          <div className="ref-grid">
            {onPage.map((placement) => (
              <CardTile
                key={placement.id}
                placement={placement}
                picked={placement.id === anchor?.id}
                onPick={() => {
                  setAnchorId(placement.id);
                  setCrop(FULL_CARD);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="note">Put a card on this page first — its art is what gets carried on.</p>
        )}
      </div>

      <div className="opt">
        <span className="sect">Carry the art</span>
        <div className="seg wrap" role="group" aria-label="Direction">
          {DIRECTIONS.map((d) => (
            <button key={d.id} type="button" aria-pressed={direction === d.id} onClick={() => setDirection(d.id)}>
              {d.arrow} {d.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="How far">
          {([1, 2] as const).map((n) => (
            <button key={n} type="button" aria-pressed={length === n} onClick={() => setLength(n)}>
              {n} pocket{n > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <p className="note">
          {box.spanCols} × {box.spanRows} pocket{box.spanCols * box.spanRows > 1 ? 's' : ''}
          {box.spanRows > 1 ? ' · stacked pockets are always cut in two' : ''}
          {uncut ? ` · sits uncut across pockets ${pairs[0][0]}–${pairs[0][1]} on this page` : ''}
        </p>
      </div>

      <label className="field">
        <span>Anything to steer it (optional)</span>
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="more sky, the shore continues" />
      </label>

      <div className="add-row">
        <button type="button" className="btn" disabled={!anchorUrl || busy !== null} onClick={() => run('brief')}>
          {busy === 'brief' ? `Reading the card… ${elapsed}s` : 'Read the card'}
        </button>
        {busy && (
          <button type="button" className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>

      {brief && (
        <>
          <p className="note">{brief.theme}</p>
          {brief.palette.length > 0 && (
            <div className="swatches" aria-hidden>
              {brief.palette.slice(0, 8).map((colour, i) => (
                <i key={i} style={{ background: colour }} />
              ))}
            </div>
          )}
          <div className="opt">
            <span className="sect">Just the illustration</span>
            <div className="crop-view">
              {anchorUrl && <img src={anchorUrl} alt="" />}
              <span
                className="crop-box"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              />
            </div>
            <div className="crop-edges">
              {(
                [
                  ['Top', 'y'],
                  ['Left', 'x'],
                  ['Right', 'r'],
                  ['Bottom', 'b'],
                ] as const
              ).map(([label, edge]) => {
                const value = Math.round(
                  (edge === 'y' ? crop.y : edge === 'x' ? crop.x : edge === 'r' ? 1 - crop.x - crop.w : 1 - crop.y - crop.h) *
                    100,
                );
                return (
                  <label key={edge} className="field">
                    <span>{label} %</span>
                    <input
                      type="number"
                      min={0}
                      max={45}
                      value={value}
                      onChange={(e) => {
                        const n = Math.min(45, Math.max(0, Number(e.target.value))) / 100;
                        setCrop((c) =>
                          edge === 'y'
                            ? { ...c, y: n, h: c.y + c.h - n }
                            : edge === 'x'
                              ? { ...c, x: n, w: c.x + c.w - n }
                              : edge === 'r'
                                ? { ...c, w: 1 - c.x - n }
                                : { ...c, h: 1 - c.y - n },
                        );
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <div className="add-row">
              <button type="button" className="btn btn-sm" onClick={() => setCrop(FULL_CARD)}>
                Whole card
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setCrop(cropFromPercent(brief.art))}>
                What it found
              </button>
            </div>
            <p className="note">
              Only what is inside the box gets carried onward. Trim the border, name plate and text box off, or the
              model will paint those onward instead of the picture.
            </p>
          </div>

          <label className="field">
            <span>Prompt</span>
            <textarea className="csv-text" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
          </label>
          <div className="add-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!prompt.trim() || busy !== null}
              onClick={() => run('image')}
            >
              {busy === 'image' ? `Painting… ${elapsed}s` : preview ? 'Paint it again' : 'Extend the art'}
            </button>
          </div>
        </>
      )}

      {preview && (
        <div className="gen-preview">
          {/* The card beside the new piece, in the order and at the spacing they
              sit in the binder, divider included — the join is the only thing
              worth judging here. */}
          <div
            className="seam"
            style={{
              aspectRatio: `${box.w / box.h}`,
              gridTemplateColumns: across
                ? [cardFirst ? box.card.w : box.art.w, gapFraction, cardFirst ? box.art.w : box.card.w]
                    .map((f) => `${f}fr`)
                    .join(' ')
                : '1fr',
              gridTemplateRows: across
                ? '1fr'
                : [cardFirst ? box.card.h : box.art.h, gapFraction, cardFirst ? box.art.h : box.card.h]
                    .map((f) => `${f}fr`)
                    .join(' '),
            }}
          >
            {cardFirst && anchorUrl && <img src={anchorUrl} alt="" />}
            {cardFirst && <span className="seam-divider" aria-hidden />}
            <img src={preview} alt="Extended art" />
            {!cardFirst && <span className="seam-divider" aria-hidden />}
            {!cardFirst && anchorUrl && <img src={anchorUrl} alt="" />}
          </div>
          <p className="note">
            Only the new piece goes into your library — the card stays in its own pocket. The dark strip is the
            divider, which hides that sliver of the scene.
          </p>
          <div className="add-row">
            <button type="button" className="btn btn-primary" onClick={keep}>
              Add to library
            </button>
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
        </div>
      )}

      {error && <p className="warn">{error}</p>}
      <p className="note fineprint">
        The card's illustration — cropped out of its frame — is composited onto a working canvas with the new pocket
        left empty, and the model paints the picture onward into it, so the horizon, the light and the ground line up
        across the divider. Setting only: the card keeps its characters.
      </p>
    </>
  );
}
