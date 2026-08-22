# Binder Studio — Pokémon TCG Binder Organizer

Plan a trading-card binder before you touch a single sleeve. Pick your binder's
pocket layout, build a library of the cards you want to show off, then drop each
one into an exact pocket on an exact page — including fan art and photos that
stretch across two or more pockets, the way collectors frame a page.

![Binder Studio](docs/screenshot.png)

*A 3×3 spread with a piece of art filling four pockets. Placeholder images.*

## What it does

- **Any binder size.** 2×2, 3×3, 4×3, 4×4 presets, or a custom grid up to 8×8.
- **Card library.** Search [pokemontcg.io](https://pokemontcg.io) by name, number
  and set, upload your own scans, or paste an image URL. Manual entries work fine
  for cards you have not bought yet.
- **Exact placement.** Drag a card from the library to the pocket you want.
  Drag it again to move it; drop it onto another single card to swap the two.
- **Multi-slot fan art.** Add a photo or piece of art and give it a footprint —
  2 wide, 2 tall, 2×2, or anything up to the full page. It renders as one image
  across those pockets, with the pocket seams drawn over it. Resize or pan it
  afterwards from the inspector.
- **Real binder view.** Page-at-a-time or a true left/right spread, with an
  option for page 1 to sit alone like a real binder opening on its cover.
- **Pages.** Insert, delete, clear, or auto-fill a page with unplaced cards.
- **Export.** Render the current page or spread to PNG to share a mock-up, and
  save the whole binder to a `.binder.json` file you can reopen later.

Everything is local: the binder lives in your browser (`localStorage` for the
layout, IndexedDB for uploaded images). No account, no server, no uploads.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # production bundle in dist/
npm run preview  # serve the built bundle
```

Requires Node 20+. The build output is static — any file host will serve it.

## How it fits together

| Path | What lives there |
| --- | --- |
| `src/store.tsx` | Binder state, the reducer that owns every edit, and persistence |
| `src/types.ts` | `Binder`, `LibraryItem`, `Placement` |
| `src/lib/geometry.ts` | Grid maths: bounds, overlap, drop validity, spread paging |
| `src/lib/idb.ts` | IndexedDB blob store for uploaded images |
| `src/lib/dnd.ts` | The drag payload shared by the library and the pages |
| `src/lib/exportImage.ts` | Canvas renderer behind **Export PNG** |
| `src/lib/transfer.ts` | `.binder.json` save/open, with images inlined |
| `src/components/` | Setup screen, library sidebar, page grid, inspector, toolbar |

A **library item** is a card or a piece of art you own. A **placement** is one
copy of that item sitting at a page/column/row with a footprint in pockets. The
same card can be placed more than once; deleting a library item removes its
placements too.

### Keyboard

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next page or spread |
| `Delete` | Remove the selected item from the page |
| `Esc` | Deselect |
| Double-click a library row | Drop it into the first free pocket on the current page |

## Notes

- Card images and data come from the community
  [Pokémon TCG API](https://pokemontcg.io). An API key is optional and only
  raises your rate limit; if you add one it is stored in your browser alone.
- PNG export asks image hosts for CORS permission. Uploaded images always
  export; a remote image whose host refuses is left as an empty pocket.
- Pokémon and Pokémon TCG are trademarks of Nintendo / Creatures Inc. /
  GAME FREAK inc. This is an unofficial fan tool.
