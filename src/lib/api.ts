import type { CardItem } from '../types';
import { uid } from './util';

const ENDPOINT = 'https://api.pokemontcg.io/v2/cards';

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

interface ApiCard {
  id: string;
  name: string;
  number?: string;
  set?: { name?: string };
  images?: { small?: string; large?: string };
}

export interface LookupRow {
  name: string;
  setName?: string;
  number?: string;
}

export interface SearchOptions {
  apiKey?: string;
  setName?: string;
  signal?: AbortSignal;
}

/**
 * Search pokemontcg.io. No key is needed for light use; a key (free from
 * dev.pokemontcg.io) just raises the rate limit and is stored locally.
 */
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
  const found = new Map<string, ApiCard[]>();

  for (let i = 0; i < names.length; i += size) {
    if (opts.signal?.aborted) break;
    const batch = names.slice(i, i + size);
    const q = batch.map((n) => `name:"${n}"`).join(' OR ');
    const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&pageSize=250`;
    try {
      const res = await fetch(url, {
        signal: opts.signal,
        headers: opts.apiKey ? { 'X-Api-Key': opts.apiKey } : undefined,
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: ApiCard[] };
        for (const card of body.data ?? []) {
          const key = normalize(card.name);
          found.set(key, [...(found.get(key) ?? []), card]);
        }
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
      if (wantSet && card.set?.name?.toLowerCase().includes(wantSet)) score += 2;
      if (normalize(card.name) === normalize(row.name)) score += 1;
      return { card, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return toCardItem(scored[0].card);
  });
}

export async function searchCards(query: string, opts: SearchOptions = {}): Promise<CardItem[]> {
  const terms: string[] = [];
  const q = query.trim();
  if (q) {
    // A bare number searches by card number, otherwise fuzzy-match the name.
    if (/^\d+$/.test(q)) terms.push(`number:${q}`);
    else terms.push(`name:"${q.replace(/"/g, '')}*"`);
  }
  if (opts.setName?.trim()) terms.push(`set.name:"${opts.setName.trim().replace(/"/g, '')}*"`);
  if (!terms.length) return [];

  const url = `${ENDPOINT}?q=${encodeURIComponent(terms.join(' '))}&pageSize=36&orderBy=-set.releaseDate,number`;
  const res = await fetch(url, {
    signal: opts.signal,
    headers: opts.apiKey ? { 'X-Api-Key': opts.apiKey } : undefined,
  });
  if (!res.ok) throw new Error(`Card search failed (${res.status})`);
  const body = (await res.json()) as { data?: ApiCard[] };
  return (body.data ?? []).map(toCardItem);
}

function toCardItem(c: ApiCard): CardItem {
  return {
    id: uid('card'),
    kind: 'card',
    origin: 'api',
    name: c.name,
    setName: c.set?.name,
    number: c.number,
    image:
      c.images?.large || c.images?.small ? { type: 'remote', url: (c.images!.large ?? c.images!.small)! } : undefined,
  };
}
