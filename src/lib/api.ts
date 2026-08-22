import type { CardItem } from '../types';
import { uid } from './util';

const ENDPOINT = 'https://api.pokemontcg.io/v2/cards';

interface ApiCard {
  id: string;
  name: string;
  number?: string;
  set?: { name?: string };
  images?: { small?: string; large?: string };
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
  return (body.data ?? []).map((c) => ({
    id: uid('card'),
    kind: 'card' as const,
    name: c.name,
    setName: c.set?.name,
    number: c.number,
    image:
      c.images?.large || c.images?.small
        ? { type: 'remote' as const, url: (c.images!.large ?? c.images!.small)! }
        : undefined,
  }));
}
