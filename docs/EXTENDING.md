# Extending the rules

Classic (the ICFP 2004 task) is the only ruleset the clients offer in v1. Every extra rule is meant to be added
later without touching the rest. The mechanism: a **ruleset** is a named bundle of flags (`src/core/rules.ts`);
a flag the simulator cannot honour yet is **rejected** (`unsupported()`), never ignored; each flag plugs in at a
`VARIATION POINT` comment in `src/core/sim.ts`.

| Flag (Classic value) | Variation point in `sim.ts` | Status |
|---|---|---|
| `cap` (1) | `OP.PICKUP` capacity check | implemented |
| `ext` (false) | assembler gate (`FLAT_OPS[].ext`) + `OP.DIRECTION` / `OP.PAYLOAD` / `OP.SENSEANY` | implemented |
| `scareThreshold` (0 = off) | `check()` after the kill test | rejected until implemented |
| `dropOnBlocked` (false) | `OP.MOVE` failure branch | rejected until implemented |
| `maxColonies` (2) | colony-count check; `foemarker`, scoring and order need an N-colony review | rejected until implemented |
| `altOrder` (false) | `step()` loop order | rejected until implemented |

## Adding a rule (checklist)
1. Add or reuse the flag in `Rules` (`src/core/types.ts`), give it a Classic default in `rules.ts` and a row in
   `unsupported()` until it is implemented. Add a named ruleset if it is a bundle (`RULESETS`).
2. Implement it at its variation point in `src/core/sim.ts`; remove the flag from `unsupported()`.
3. Mirror it in `oracle/ref.py` (`RULESETS`, `IMPLEMENTED` and the step code). Write it from the reference text.
4. Add micro-tests to `spec/micro-tests.json` with `"rules": "<id>"`, expected values worked out by hand
   (the Python runner skips rulesets it does not know, so write the test first).
5. Add the ruleset to the cross-check in `test/crosscheck.test.ts`.
6. Update the reference (Rulesets, Combat or Semantics tab) and, for the web app, the ruleset picker, par and
   boss tables (they are per ruleset id) and the replay descriptor's `rules` field.

## Adding an instruction
1. `src/core/isa.ts`: an opcode and a `FLAT_OPS` row (name, else-part, arity, whether it needs `ext`).
2. `src/core/asm.ts`: parse its arguments (flat form) and, if it exists in the official format, `parseIcfp`.
3. `src/core/sim.ts`: execute it in `stepAnt`. `oracle/ref.py`: the same.
4. Micro-tests, a line in the reference's instruction table, and a generator entry in `testlib/random.ts`.

`goto` is the one instruction that does not reach the simulator: the assembler resolves it (zero cost) and
rejects a cycle made only of gotos.
