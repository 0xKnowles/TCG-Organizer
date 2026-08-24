import { useRef, useState } from 'react';
import type { CardItem, LibraryItem } from '../types';
import { useBinder } from '../store';
import { findFamily, searchSpecies, type FamilyResult } from '../lib/api';
import { uid } from '../lib/util';

const API_KEY_STORAGE = 'binder-studio:pokemontcg-key';

/**
 * Build a binder set from an evolution family: name any member, get every
 * English card printed for the whole line, added as cards you still need.
 */
export default function FamilyBuilder({ page, onDone }: { page: number; onDone: () => void }) {
  const { dispatch } = useBinder();
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<FamilyResult | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<'family' | 'cards' | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const members = (family?.members ?? []).filter((m) => !skipped.has(m.slug));

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy('family');
    setError(null);
    setAdded(null);
    setFamily(null);
    try {
      const found = await findFamily(query, controller.signal);
      setFamily(found);
      setSkipped(new Set());
      setStatus(`${found.members.length} in the line`);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setBusy(null);
    }
  }

  async function addCards() {
    if (!members.length) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy('cards');
    setError(null);
    const apiKey = localStorage.getItem(API_KEY_STORAGE) ?? undefined;
    const items: LibraryItem[] = [];
    const seen = new Set<string>();
    try {
      for (const [index, member] of members.entries()) {
        setStatus(`Finding ${member.name} cards (${index + 1} of ${members.length})…`);
        const cards = await searchSpecies(member.name, { apiKey, signal: controller.signal });
        for (const card of cards) {
          // The same card can surface twice across a branching line.
          const fingerprint = `${card.name}|${card.setName ?? ''}|${card.number ?? ''}`;
          if (seen.has(fingerprint)) continue;
          seen.add(fingerprint);
          items.push({ ...card, id: uid('card'), owned: false } satisfies CardItem);
        }
      }
      if (!items.length) {
        setError('No cards found for that line.');
        return;
      }
      dispatch({ type: 'addItems', items });
      setAdded(items.length);
      setStatus(null);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Card search failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <form className="add-row" onSubmit={lookUp}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Applin, Eevee, Charmander…"
          aria-label="Pokémon name"
        />
        <button className="btn" type="submit" disabled={!query.trim() || busy !== null}>
          {busy === 'family' ? '…' : 'Find line'}
        </button>
      </form>
      <p className="note">
        Name any member of a line and every English card for the whole family is added as cards you still need — greyed
        out in their pockets until you mark them owned.
      </p>

      {family && (
        <div className="opt">
          <span className="sect">
            {family.members.length} in the line · {members.length} selected
          </span>
          <div className="spans">
            {family.members.map((member) => (
              <button
                key={member.slug}
                type="button"
                className="span-btn"
                aria-pressed={!skipped.has(member.slug)}
                onClick={() => {
                  const next = new Set(skipped);
                  if (next.has(member.slug)) next.delete(member.slug);
                  else next.add(member.slug);
                  setSkipped(next);
                }}
              >
                {member.name}
              </button>
            ))}
          </div>
          <div className="add-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!members.length || busy !== null}
              onClick={addCards}
            >
              {busy === 'cards' ? 'Working…' : 'Add every card'}
            </button>
            {busy && (
              <button type="button" className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {status && busy && <p className="note">{status}</p>}

      {added !== null && (
        <div className="opt">
          <p className="note">
            Added {added} {added === 1 ? 'card' : 'cards'} as needed. Lay them out and start swapping in the ones you
            have.
          </p>
          <div className="add-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                dispatch({ type: 'autoFillFrom', page });
                onDone();
              }}
            >
              Lay out from page {page + 1}
            </button>
            <button type="button" className="btn" onClick={onDone}>
              Leave in library
            </button>
          </div>
        </div>
      )}

      {error && <p className="warn">{error}</p>}
    </>
  );
}
