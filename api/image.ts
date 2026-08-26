/**
 * Card art, re-served from this origin.
 *
 * The extend-art feature composites a card onto a canvas and reads the result
 * back. A canvas that has had a cross-origin image drawn on it is tainted and
 * cannot be read, and the card APIs do not send permissive CORS headers — so
 * the bytes come through here instead, where same-origin makes the problem
 * disappear.
 *
 * Only the hosts the app's own card search returns are allowed. This is a
 * fetcher for card art, not an open proxy.
 */

const ALLOWED = new Set(['images.pokemontcg.io', 'assets.tcgdex.net']);

/** Longest an upstream fetch gets before this gives up. */
const TIMEOUT = 8000;

interface Req {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
}

interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  send(body: Buffer): void;
  setHeader(name: string, value: string): void;
}

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }
  const params = req.query ?? Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams);
  const raw = params.url;
  const target = Array.isArray(raw) ? raw[0] : raw;
  if (!target) {
    res.status(400).json({ error: 'Pass url' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: 'That is not a URL' });
    return;
  }
  if (parsed.protocol !== 'https:' || !ALLOWED.has(parsed.hostname)) {
    res.status(403).json({ error: 'Only card art from the sources this app searches.' });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT) : undefined,
    });
    if (!upstream.ok) {
      res.status(502).json({ error: `That image would not load (${upstream.status})` });
      return;
    }
    const type = upstream.headers.get('content-type') ?? 'image/png';
    if (!type.startsWith('image/')) {
      res.status(415).json({ error: 'That URL is not an image' });
      return;
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    // Card art never changes once printed.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.setHeader('Content-Type', type.split(';')[0]);
    res.status(200).send(bytes);
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    res.status(504).json({ error: timedOut ? 'That image took too long to load' : 'That image would not load' });
  }
}
