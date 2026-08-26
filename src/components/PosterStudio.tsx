import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Poster } from '../types';
import { useBinder } from '../store';
import { blobUrl, putBlob } from '../lib/idb';
import { uid } from '../lib/util';
import { useImageUrl } from '../lib/useImage';
import { physical } from '../lib/pockets';
import {
  HOLDERS,
  POSTER_SIZES,
  type Rect,
  dpiOf,
  holderOf,
  newPoster,
  posterAspect,
  review,
  sizeOf,
  windowHint,
  windowRects,
} from '../lib/poster';
import {
  dataUrlToBlob,
  measureImage,
  readPage,
  referencesForItems,
  renderArt,
  type ArtBrief,
  type ImageRef,
  type RenderSize,
} from '../lib/artGen';

const RENDER_SIZES: RenderSize[] = ['1K', '2K', '4K'];
const mm = (n: number) => `${n}mm`;
const inches = (n: number) => (n / 25.4).toFixed(1);

/**
 * A card as it will actually sit on the finished poster: the card itself, at
 * card size, centred in its window. A slab window is bigger than the card it
 * holds, so filling the window would draw the card oversized.
 */
function MountedCard({ id, rect, card }: { id: string; rect: Rect; card: { w: number; h: number } }) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === id);
  const url = useImageUrl(item?.image);
  if (!url) return null;
  const scale = Math.min(1, rect.w / card.w, rect.h / card.h);
  const w = card.w * scale;
  const h = card.h * scale;
  return (
    <img
      className="poster-card"
      src={url}
      alt=""
      style={{ left: mm(rect.x + (rect.w - w) / 2), top: mm(rect.y + (rect.h - h) / 2), width: mm(w), height: mm(h) }}
    />
  );
}

function CardTile({ id, picked, onToggle }: { id: string; picked: boolean; onToggle: () => void }) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === id);
  const url = useImageUrl(item?.image);
  return (
    <button type="button" className="ref-card" aria-pressed={picked} onClick={onToggle} title={item?.name}>
      {url ? <img src={url} alt="" /> : <span className="ref-empty">{item?.name ?? 'Card'}</span>}
      <span className="ref-check" aria-hidden>
        {picked ? '✓' : ''}
      </span>
    </button>
  );
}

export default function PosterStudio({ onClose }: { onClose: () => void }) {
  const { binder, dispatch } = useBinder();
  const saved = binder.posters ?? [];

  const [poster, setPoster] = useState<Poster>(() => saved[saved.length - 1] ?? newPoster(uid('poster')));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hint, setHint] = useState('');
  const [brief, setBrief] = useState<ArtBrief | null>(null);
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [renderSize, setRenderSize] = useState<RenderSize>('2K');
  const [guides, setGuides] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const [printGuides, setPrintGuides] = useState(false);
  const [busy, setBusy] = useState<'brief' | 'image' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(0.4);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const page = sizeOf(poster);
  const rects = windowRects(poster);
  const savedUrl = useImageUrl(poster.image);
  const art = preview ?? savedUrl;
  const pixels = preview ? undefined : poster.pixels;
  const [previewPixels, setPreviewPixels] = useState<{ w: number; h: number } | undefined>();
  const shownPixels = preview ? previewPixels : pixels;
  const problems = review(poster, shownPixels);

  const cards = useMemo(() => binder.library.filter((i) => i.kind === 'card' && i.image), [binder.library]);

  /**
   * The cards that go in the windows: whatever is picked while a poster is
   * being made, and whatever was saved with it afterwards. Filled in reading
   * order, so a window past the end of the list is simply left empty.
   */
  const mounted = useMemo(() => {
    const ids = picked.size ? cards.filter((i) => picked.has(i.id)).map((i) => i.id) : (poster.cardIds ?? []);
    return ids.filter((id) => binder.library.some((i) => i.id === id));
  }, [picked, cards, poster.cardIds, binder.library]);
  const cardSize = physical(binder).card;

  const patch = (next: Partial<Poster>) => setPoster((p) => ({ ...p, ...next }));

  useEffect(() => {
    if (!preview) {
      setPreviewPixels(undefined);
      return;
    }
    measureImage(preview).then(setPreviewPixels);
  }, [preview]);

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

  // Fit the sheet to the preview column; printing ignores this transform.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const mmToPx = 96 / 25.4;
      const { width, height } = entry.contentRect;
      setScale(Math.min(1, (width - 16) / (page.w * mmToPx), (height - 16) / (page.h * mmToPx)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.w, page.h]);

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function collectReferences(): Promise<ImageRef[]> {
    const chosen = cards.filter((i) => picked.has(i.id));
    const urls = new Map<string, string>();
    for (const item of chosen) {
      if (item.image?.type === 'local' && !urls.has(item.image.key)) {
        const url = await blobUrl(item.image.key);
        if (url) urls.set(item.image.key, url);
      }
    }
    return referencesForItems(chosen, (src) => (src.type === 'local' ? urls.get(src.key) : undefined));
  }

  async function run(step: 'brief' | 'image') {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(step);
    setError(null);
    try {
      const refs = await collectReferences();
      const aspect = posterAspect(poster);
      if (step === 'brief') {
        const result = await readPage(refs, aspect, hint, { signal: controller.signal, windows: windowHint(poster) });
        setBrief(result);
        setPrompt(result.prompt);
      } else {
        const { image } = await renderArt(prompt, aspect, refs, { signal: controller.signal, imageSize: renderSize });
        setPreview(image);
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
    const next: Poster = {
      ...poster,
      name: brief?.theme ? brief.theme.split(/[.,]/)[0].slice(0, 40) : poster.name,
      image: { type: 'local', key },
      cardIds: mounted,
      pixels: previewPixels,
      theme: brief?.theme,
      prompt,
      updatedAt: Date.now(),
    };
    dispatch({ type: 'savePoster', poster: next });
    setPoster(next);
    setPreview(null);
  }

  function startNew() {
    setPoster(newPoster(uid('poster')));
    setPreview(null);
    setBrief(null);
    setPrompt('');
    setPicked(new Set());
  }

  const holder = holderOf(poster);
  const blocked = problems.some((p) => p.level === 'error');

  return createPortal(
    <div className="print-dialog" role="dialog" aria-label="Poster studio">
      <style>{`@page { size: ${page.w}mm ${page.h}mm; margin: 0; }`}</style>

      <header className="print-head">
        <strong>Poster studio</strong>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-primary" disabled={!art} onClick={() => window.print()}>
          Print
        </button>
      </header>

      <div className="print-body">
        <div className="print-options">
          {saved.length > 0 && (
            <div className="opt">
              <span className="sect">Saved</span>
              <div className="chips">
                {saved.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    aria-pressed={p.id === poster.id}
                    onClick={() => {
                      setPoster(p);
                      setPreview(null);
                      setPrompt(p.prompt ?? '');
                      setPicked(new Set(p.cardIds ?? []));
                    }}
                  >
                    {p.name}
                  </button>
                ))}
                <button type="button" className="chip" onClick={startNew}>
                  + New
                </button>
              </div>
            </div>
          )}

          <div className="opt">
            <span className="sect">Paper</span>
            <select value={poster.sizeId} onChange={(e) => patch({ sizeId: e.target.value })}>
              {POSTER_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="seg">
              <button type="button" aria-pressed={!poster.landscape} onClick={() => patch({ landscape: false })}>
                Portrait
              </button>
              <button type="button" aria-pressed={poster.landscape} onClick={() => patch({ landscape: true })}>
                Landscape
              </button>
            </div>
            <p className="note">
              {page.w.toFixed(0)} × {page.h.toFixed(0)} mm · {inches(page.w)} × {inches(page.h)} in
            </p>
          </div>

          <div className="opt">
            <span className="sect">Cards sit in</span>
            <select value={poster.holderId} onChange={(e) => patch({ holderId: e.target.value, holder: undefined })}>
              {HOLDERS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} — {h.w} × {h.h} mm{h.note ? ` (${h.note})` : ''}
                </option>
              ))}
            </select>
            <label className="field">
              <span>Window size, mm</span>
              <span className="pair">
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={Math.round(holder.w)}
                  onChange={(e) => patch({ holder: { w: Number(e.target.value), h: holder.h } })}
                />
                <input
                  type="number"
                  min={20}
                  max={250}
                  value={Math.round(holder.h)}
                  onChange={(e) => patch({ holder: { w: holder.w, h: Number(e.target.value) } })}
                />
              </span>
            </label>
            <p className="note">Slabs and one-touches vary a little — measure yours and type it in if it matters.</p>
          </div>

          <div className="opt">
            <span className="sect">Windows</span>
            <label className="field">
              <span>Across × down</span>
              <span className="pair">
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={poster.cols}
                  onChange={(e) => patch({ cols: Math.max(1, Number(e.target.value)) })}
                />
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={poster.rows}
                  onChange={(e) => patch({ rows: Math.max(1, Number(e.target.value)) })}
                />
              </span>
            </label>
            <label className="field">
              <span>Gap between, mm</span>
              <input type="number" min={0} max={60} value={poster.gap} onChange={(e) => patch({ gap: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Nudge from centre, mm</span>
              <span className="pair">
                <input type="number" value={poster.offsetX} onChange={(e) => patch({ offsetX: Number(e.target.value) })} />
                <input type="number" value={poster.offsetY} onChange={(e) => patch({ offsetY: Number(e.target.value) })} />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={showCards} onChange={(e) => setShowCards(e.target.checked)} />
              Show the cards on top
            </label>
            <label className="check">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              Outline where they go
            </label>
            <label className="check">
              <input type="checkbox" checked={printGuides} onChange={(e) => setPrintGuides(e.target.checked)} />
              Print those outlines too
            </label>
          </div>

          <div className="opt">
            <span className="sect">Cards to read</span>
            {cards.length ? (
              <div className="ref-grid">
                {cards.map((item) => (
                  <CardTile key={item.id} id={item.id} picked={picked.has(item.id)} onToggle={() => toggle(item.id)} />
                ))}
              </div>
            ) : (
              <p className="note">Add a card to the library first — its art is what the poster grows out of.</p>
            )}
            <label className="field">
              <span>Anything to add</span>
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="sunrise, storm coming, seen from above…"
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!picked.size || busy !== null}
              onClick={() => run('brief')}
            >
              {busy === 'brief' ? `Reading… ${elapsed}s` : 'Read the cards'}
            </button>
          </div>

          {brief && (
            <div className="opt">
              <span className="sect">Brief</span>
              <p className="note">{brief.theme}</p>
              {brief.palette.length > 0 && (
                <div className="swatches" aria-hidden>
                  {brief.palette.map((colour) => (
                    <i key={colour} style={{ background: colour }} />
                  ))}
                </div>
              )}
              <textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <span className="sect">Render size</span>
              <div className="seg" role="group" aria-label="Render size">
                {RENDER_SIZES.map((size) => (
                  <button key={size} type="button" aria-pressed={renderSize === size} onClick={() => setRenderSize(size)}>
                    {size}
                  </button>
                ))}
              </div>
              <p className="note">
                Bigger prints sharper, but the reply has to fit in about 4 MB — 4K often does not come back.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!prompt.trim() || busy !== null}
                onClick={() => run('image')}
              >
                {busy === 'image' ? `Painting… ${elapsed}s` : 'Generate poster'}
              </button>
            </div>
          )}

          {preview && (
            <div className="opt">
              <button type="button" className="btn btn-primary" onClick={keep}>
                Keep this poster
              </button>
              <button type="button" className="btn" onClick={() => setPreview(null)}>
                Discard
              </button>
            </div>
          )}

          {problems.map((problem) => (
            <p key={problem.text} className={problem.level === 'error' ? 'warn' : 'note'}>
              {problem.text}
            </p>
          ))}
          {shownPixels && !blocked && (
            <p className="note">
              {shownPixels.w} × {shownPixels.h} px lands at {Math.round(dpiOf(poster, shownPixels))} dpi on this sheet.
            </p>
          )}
          {error && <p className="warn">{error}</p>}
          <p className="note">
            In the print dialog set scale to 100% (not “fit to page”) and turn margins off, then mount the cards on top
            with photo corners or removable squares.
          </p>
        </div>

        <div className="print-preview" ref={previewRef}>
          <div className="print-scale" style={{ ['--print-scale' as string]: scale }}>
            <div className="sheet poster-sheet" style={{ width: mm(page.w), height: mm(page.h) }}>
              {art ? <img className="poster-art" src={art} alt="" /> : <div className="poster-blank" />}
              {guides && (
                <div className={`poster-guides${printGuides ? ' print' : ''}`} aria-hidden>
                  {rects.map((rect, i) => (
                    <span
                      key={i}
                      style={{ left: mm(rect.x), top: mm(rect.y), width: mm(rect.w), height: mm(rect.h) }}
                    />
                  ))}
                </div>
              )}
              {showCards && (
                <div className="poster-cards" aria-hidden>
                  {rects.map((rect, i) =>
                    mounted[i] ? <MountedCard key={i} id={mounted[i]} rect={rect} card={cardSize} /> : null,
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
