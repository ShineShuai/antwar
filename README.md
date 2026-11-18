# Core of the ant-colony programming game (name open)

Deterministic ant-colony simulator in strict TypeScript. Node 22.18+ runs the `.ts` sources
directly (type stripping); one `tsc` emit writes unbundled ES modules for the browser to `dist/`. MIT licence.
Spec: `reference.html`.

    npm ci                       # typescript, @types/node (package-lock.json is committed)
    npm run trace:fetch          # optional: the official ICFP 2004 trace into traces/official/ (docs/TRACE.md); npm test then checks it
    npm test                     # 4 strict typechecks (core/web/worker/node) + lint-core + node --test
    npm run build                # tsc emit (rewriteRelativeImportExtensions) -> dist/ (index.html, reference.html, web/, src/)
    npm run check                # build, then verify every relative URL in dist/ resolves
    npm start                    # build, then serve http://localhost:8080/
    node cli/run.ts --map test/fixtures/tiny.world --ant test/fixtures/starter.ant --rounds 10000

- `src/core/types.ts`  shared types; branded `Cell` / `AntId` stop index mix-ups at compile time
- `src/core/rng.ts`    ICFP 2004 generator (matches the official x0..x99 for s0 = 12345)
- `src/core/asm.ts`    `assemble()` flat `.asm` with labels (`goto` is a zero-cost edge, resolved at load); `parseIcfp()` official `.ant`; `loadBrain()`
- `src/core/map.ts`    `parseMap()` / `formatMap()` official world files
- `src/core/gen.ts`    `generateWorld(seed)`: Classic contest world (spec 3.1); `node cli/gen.ts SEED [--symmetric]`
- `src/core/isa.ts`    the instruction table; `src/core/rules.ts` the rulesets registry: classic, tinyminds and one-flag bundles (carry two, dropfail, scare4, altorder, up to 26 colonies); see `docs/EXTENDING.md`
- `src/core/seed.ts`   `dailySeed(date)` = hash of the UTC date string (the client supplies the date: `web/clock.ts`)
- `src/core/match.ts`  `playGame()`, `schedule()`, 2/1/0 `standings()`, `pairwise()`, `colourSplit()`; `src/core/gen.ts` also has the point-mirror `SYMMETRIC_WORLD`; `docs/MATCH.md`
- `src/core/trace.ts`  the official dump format: `frameLines()`, `dumpChunks()` exporter, `parseDump()`, `mergeDumps()`, `compareDump()`; `node cli/trace.ts export|compare`; `docs/TRACE.md`
- `src/core/replay.ts` `createReplay()` (hash checkpoints every 1,000 rounds, keyframes every 2,000, `seek`), replay descriptor `record()`/`verify()`; `docs/REPLAY.md`
- `src/core/sim.ts`    `createSim()`, canonical state stream `snapshot()`/`restore()`, `hash()` = FNV-1a of it; rulesets `CLASSIC` (the task, exactly) and `TINYMINDS` (carry two,
  direction/payload). v1: two colonies, no scare rule, no drop on blocked move
- `web/`               `workshop.html` + `workshop.ts` (canvas viewer), `sim-worker.ts`, `engine.ts`
- `src/lang/`         rules compiler (levels 1-2, trail kit): `compileRules(text)`; `node cli/rc.ts FILE.rules [--asm | --ant] [--fire-counts]`; see `docs/RULES.md`
- `src/lang/script.ts` level 3: the structured script (define/macros, then/else, loop, repeat, choose, labels) -> flat assembly: `compileScript(text)`; `node cli/rc.ts FILE.script [--asm | --ant]`; see `docs/SCRIPT.md`
- `src/lang/templates.ts` level 0: templates, sliders, role mix -> rules text; `node cli/personality.ts --template trail --mix 70/20/10`; `web/personality.ts` the controls
- `web/brain.ts`      what the workshop shows under an editor (size, lint, errors), the explain-why rows, and `whereIs`/`traceRows`: a pc pointed back at a rule or source line (click an ant to follow it)
- `cli/tourney.ts`    `node cli/tourney.ts A B C [--seeds 20] [--symmetric] [--jobs 4]`: round-robin, both colours, 2/1/0, standings with intervals, pairwise matrix
- `cli/replay.ts`     `record`, `verify`, `seek` replay descriptors (JSON: inputs + hashes)
- `cli/eval.ts`       `npm run eval -- --ant FILE`: food home, time to 25/50/90%, carrier statistics over generated worlds; `--vs` plays two brains and counts the packets each steals from the other's nest (`docs/STEALING.md`)
- `ants/`             hand-designed trail ants (generators + generated `.asm`; results in `docs/TRAILS.md`) and the same ants as `.rules`
- `bench/run.ts`      `npm run bench`: rounds/s and ns per ant-round for four workloads; `--gate 3` compares with `bench/baseline.json` (`--write` refreshes it)
- `scripts/lint-core.ts`  core/ is integer-only: no `/`, Math.random, Date or float literals
- `oracle/ref.py`     second implementation in Python (stdlib only), written from the reference text; `test/crosscheck.test.ts` compares state hashes
- `spec/micro-tests.json`  language-neutral micro-tests (expected values worked out by hand from the reference); `test/micro.test.ts` and `oracle/micro.py` run them
- `test/refdemo.test.ts` runs the demo simulator inside `reference.html` against the core, round by round
- `testlib/ref-sim.ts` literal transliteration of the task pseudo-code: oracle for the fuzz test

Module Workers need http(s): use `npm start`, not file://.

## Play it on GitHub Pages

1. Push to a GitHub repo whose default branch is `main`.
2. Settings -> Pages -> Build and deployment -> Source: **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/ci.yml`: tests, `npm run check`, then deploys `dist/`.
4. Play at `https://<user>.github.io/<repo>/`; the spec is at `.../reference.html`.

All URLs are relative, so a project site works. In the workshop, **Copy link** puts both brains, the seed and the current round's state hash in the
URL fragment (never sent to a server); anyone opening it gets the same match, re-run to that round and checked against the hash. The slider and arrow keys seek. Edits are also kept in the browser's
local storage.
Defaults: Classic rules only in v1, seed 12345 (Randomize button in the workshop).

Official trace: rounds 0-10,000 of tiny.world x sample.ant match the task's own dump line for line (`docs/TRACE.md`). Level 3 (the structured script) is in `docs/SCRIPT.md`. Not yet: skills beyond the trail kit, the Academy UI.
