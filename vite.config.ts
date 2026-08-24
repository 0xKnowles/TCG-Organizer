import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { searchCards, type SearchQuery } from './src/lib/cardSearch';

/**
 * Serve the same /api/cards endpoint the deployed function provides, so the dev
 * server behaves like production instead of hitting card APIs from the page.
 */
function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function cardApi(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (url.pathname.startsWith('/api/family')) {
      import('./src/lib/family')
        .then(({ resolveFamily }) => resolveFamily(url.searchParams.get('q') ?? ''))
        .then((family) => send(200, family))
        .catch((err: unknown) => send(502, { error: err instanceof Error ? err.message : 'failed' }));
      return;
    }

    if (url.pathname.startsWith('/api/generate')) {
      // Loaded on demand so the Anthropic SDK stays out of config startup.
      readBody(req)
        .then(async (body) => {
          const { handleGenerate } = await import('./api/generate');
          return handleGenerate(body);
        })
        .then((result) => send(200, result))
        .catch((err: unknown) => send(502, { error: err instanceof Error ? err.message : 'failed' }));
      return;
    }

    if (!url.pathname.startsWith('/api/cards')) return next();

    const names = url.searchParams.get('names');
    const limit = Number(url.searchParams.get('limit'));
    const query: SearchQuery = {
      q: url.searchParams.get('q') ?? undefined,
      set: url.searchParams.get('set') ?? undefined,
      names: names ? names.split('|').filter(Boolean) : undefined,
      species: url.searchParams.get('species') ?? undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    };

    searchCards(query, { apiKey: process.env.POKEMONTCG_API_KEY })
      .then((result) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      })
      .catch((err: unknown) => {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'failed', cards: [] }));
      });
  };

  return {
    name: 'card-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), cardApi()],
  server: { port: 5173, open: false },
});
