import type { CardItem } from '../types';
import { resolveFamily } from './family';
import { uid } from './util';
import {
  searchCards as searchDirect,
  type CardSource,
  type FoundCard,
  type SearchQuery,
  type SearchResult,
} from './cardSearch';

/**
 * The app talks to its own /api/cards endpoint, which proxies the card APIs.
 * Same origin means an upstream failure can never surface as a CORS error, and
 * the API key stays on the server. When that endpoint is not there — a static
 * host with no functions — this falls back to calling the sources directly.
 */

let proxy: boolean | null = null;

function params(query: SearchQuery): string {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.set) search.set('set', query.set);
  if (query.names?.length) search.set('names', query.names.join('|'));
  if (query.species) search.set('species', query.species);
  if (query.limit) search.set('limit', String(query.limit));
  return search.toString();
}

async function run(query: SearchQuery, opts: SearchOptions): Promise<SearchResult> {
  if (proxy !== false) {
    let res: Response | undefined;
    try {
      res = await fetch(`/api/cards?${params(query)}`, { signal: opts.signal });
    } catch (err) {
      if (opts.signal?.aborted || proxy) throw err;
      proxy = false; // no endpoint here — fall through and call the sources
    }
    if (res) {
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (!isJson && res.status >= 500) {
        // The endpoint is there and the function crashed — Vercel answers with
        // plain text. Go direct for this search, but ask again next time: this
        // is not the same as there being no server, and treating it as such is
        // what hid a broken function behind working searches.
        return searchDirect(query, { apiKey: opts.apiKey, signal: opts.signal });
      }
      if (!isJson || res.status === 404) {
        // A static host answers /api/cards with the app itself; stop asking.
        proxy = false;
      } else {
        proxy = true;
        if (res.ok) return (await res.json()) as SearchResult;
        // The endpoint is there and said no: report that rather than silently
        // going direct, which is what we are trying to avoid.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Card search failed (${res.status})`);
      }
    }
  }
  return searchDirect(query, { apiKey: opts.apiKey, signal: opts.signal });
}

function toCardItem(card: FoundCard): CardItem {
  return {
    id: uid('card'),
    kind: 'card',
    origin: 'api',
    name: card.name,
    setName: card.setName,
    number: card.number,
    image: card.image ? { type: 'remote', url: card.image } : undefined,
  };
}

/** Strip the decorations collection exports add, leaving something searchable. */
function baseName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*-\s*(full art|holo|reverse holo|secret|rainbow|gold).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(name: string): string {
  return baseName(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '');
}

export interface SearchOptions {
  apiKey?: string;
  setName?: string;
  signal?: AbortSignal;
}

export interface FamilyResult {
  query: string;
  members: { name: string; slug: string; stage: number }[];
}

/** Resolve one name to its whole evolution family. */
export async function findFamily(query: string, signal?: AbortSignal): Promise<FamilyResult> {
  let answered: (FamilyResult & { error?: string }) | undefined;
  try {
    const res = await fetch(`/api/family?q=${encodeURIComponent(query)}`, { signal });
    if (res.headers.get('content-type')?.includes('application/json')) {
      answered = (await res.json()) as FamilyResult & { error?: string };
      if (!res.ok) throw new Error(answered.error ?? `Family lookup failed (${res.status})`);
    }
  } catch (err) {
    // The endpoint answered and said no: that is the real answer, report it.
    if (answered || signal?.aborted) throw err;
  }
  // No endpoint here, or it failed to reply. PokeAPI allows cross-origin
  // requests, so the browser can ask it itself rather than giving up.
  const family = answered ?? (await resolveFamily(query, { signal }));
  if (!family.members?.length) throw new Error('No evolution family found.');
  return family;
}

/**
 * Every card printed for one species, oldest set first. The species filter is
 * what stops a search for Mew returning the Mewtwo shelf.
 */
export async function searchSpecies(species: string, opts: SearchOptions = {}): Promise<CardItem[]> {
  const result = await run({ q: species, species, limit: 250 }, opts);
  const cards = [...result.cards].sort(
    (a, b) =>
      (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '') ||
      (a.setName ?? '').localeCompare(b.setName ?? '') ||
      String(a.number ?? '').localeCompare(String(b.number ?? ''), undefined, { numeric: true }),
  );
  return cards.map(toCardItem);
}

export interface SearchOutcome {
  items: CardItem[];
  source: CardSource;
  failed: SearchResult['failed'];
}

export async function searchCards(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const text = query.trim();
  if (!text && !opts.setName?.trim()) return { items: [], source: 'pokemontcg', failed: [] };
  const result = await run({ q: text, set: opts.setName, limit: 36 }, opts);
  return { items: result.cards.map(toCardItem), source: result.source, failed: result.failed };
}

export interface LookupRow {
  name: string;
  setName?: string;
  number?: string;
}

/**
 * Look rows from a collection export up in batches, matching on name first and
 * then narrowing by set and card number. Rows with no match come back
 * undefined so the caller can still add them by name alone.
 */
export async function lookupCards(
  rows: LookupRow[],
  opts: SearchOptions & { onProgress?: (done: number, total: number) => void; batchSize?: number } = {},
): Promise<(CardItem | undefined)[]> {
  const size = opts.batchSize ?? 8;
  const names = [...new Set(rows.map((r) => normalize(r.name)).filter(Boolean))];
  const found = new Map<string, FoundCard[]>();

  for (let i = 0; i < names.length; i += size) {
    if (opts.signal?.aborted) break;
    const batch = names.slice(i, i + size);
    try {
      const result = await run({ names: batch, limit: 250 }, opts);
      for (const card of result.cards) {
        const key = normalize(card.name);
        found.set(key, [...(found.get(key) ?? []), card]);
      }
    } catch {
      /* a failed batch just means those rows come in without images */
    }
    opts.onProgress?.(Math.min(i + size, names.length), names.length);
  }

  return rows.map((row) => {
    const candidates = found.get(normalize(row.name));
    if (!candidates?.length) return undefined;
    const wantSet = row.setName?.toLowerCase();
    const wantNumber = row.number?.toLowerCase();
    const scored = candidates.map((card) => {
      let score = 0;
      if (wantNumber && card.number?.toLowerCase() === wantNumber) score += 4;
      if (wantSet && card.setName?.toLowerCase().includes(wantSet)) score += 2;
      if (normalize(card.name) === normalize(row.name)) score += 1;
      return { card, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return toCardItem(scored[0].card);
  });
}
