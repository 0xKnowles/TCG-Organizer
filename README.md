# Binder Studio

Plan a trading-card binder before you sleeve anything. Pick the pocket layout,
build a library of cards, and put each one in an exact pocket on an exact page —
including fan art and photos that span two or more pockets.

![Binder Studio](docs/screenshot.png)

## Features

- **Any layout.** 2×2, 3×3, 4×3, 4×4 or a custom grid up to 8×8. Pockets keep a
  real card's proportions at every size.
- **Card library.** Search [pokemontcg.io](https://pokemontcg.io) by name, number
  or set, upload scans and photos, or add an image by URL.
- **Exact placement.** Pick a card and tap the pocket you want. On a desktop you
  can drag instead, and drop one card onto another to swap them.
- **Multi-pocket art.** Give a photo or piece of art a footprint — 2 wide, 2 tall,
  2×2, up to a whole page — and it renders as one image across those pockets with
  the pocket seams drawn over it. Resize, pan, or rotate it afterwards.
- **Binder view.** One page at a time, or a left/right spread, with an option for
  page 1 to sit alone the way a binder opens on its cover.
- **Pages.** Insert, clear, delete, or fill a page with whatever is still unplaced.
- **Export.** Render the current view to PNG, or save the binder as a file you can
  reopen later.

Built for phones first: the library is a bottom sheet, every control is a real
tap target, and placement never depends on dragging. Light and dark themes follow
your system setting.

Everything stays on your device — the layout in `localStorage`, images in
IndexedDB. No account, no server.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # static bundle in dist/
npm run preview  # serve the built bundle
```

Node 20+. The build output is static, so any file host will serve it.

## How it fits together

| Path                     | What lives there                                             |
| ------------------------ | ------------------------------------------------------------ |
| `src/store.tsx`          | Binder state, the reducer that owns every edit, persistence  |
| `src/types.ts`           | `Binder`, `LibraryItem`, `Placement`                         |
| `src/lib/geometry.ts`    | Grid maths: page proportions, bounds, overlap, drop validity |
| `src/lib/idb.ts`         | IndexedDB blob store for uploaded images                     |
| `src/lib/dnd.ts`         | Drag payload shared by the library and the pages             |
| `src/lib/exportImage.ts` | Canvas renderer behind Export PNG                            |
| `src/lib/transfer.ts`    | Save/open `.binder.json`, with images inlined                |
| `src/components/`        | Setup, top bar, library panel, page view, inspector          |

A **library item** is a card or piece of art you own. A **placement** is one copy
of it sitting at a page, column and row with a footprint in pockets. The same
card can be placed more than once; removing a library item removes its
placements too.

### Keyboard

| Key      | Action                                      |
| -------- | ------------------------------------------- |
| `←` `→`  | Previous / next page                        |
| `Delete` | Remove the selected item from the page      |
| `Esc`    | Cancel placing, close the library, deselect |

## Notes

- Card data and images come from the community
  [Pokémon TCG API](https://pokemontcg.io). A key is optional and only raises the
  rate limit; if you add one it is stored in your browser alone.
- PNG export asks image hosts for CORS permission. Uploaded images always export;
  a remote image whose host refuses is left as an empty pocket.
- The screenshot above uses placeholder artwork.
- Pokémon and Pokémon TCG are trademarks of Nintendo / Creatures Inc. /
  GAME FREAK inc. This is an unofficial fan tool.
