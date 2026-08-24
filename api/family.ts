import { resolveFamily } from '../src/lib/family.js';

/** A chain lookup is a species request, the chain, then a name per member. */
export const maxDuration = 25;

/** Evolution family lookup, proxied so the page never depends on another host's CORS. */

interface Req {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}

interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }
  const params = req.query ?? Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
  const raw = params.q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!q) {
    res.status(400).json({ error: 'Pass q' });
    return;
  }
  try {
    // Families do not change; let the edge keep them for a day.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(await resolveFamily(q));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Family lookup failed' });
  }
}
