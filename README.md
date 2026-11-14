# Core of the ant-colony programming game (name open)

Deterministic ant-colony simulator in strict TypeScript. Node 22.18+ runs the `.ts` sources
directly (type stripping); one `tsc` emit writes unbundled ES modules for the browser to `dist/`. MIT licence.
Spec: `reference.html`.

    npm install                  # typescript, @types/node
    npm test                     # 4 strict typechecks (core/web/worker/node) + lint-core + node --test
    npm run build                # tsc emit (rewriteRelativeImportExtensions) -> dist/ (index.html, reference.html, web/, src/)
    npm run check                # build, then verify every relative URL in dist/ resolves
    npm start                    # build, then serve http://localhost:8080/
    node cli/run.ts --map test/fixtures/tiny.world --ant test/fixtures/starter.ant --rounds 10000

- `src/core/types.ts`  shared types; branded `Cell` / `AntId` stop index mix-ups at compile time
- `src/core/rng.ts`    ICFP 2004 generator (matches the official x0..x99 for s0 = 12345)
- `src/core/asm.ts`    `assemble()` flat `.asm` with labels (`goto` is a zero-cost edge, resolved at load); `parseIcfp()` official `.ant`; `loadBrain()`
- `src/core/map.ts`    `parseMap()` / `formatMap()` official world files
- `src/core/gen.ts`    `generateWorld(seed)`: Classic contest world (spec 3.1); `node cli/gen.ts SEED`
- `src/core/isa.ts`    the instruction table; `src/core/rules.ts` the rulesets registry (see `docs/EXTENDING.md`)
- `src/core/seed.ts`   `dailySeed(date)` = hash of the UTC date string (the client supplies the date: `web/clock.ts`)
- `src/core/sim.ts`    `createSim()`, canonical state stream `snapshot()`/`restore()`, `hash()` = FNV-1a of it; rulesets `CLASSIC` (the task, exactly) and `TINYMINDS` (carry two,
  direction/payload). v1: two colonies, no scare rule, no drop on blocked move
- `web/`               `workshop.html` + `workshop.ts` (canvas viewer), `sim-worker.ts`, `engine.ts`
- `cli/eval.ts`       `npm run eval -- --ant FILE`: food home, time to 25/50/90%, carrier statistics over generated worlds; `--vs` plays two brains
- `ants/`             hand-designed trail ants (generators + generated `.asm`); results and design in `docs/TRAILS.md`
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

All URLs are relative, so a project site works. In the workshop, **Copy link** puts both brains and the seed in the
URL fragment (never sent to a server); anyone opening it gets the same match. Edits are also kept in the browser's
local storage.
Defaults: Classic rules only in v1, seed 12345 (Randomize button in the workshop).

Not yet: official dump comparison (needs the contest traces), replay/seek,
rules compiler, lint, skills.
