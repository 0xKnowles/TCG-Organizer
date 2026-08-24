import { searchCards, type SearchQuery } from '../src/lib/cardSearch';

/**
 * Card search, proxied.
 *
 * Calling a card API straight from the page puts the browser at the mercy of
 * whatever CORS headers that API returns — and pokemontcg.io returns none on
 * its 5xx responses, so an upstream failure reaches the console as a CORS
 * error. Going through this function makes every request same-origin, keeps the
 * API key on the server, and lets a failing source fall back to another.
 */

interface Req {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}

interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  const params = req.query ?? Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
  const names = first(params.names as string | string[] | undefined);
  const limit = Number(first(params.limit as string | string[] | undefined));

  const query: SearchQuery = {
    q: first(params.q as string | string[] | undefined),
    set: first(params.set as string | string[] | undefined),
    names: names ? names.split('|').filter(Boolean) : undefined,
    species: first(params.species as string | string[] | undefined),
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 250) : undefined,
  };

  if (!query.q && !query.names?.length) {
    res.status(400).json({ error: 'Pass q or names' });
    return;
  }

  try {
    const result = await searchCards(query, { apiKey: process.env.POKEMONTCG_API_KEY });
    // Same card searches repeat a lot; let the edge hold onto them.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Card search failed', cards: [] });
  }
}
