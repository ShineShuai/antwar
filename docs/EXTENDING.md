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
5. `src/lang/highlight.ts`: a colour for the new word in each language that has it (assembly, and the rules or script word if one is added).
   `test/highlight.test.ts` fails until every word of every language is coloured.

`goto` is the one instruction that does not reach the simulator: the assembler resolves it (zero cost) and
rejects a cycle made only of gotos.

## Rulesets and flags (all implemented)

`src/core/rules.ts` is a registry of named bundles. `classic` is the contest. Each flag below plugs in at a `VARIATION POINT`
in `src/core/sim.ts`, is mirrored in `oracle/ref.py`, has hand-worked cases in `spec/micro-tests.json`, and is cross-checked on
random programs (`test/crosscheck.test.ts`; each flag must change a good share of the matches, so the check cannot be vacuous).

| flag | ruleset ids | meaning | checked against |
|---|---|---|---|
| `cap` 2 | `cap2`, `dropfail`, `tinyminds` | an ant carries up to 2 packets | Python oracle, reference demo (CAP), micro-tests |
| `dropOnBlocked` | `dropfail`, `tinyminds` | a blocked mover carrying exactly 2 drops 1 packet here and keeps 1 | Python oracle, reference demo (DF), micro-tests |
| `scareThreshold` 4 | `scare4`, `tinyminds` | an ant with exactly 4 foe neighbours drops its food and survives (5 still kills) | Python oracle, reference demo (SC), micro-tests incl. 3 foes / threshold 3 |
| `altOrder` | `altorder`, `tinyminds` | odd rounds run ants in ascending id order, even rounds descending | Python oracle, reference demo (AO), micro-tests |
| `maxColonies` up to 26 | `colonies`, `tinyminds` | more than two colonies (hills a..z) | Python oracle, reference demo (3 colonies, marks and foemarker), micro-tests |
| `ext` | `tinyminds` | direction / payload / senseany / senseall instructions | reference demo (direction and payload), unit tests (the oracle reads official `.ant` only) |

**Decision for the owner of the reference:** the reference says only that `altorder` "would alternate" who acts first. The reading
implemented is *alternate the direction of the id order each round* (round 1 ascending as in Classic). If you mean something else
(for instance alternate which colony goes first), change `step()` in sim.ts and `run_round` in oracle/ref.py and the three
`altorder` micro-tests. The reading is now written into the reference (the Rulesets card and "Order bias") and the demo in `reference.html`
implements it independently (`test/refdemo.test.ts` compares it with the core round by round), so the implementations agree on it; they would
agree on a wrong reading too, so it stays the owner's decision.
Measured effect (`docs/MATCH.md`, 500 symmetric seeds, the Keeper on both hills): first colony 52.5% of decided games in Classic order, 51.1% with `altorder`; neither is distinguishable from 50% at this size.
`unsupported()` now only rejects values outside the spec: `cap` not 1 or 2, `scareThreshold` not 0..4, `maxColonies` not 1..26.

The workshop's **Rules** menu runs any of these ids (both colonies, saved and shared); `node cli/run.ts --rules ID` and
`python3 oracle/ref.py --rules ID` do the same from the command line. Single-flag ids exist for experiments and tests.
