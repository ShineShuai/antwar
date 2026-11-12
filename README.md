# Core of the ant-colony programming game (name open)

Deterministic ant-colony simulator in strict TypeScript. Node 22.18+ runs the `.ts` sources
directly (type stripping); one `tsc` emit writes unbundled ES modules for the browser to `dist/`. MIT licence.
Spec: `docs/ant-sim-reference.html`.

    npm install                  # typescript, @types/node
    npm test                     # 4 strict typechecks (core/web/worker/node) + lint-core + node --test
    npm run build                # tsc emit (rewriteRelativeImportExtensions) -> dist/
    npm start                    # build, then serve http://localhost:8080/
    node cli/run.ts --map test/fixtures/tiny.world --ant test/fixtures/starter.ant --rounds 10000

- `src/core/types.ts`  shared types; branded `Cell` / `AntId` stop index mix-ups at compile time
- `src/core/rng.ts`    ICFP 2004 generator (matches the official x0..x99 for s0 = 12345)
- `src/core/asm.ts`    `assemble()` flat `.asm` with labels; `parseIcfp()` official `.ant`; `loadBrain()`
- `src/core/map.ts`    `parseMap()` / `formatMap()` official world files
- `src/core/gen.ts`    `generateWorld(seed)`: Classic contest world (spec 3.1); `node cli/gen.ts SEED`
- `src/core/seed.ts`   `dailySeed(date)` = hash of the UTC date string (the client supplies the date: `web/clock.ts`)
- `src/core/sim.ts`    `createSim()`, canonical state stream `snapshot()`/`restore()`, `hash()` = FNV-1a of it; rulesets `CLASSIC` (the task, exactly) and `TINYMINDS` (carry two,
  direction/payload). v1: two colonies, no scare rule, no drop on blocked move
- `web/`               `workshop.html` + `workshop.ts` (canvas viewer), `sim-worker.ts`, `engine.ts`
- `bench/run.ts`      `npm run bench`: rounds/s and ns per ant-round for four workloads
- `scripts/lint-core.ts`  core/ is integer-only: no `/`, Math.random, Date or float literals
- `oracle/ref.py`     second implementation in Python (stdlib only), written from the reference text; `test/crosscheck.test.ts` compares state hashes
- `testlib/ref-sim.ts` literal transliteration of the task pseudo-code: oracle for the fuzz test

Module Workers need http(s): use `npm start`, not file://.
Defaults: Classic rules only in v1, seed 12345 (Randomize button in the workshop).

Not yet: official dump comparison (needs the contest traces), replay/seek,
rules compiler, lint, skills.
