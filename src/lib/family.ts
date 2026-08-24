/**
 * Evolution families, from PokéAPI. Free, no key, and authoritative — including
 * the English species names, which is what the card search needs to match on.
 *
 * Kept free of anything browser-specific so the proxy can run it too.
 */

const POKEAPI = 'https://pokeapi.co/api/v2';

export interface FamilyMember {
  /** English name as printed on cards: Applin, Farfetch'd, Mr. Mime. */
  name: string;
  /** PokéAPI slug, kept for debugging a mismatch. */
  slug: string;
  /** How far along the chain: 0 is the base form. */
  stage: number;
}

export interface Family {
  query: string;
  members: FamilyMember[];
}

export interface FamilyContext {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function speciesSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[♀]/g, '-f')
    .replace(/[♂]/g, '-m')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

async function getJson<T>(url: string, ctx: FamilyContext): Promise<T> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

interface ChainLink {
  species?: { name?: string; url?: string };
  evolves_to?: ChainLink[];
}

/** Walk the chain depth-first: base form first, then each branch in full. */
function walk(link: ChainLink | undefined, stage: number, out: { slug: string; stage: number }[]) {
  if (!link?.species?.name) return;
  out.push({ slug: link.species.name, stage });
  for (const next of link.evolves_to ?? []) walk(next, stage + 1, out);
}

async function englishName(slug: string, ctx: FamilyContext): Promise<string> {
  try {
    const species = await getJson<{ names?: { name?: string; language?: { name?: string } }[] }>(
      `${POKEAPI}/pokemon-species/${slug}`,
      ctx,
    );
    const english = species.names?.find((n) => n.language?.name === 'en')?.name;
    if (english) return english;
  } catch {
    /* fall back to the slug below */
  }
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

/**
 * Resolve one name to its whole evolution family. Any member of the family
 * finds the same set — typing Hydrapple gets you Applin too.
 */
export async function resolveFamily(query: string, ctx: FamilyContext = {}): Promise<Family> {
  const slug = speciesSlug(query);
  if (!slug) throw new Error('Type a Pokémon name.');

  let species: { evolution_chain?: { url?: string } };
  try {
    species = await getJson(`${POKEAPI}/pokemon-species/${slug}`, ctx);
  } catch (err) {
    if (err instanceof Error && err.message === '404') throw new Error(`No Pokémon called “${query}”.`);
    throw err;
  }
  if (!species.evolution_chain?.url) throw new Error(`No evolution data for “${query}”.`);

  const chain = await getJson<{ chain?: ChainLink }>(species.evolution_chain.url, ctx);
  const found: { slug: string; stage: number }[] = [];
  walk(chain.chain, 0, found);
  if (!found.length) throw new Error(`No evolution data for “${query}”.`);

  const names = await Promise.all(found.map((entry) => englishName(entry.slug, ctx)));
  return {
    query,
    members: found.map((entry, i) => ({ name: names[i], slug: entry.slug, stage: entry.stage })),
  };
}
