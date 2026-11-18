# Fixtures

- `tiny.world`: the ICFP 2004 task's tiny world (byte-identical to the official file: `test/official.test.ts` checks it when the
  official trace is downloaded). `starter.ant`: the 16-state example ant printed in the task text, **not** the official
  `sample.ant` (400 states, the one the official trace was made with; it is fetched, not committed: `docs/TRACE.md`).
  Redistribution terms of both files are **not yet checked**: verify them or replace both files before publishing.
- `rng12345.json`: x0..x99 for s0 = 12345 (the official vector, reproduced by `src/core/rng.ts`).
- `rng99999.json`: x0..x99 for s0 = 99999, the reference page's own demo seed (copied from `reference.html`, RNG tab).
