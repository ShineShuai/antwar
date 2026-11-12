# Tinyminds core

Deterministic ant-colony simulator: pure ES modules (no build step, no dependencies), runs
unchanged in a browser Worker and in Node. Spec: `docs/ant-sim-reference.html`.

    npm test                                  # unit tests + differential fuzz vs the spec-literal reference
    node cli/run.js --map test/fixtures/tiny.world --ant test/fixtures/starter.ant --rounds 10000

- `src/core/rng.js`  ICFP 2004 generator (verified against the official x0..x99, s0 = 12345)
- `src/core/asm.js`  `assemble()` flat `.asm` with labels; `parseIcfp()` official `.ant`
- `src/core/map.js`  `parseMap()` official world files (+/-, a-z hills, 1-9 food)
- `src/core/hex.js`  hex geometry (spec `adjacent_cell`, disks)
- `src/core/gen.js`  `generateWorld(seed)`: Classic contest world (spec 3.1); `node cli/gen.js SEED`
- `src/core/sim.js`  `createSim()`; rulesets `CLASSIC` (the task, exactly) and `TINYMINDS` (flags)
- `testlib/ref-sim.js`  literal transliteration of the task pseudo-code; the oracle for fuzzing

Not yet: official dump comparison (needs the contest traces), Worker/viewer,
rules compiler, lint, skills. Default seed is 12345 (the official dump seed).
