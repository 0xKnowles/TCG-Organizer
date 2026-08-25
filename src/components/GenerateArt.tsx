import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItem, Placement } from '../types';
import { useBinder } from '../store';
import { placementsOnPage } from '../lib/geometry';
import { facingPairs, openingsOn } from '../lib/pockets';
import { isLeftPage } from '../lib/geometry';
import { blobUrl, putBlob } from '../lib/idb';
import { uid } from '../lib/util';
import { useImageUrl } from '../lib/useImage';
import {
  SPAN_CHOICES,
  aspectFor,
  aspectLabel,
  dataUrlToBlob,
  readPage,
  referencesFor,
  renderArt,
  type ArtBrief,
  type GenerateSpan,
} from '../lib/artGen';

function CardTile({ placement, picked, onToggle }: { placement: Placement; picked: boolean; onToggle: () => void }) {
  const { binder } = useBinder();
  const item = binder.library.find((i) => i.id === placement.itemId);
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

export default function GenerateArt({ page, onDone }: { page: number; onDone: () => void }) {
  const { binder, dispatch } = useBinder();
  const [span, setSpan] = useState<GenerateSpan>({ spanCols: 2, spanRows: 1 });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [hint, setHint] = useState('');
  const [brief, setBrief] = useState<ArtBrief | null>(null);
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'brief' | 'image' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cards on this page are what the model reads.
  const onPage = useMemo(
    () => placementsOnPage(binder, page).filter((p) => binder.library.find((i) => i.id === p.itemId)?.image),
    [binder, page],
  );
  const chosen = picked ?? new Set(onPage.map((p) => p.id));
  const references = onPage.filter((p) => chosen.has(p.id));
  const aspect = aspectFor(binder, span);

  // A pair with facing openings prints as one uncut piece; worth saying.
  const pairs = facingPairs(openingsOn(binder, isLeftPage(binder, page)));
  const uncut = span.spanCols === 2 && span.spanRows === 1 && pairs.length > 0;

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

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  // Uploaded images live in IndexedDB, so they have to be read out before they
  // can be shrunk and sent. Remote card art goes by URL and needs none of this.
  const localUrls = useMemo(() => new Map<string, string>(), []);

  async function collectReferences() {
    for (const placement of references) {
      const item = binder.library.find((i) => i.id === placement.itemId);
      if (item?.image?.type === 'local' && !localUrls.has(item.image.key)) {
        const url = await blobUrl(item.image.key);
        if (url) localUrls.set(item.image.key, url);
      }
    }
    return referencesFor(binder, references, (placement) => {
      const item = binder.library.find((i) => i.id === placement.itemId);
      return item?.image?.type === 'local' ? localUrls.get(item.image.key) : undefined;
    });
  }

  async function run(step: 'brief' | 'image') {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(step);
    setError(null);
    try {
      const images = await collectReferences();
      if (step === 'brief') {
        const result = await readPage(images, aspect, hint, controller.signal);
        setBrief(result);
        setPrompt(result.prompt);
      } else {
        const { image } = await renderArt(prompt, aspect, images, controller.signal);
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
    const item: LibraryItem = {
      id: uid('art'),
      kind: 'art',
      origin: 'generated',
      name: brief?.theme ? brief.theme.split(/[.,]/)[0].slice(0, 40) : 'Generated art',
      image: { type: 'local', key },
      spanCols: span.spanCols,
      spanRows: span.spanRows,
    };
    dispatch({ type: 'addItems', items: [item] });
    onDone();
  }

  return (
    <>
      <div className="opt">
        <span className="sect">Size</span>
        <div className="seg wrap">
          {SPAN_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              aria-pressed={span.spanCols === choice.span.spanCols && span.spanRows === choice.span.spanRows}
              onClick={() => setSpan(choice.span)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <p className="note">
          {aspectLabel(aspect)}
          {span.spanRows > 1 ? ' · stacked pockets are always cut in two' : ''}
          {uncut ? ` · sits uncut across pockets ${pairs[0][0]}–${pairs[0][1]} on this page` : ''}
        </p>
      </div>

      <div className="opt">
        <span className="sect">Cards to read ({references.length})</span>
        {onPage.length ? (
          <>
            <div className="ref-grid">
              {onPage.map((placement) => (
                <CardTile
                  key={placement.id}
                  placement={placement}
                  picked={chosen.has(placement.id)}
                  onToggle={() => toggle(placement.id)}
                />
              ))}
            </div>
            <div className="add-row">
              <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set(onPage.map((p) => p.id)))}>
                All on this page
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set())}>
                None
              </button>
            </div>
          </>
        ) : (
          <p className="note">Put some cards on this page first — they are what the art is built from.</p>
        )}
      </div>

      <label className="field">
        <span>Anything to steer it (optional)</span>
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="dusk, rain, keep it calm" />
      </label>

      <div className="add-row">
        <button
          type="button"
          className="btn"
          disabled={!references.length || busy !== null}
          onClick={() => run('brief')}
        >
          {busy === 'brief' ? `Reading the page… ${elapsed}s` : 'Read the page'}
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
              {busy === 'image' ? `Generating… ${elapsed}s` : preview ? 'Generate again' : 'Generate art'}
            </button>
          </div>
        </>
      )}

      {preview && (
        <div className="gen-preview">
          <img src={preview} alt="Generated art" style={{ aspectRatio: `${aspect}` }} />
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
        Gemini reads the card illustrations and ignores the frames, then renders the background. It makes new
        background art in a matching style — never a copy of a card or its characters.
      </p>
    </>
  );
}
