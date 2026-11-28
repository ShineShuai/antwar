# Page tests (`test-ui/`)

The three pages (Workshop, Arena, Maps) are tested in jsdom, with `node:test`, as part of `npm test` (`npm run test:ui` runs only these;
about 12 s). Two dev dependencies, `esbuild` and `jsdom`, are why: nothing else needs them, and `npm ci` installs them from the lock file.

## How
`test-ui/host.mjs` bundles `web/PAGE.ts` with esbuild (`import.meta.url` defined), runs it in a jsdom window made from `web/PAGE.html`, and gives
the page a `Worker` fake whose replies come from the **real engines** (`web/engine.ts` for replay, `web/batch-engine.ts` for games): a fake
that only records messages hides replay bugs. Canvases are stubs that count calls; `matchMedia`, the clipboard and the compression streams are
filled in. A test opens a page with `openPage('workshop' | 'arena' | 'maps', { storage, hash })`: `storage` fills localStorage first (the
saved project is how the Arena and Maps get their input), `hash` is a share link. Helpers: `$` (by id), `set`/`pick` (set a value and fire
`change`), `wait`, `key`, `sent(type)` (every message sent to a Worker, in order), `stored(key)`.

| file | covers |
|---|---|
| `maps.test.mjs` | strokes with the point mirror and tiles, the live checks, undo/redo, generators and their errors, library, import, hand-off to the workshop |
| `workshop-world.test.mjs` | the example-world picker follows the map, brains kept across colony counts, the Rules choice, the saved project, "Chart this match" |
| `workshop-replay.test.mjs` | play, pause, step, seek, keys, following an ant, the share link (loaded verified in a fresh page), heat map, debugger |
| `workshop-project.test.mjs` | Export project (the Blob is caught: jsdom makes no download), Import project: the editors, seed, Rules, map, versions merged, the brains replaced kept, bad files refused, the round trip |
| `workshop-brains.test.mjs` | versions and diff, the personality panel (the Keeper's dose follows the colonies) |
| `arena.test.mjs` | tabs, head to head with the docked viewer, league, sweep (reference and league) |

Each test was checked by breaking the page code it covers (the test then fails).

## What jsdom cannot see (a look in a real browser, about 10 minutes)
`getBoundingClientRect` and `clientWidth` are zero, nothing is painted, there is no layout, and no real Worker. So check by eye, in Chrome
(then Firefox and Safari):

- Workshop: the highlight overlay while typing and scrolling; every entry of each example picker; play, pause, seek and the keys; follow an
  ant, the heat map, a break on a rule; versions (save, diff, restore).
- Arena: run each tab with small numbers; Watch a game; the Workers box.
- Maps: draw with the mirror and with tiles; read the checks; Play in the workshop; the fairness test.
- Export project downloads a file (the name, the save dialog) and Import project… opens it (the file picker); jsdom only catches the Blob.
- Dark mode, a narrow window, and that the pointer lands on the cell it is over.
