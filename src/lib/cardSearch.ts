/**
 * Card lookup, kept free of anything browser-specific so the same code can run
 * in the browser or inside the serverless proxy.
 *
 * Two sources are tried in turn. pokemontcg.io is preferred when a key is
 * available; TCGdex needs no key and takes over whenever the first one fails,
 * which it has been doing since the service moved to Scrydex.
 */

export type CardSource = 'pokemontcg' | 'tcgdex';

export interface FoundCard {
  id: string;
  name: string;
  setName?: string;
  number?: string;
  image?: string;
  /** ISO date of the set, so a species run can be ordered oldest first. */
  releaseDate?: string;
}

export interface SearchQuery {
  /** Free text: a card name, or a number like 25 or SWSH262. */
  q?: string;
  set?: string;
  /** Several names at once, for a CSV import. */
  names?: string[];
  /**
   * Keep only cards whose name contains this species as whole words. A prefix
   * search for Mew otherwise drags in every Mewtwo.
   */
  species?: string;
  limit?: number;
}

export interface SearchResult {
  source: CardSource;
  cards: FoundCard[];
  /** Sources that failed, so the caller can say why results look thin. */
  failed: { source: CardSource; reason: string }[];
}

export interface SearchContext {
  apiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const POKEMONTCG = 'https://api.pokemontcg.io/v2/cards';
const TCGDEX = 'https://api.tcgdex.net/v2/en';

/** A printed card number: 25, 025, SWSH262, 136/185, TG12. */
export function looksLikeNumber(text: string): boolean {
  return /^[a-z]{0,4}\s?\d{1,4}[a-z]?(\/\d+)?$/i.test(text.trim());
}

/** Words, lowercased, punctuation dropped: "Farfetch'd V" -> ["farfetch","d","v"]. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** True when `name` contains every word of `species` in order, as whole words. */
export function isSpecies(name: string, species: string): boolean {
  const want = words(species);
  if (!want.length) return true;
  const got = words(name);
  return got.some((_, i) => want.every((word, j) => got[i + j] === word));
}

function quote(text: string): string {
  return text.replace(/["\\]/g, ' ').trim();
}

async function getJson(url: string, ctx: SearchContext, headers?: Record<string, string>): Promise<unknown> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(url, { signal: ctx.signal, headers });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/* ----------------------------- pokemontcg.io ---------------------------- */

interface PokemonTcgCard {
  id?: string;
  name?: string;
  number?: string;
  set?: { name?: string; releaseDate?: string };
  images?: { small?: string; large?: string };
}

function pokemonTcgQuery(query: SearchQuery): string | null {
  if (query.names?.length) {
    return query.names.map((n) => `name:"${quote(n)}"`).join(' OR ');
  }
  const text = query.q?.trim();
  if (!text) return null;
  const terms = [`name:"${quote(text)}*"`];
  // A promo code or collector number is a number, not a name.
  if (looksLikeNumber(text)) terms.push(`number:"${quote(text.replace(/\s/g, ''))}"`);
  const clause = terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0];
  return query.set?.trim() ? `${clause} set.name:"${quote(query.set)}*"` : clause;
}

async function fromPokemonTcg(query: SearchQuery, ctx: SearchContext): Promise<FoundCard[]> {
  const q = pokemonTcgQuery(query);
  if (!q) return [];
  // No orderBy: sorting on a nested field is an extra way for this API to fail,
  // and the ordering we want is cheap to do here.
  const url = `${POKEMONTCG}?q=${encodeURIComponent(q)}&pageSize=${query.limit ?? 36}`;
  const body = (await getJson(url, ctx, ctx.apiKey ? { 'X-Api-Key': ctx.apiKey } : undefined)) as {
    data?: PokemonTcgCard[];
  };
  return (body.data ?? [])
    .filter((c) => c?.name)
    .map((c) => ({
      id: c.id ?? `${c.name}-${c.number ?? ''}`,
      name: c.name!,
      setName: c.set?.name,
      number: c.number,
      image: c.images?.large ?? c.images?.small,
      releaseDate: c.set?.releaseDate,
    }));
}

/* --------------------------------- TCGdex -------------------------------- */

interface TcgdexBrief {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
}

let setNames: Map<string, { name: string; releaseDate?: string }> | null = null;

async function tcgdexSetNames(ctx: SearchContext): Promise<Map<string, { name: string; releaseDate?: string }>> {
  if (setNames) return setNames;
  const names = new Map<string, { name: string; releaseDate?: string }>();
  try {
    const sets = (await getJson(`${TCGDEX}/sets`, ctx)) as { id?: string; name?: string; releaseDate?: string }[];
    for (const set of sets ?? [])
      if (set?.id && set.name) names.set(set.id, { name: set.name, releaseDate: set.releaseDate });
    // Only remember a list we actually got; set names are cosmetic, so a failed
    // fetch should be retried next time rather than cached as "no names".
    setNames = names;
  } catch {
    /* fall back to the set id from the card id */
  }
  return names;
}

function tcgdexCard(brief: TcgdexBrief, sets: Map<string, { name: string; releaseDate?: string }>): FoundCard {
  const setId = brief.id?.includes('-') ? brief.id.slice(0, brief.id.lastIndexOf('-')) : undefined;
  const set = setId ? sets.get(setId) : undefined;
  return {
    id: brief.id ?? `${brief.name}-${brief.localId ?? ''}`,
    name: brief.name ?? 'Card',
    setName: set?.name ?? setId,
    number: brief.localId,
    releaseDate: set?.releaseDate,
    // TCGdex serves an extension-less base URL; quality and format are appended.
    image: brief.image ? `${brief.image}/high.png` : undefined,
  };
}

async function tcgdexByName(name: string, ctx: SearchContext): Promise<TcgdexBrief[]> {
  const attempts = [
    `${TCGDEX}/cards?name=like:${encodeURIComponent(name)}`,
    `${TCGDEX}/cards?name=${encodeURIComponent(name)}`,
  ];
  let answered = false;
  let lastError: unknown;
  for (const url of attempts) {
    try {
      const list = (await getJson(url, ctx)) as TcgdexBrief[];
      answered = true;
      if (Array.isArray(list) && list.length) return list;
    } catch (err) {
      lastError = err;
    }
  }
  // Nothing answered at all: report it rather than pass off a dead source as
  // simply having no matches.
  if (!answered) throw lastError instanceof Error ? lastError : new Error('tcgdex unreachable');
  return [];
}

async function fromTcgdex(query: SearchQuery, ctx: SearchContext): Promise<FoundCard[]> {
  const sets = await tcgdexSetNames(ctx);
  const wanted = query.names?.length ? query.names : query.q ? [query.q] : [];
  if (!wanted.length) return [];

  const seen = new Set<string>();
  const cards: FoundCard[] = [];
  for (const name of wanted) {
    const text = name.trim();
    if (!text) continue;
    let briefs = await tcgdexByName(text, ctx);
    if (!briefs.length && looksLikeNumber(text)) {
      try {
        const list = (await getJson(`${TCGDEX}/cards?localId=${encodeURIComponent(text)}`, ctx)) as TcgdexBrief[];
        briefs = Array.isArray(list) ? list : [];
      } catch {
        /* no match by number either */
      }
    }
    for (const brief of briefs) {
      const card = tcgdexCard(brief, sets);
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push(card);
    }
  }

  const set = query.set?.trim().toLowerCase();
  return set ? cards.filter((c) => c.setName?.toLowerCase().includes(set)) : cards;
}

/* -------------------------------- ordering ------------------------------- */

function ranked(cards: FoundCard[], query: SearchQuery): FoundCard[] {
  const text = query.q?.trim().toLowerCase();
  if (!text) return cards;
  const score = (card: FoundCard) => {
    const name = card.name.toLowerCase();
    if (name === text) return 0;
    if (name.startsWith(text)) return 1;
    if (name.includes(text)) return 2;
    return 3;
  };
  return [...cards].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** Retry once on a 5xx: the pokemontcg.io failures come and go. */
/**
 * What actually went wrong, in a few words fit for the search panel. `fetch`
 * reports a refused connection or a DNS failure as a bare "fetch failed" and
 * hides the real reason on `cause`, which is the difference between a source
 * being down and a source being unreachable from wherever this is running.
 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return 'failed';
  const cause = (err as { cause?: unknown }).cause;
  const detail =
    cause && typeof cause === 'object'
      ? ((cause as { code?: string }).code ?? (cause as { message?: string }).message)
      : undefined;
  return detail ? `${err.message} (${detail})` : err.message;
}

/** Retry once on a server error or a failed connection: both are often momentary. */
function worthRetrying(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^5\d\d$/.test(err.message) || 'cause' in err;
}

async function withRetry(run: () => Promise<FoundCard[]>, ctx: SearchContext): Promise<FoundCard[]> {
  try {
    return await run();
  } catch (err) {
    if (ctx.signal?.aborted || !worthRetrying(err)) throw err;
    return run();
  }
}

/**
 * Try each source in turn. A source that errors, or that answers with nothing,
 * hands over to the next one — so a degrading API cannot leave the search box
 * looking empty when another source has the card.
 */
export async function searchCards(query: SearchQuery, ctx: SearchContext = {}): Promise<SearchResult> {
  const order: CardSource[] = ['pokemontcg', 'tcgdex'];
  const failed: SearchResult['failed'] = [];

  for (const source of order) {
    try {
      const cards = await withRetry(
        () => (source === 'pokemontcg' ? fromPokemonTcg(query, ctx) : fromTcgdex(query, ctx)),
        ctx,
      );
      const kept = query.species ? cards.filter((card) => isSpecies(card.name, query.species!)) : cards;
      if (kept.length) return { source, cards: ranked(kept, query).slice(0, query.limit ?? 36), failed };
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      failed.push({ source, reason: describe(err) });
    }
  }

  return { source: order[order.length - 1], cards: [], failed };
}
