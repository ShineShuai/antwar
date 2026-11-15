# Rules compiler (levels 1-2 of the reference's Easy authoring)

`src/lang/` compiles ordered rules grouped into moods to flat assembly (`src/core/asm.ts`) and from there to the IR.
`node cli/rc.ts FILE.rules` prints size and lint warnings, `--asm` the assembly, `--fire-counts` where the ant-rounds go.
`node cli/eval.ts --ant FILE.rules` measures a program like any other brain.

## Language

    # comment
    kit trail                  # optional kits: trail (markers 0-2), foodtrail (marker 3, needs trail)
    mood search                # a mood is a named rule list; the first mood is the start mood
      when food ahead and not home ahead -> step
      always -> follow trail   # no condition, can still fail
      otherwise explore        # last rule of a mood

* A rule is `when <cond> [and <cond>]* -> <action>[, <action>]*` (`->`, `→`, `do` or `then`); `always` has no condition;
  `otherwise` is `always` and must be last. Rules before any `mood` line form the mood `main`.
* Condition: `[not] <what> <where>`; what = `food rock foe friend home`, `foe home`, `marker N`, `foe marker`,
  `foe carrying`, `friend carrying`; where = `here ahead left ahead right ahead`. `carrying` alone means this ant holds food.
  `1 in N` (N from 2 to 64) is true one time in N (it costs a round, like a sense).
* Actions: `move` `pickup` `drop` `wait` `turn left|right|around|random` `mark N` `unmark N` `switch MOOD` and the skills
  `step` `wander` `explore` (and with kits `return home` `roam` `follow trail` `lay trail`). `wait` spends a round and changes nothing.
* `mix worker 70, scout 20, guard 10` (weights up to 100 parts after dividing out the common factor) replaces "the first mood
  is the start mood": a flip chain at program entry sends each newborn ant into one of those moods, and nothing ever jumps
  back to it, so an ant keeps its role for life (ants have no ids, so roles must be random at birth).

## Semantics (as in the reference)

* Every round an ant evaluates its mood's rules from the top; the first rule whose conditions hold fires.
  A rule costs one round per `sense` it executes plus one per action; `switch` and the final jump back are free.
* If an action fails (`move` blocked, `pickup` with nothing to take, a skill that cannot act) evaluation continues with the
  **next rule**; what the rule already did persists (a `turn` before a blocked `move` stays turned).
* `step` `wander` `explore` `roam` `return home` `follow trail` `switch` end the rule and must be its last action.
* `wander` is the reference's skill (1/3 left, 1/3 right, 1/3 step). `explore` is a persistent walk (turn 1 step in 5):
  see `docs/TRAILS.md`, exploration quality is the biggest lever.

## The trail kit

* `kit trail` reserves markers 0-2 (a one-hot code: steps from the nest mod 3). `step` (and `explore`, `wander`) read the
  code under the ant, move, and write code+1 on the new cell if it is uncoded. `return home` steps to the visible neighbour
  with code-1. `kit foodtrail` reserves marker 3: `lay trail` marks a cell, `return home` marks every cell it walks, and
  `follow trail` takes an empty ant outwards along it.
* Both skills carry the two anti-jam rules of `docs/TRAILS.md` (followers yield when blocked; a blocked carrier retries and
  1 time in 4 sidesteps) and `return home` feels around by itself when the cell has no code. It fails only at the nest edge
  (a code here but no previous code in sight): put the `home ahead / left ahead / right ahead` rules after it.
* The kit actions are **stateless**: each re-reads the code under the ant, so nothing but the pc is remembered and the
  rules themselves need no copies. The price is about 3 senses per step.
* Using a reserved marker in your own rules is an error.

## Level 0: personalities (`src/lang/templates.ts`, `node cli/personality.ts`)

A template, three sliders and an optional role mix generate a rules program. The workshop shows them under each editor:
moving a control rewrites the text; once the text is edited by hand the controls grey out until "Reset to template" (the
text starts with a `# personality:` line that lets the controls come back, and only while the text is exactly what the
generator wrote).

* Templates: **Forager** (no trails, carries home by luck), **Trail-layer** (the trail kit, i.e. `ants/trail.rules`),
  **Guard** (stands still, fights foes in view), **Raider** (trail-layer that also heads for foe nests).
* Sliders: **Curiosity** = share of random wandering (`when 1 in N -> wander`, N = 16, 8, 4, 2); **Boldness** = timid (flee
  a foe ahead), indifferent, bold (step toward a foe ahead), fierce (also the sides); carriers never fight; **Sociability** =
  loner, follower, devoted (`follow trail` after / before the food checks), trail templates only.
* Role mix (trail and raider): worker = the template, scout = trail-layer with curiosity 3 that lays but never follows
  trails, guard = the guard; percentages compile to the `mix` flip chain. 911 instructions for a 3-role program.

Measured like everything else (20 worlds, 100,000 rounds, idle opponent; head to head over 80 games, both hills):

| personality | food home, median (min) | worlds with all 480 | rounds to 90% | head to head |
|---|---|---|---|---|
| Forager (defaults) | 110 (42) | 0 | - | - |
| **Trail-layer, curiosity 0 (the default)** | **480 (444)** | **15** | **52,300** | identical to `ants/trail.rules` |
| curiosity 1 / 2 / 3 / 4 | 480 / 480 / 478 / 438 | 12 / 12 / 6 / 3 | 61.9k / 63.4k / 68.7k / 88.7k | |
| sociability loner / follower / devoted (curiosity 1) | 461 / 480 / 478 | 5 / 12 / 9 | 76.4k / 61.9k / 57.0k | |
| boldness fierce (curiosity 1) | 478 (382) | 8 | 65.8k | 33-47 against indifferent |
| 70/20/10 worker/scout/guard mix | 472 (413) | 7 | 67.6k | 27-53 against the pure trail-layer |
| Raider (curiosity 0, devoted) | 476 (447) | 5 | 62.3k | **0-80** against the trail-layer |
| Guard | 0 | 0 | - | - |

* The generator at curiosity 0 reproduces `trail.rules` exactly (same worlds, same numbers), so the template is the
  hand-tuned ant, not a lookalike.
* **The sliders are real trade-offs, and monotonic**: more curiosity costs foraging speed (90% of the food at 52k rounds
  focused, 89k wild); a loner is slower than a follower. On these worlds, with all the food on the map, curiosity never pays.
* **The other archetypes are not balanced** and were not tuned: the food race rewards speed, so aggression, guards and
  a mix of idle ants all lose to the plain trail-layer. The raider loses every game although it never dies (91 ants alive)
  and its raids work: over 5 worlds it took 538 packets from the foe nest and 96% of them reached its own nest. But **food
  at a nest is not safe**: every `food ... and not home ...` rule also picks up food from the *foe's* nest, so the trail-layer
  took 1,261 packets from the raider's nest, more than twice as many, without trying. Any colony that keeps a big stash
  is raided by everyone; a raider that pays needs to hold less at home or defend it.

## Lint (warnings, never blockers)

shadowed rules (an unconditional rule that cannot fail hides the ones below it), a mood nothing switches to, a mood that
never switches away, a program that never picks up or never drops food, a `return home` mood without a nest check, scent
written but never read (or read but never written).

## Results: the kit through the compiler

`ants/trail.rules` (13 rules, 382 instructions, 243 states) against the hand-written `ants/trail.asm` (204 states);
20 worlds, 100,000 rounds, idle opponent (same protocol as `docs/TRAILS.md`).

| | food home, median (min) | worlds with all 480 | rounds to 50% / 90% | delivered per pickup | stuck carriers per world |
|---|---|---|---|---|---|
| reference page flat starter | 73 (27) | 0 | - | 0.97 | 72 |
| `ants/forager.rules` (level 1, no kit) | 92 (29) | 0 | - | - | - |
| `ants/trail.asm` (hand mod-3 + food trail) | 480 (461) | 18 / 20 | 17,350 / 49,750 | 0.999 | 0.3 |
| **`ants/trail.rules` (compiled)** | **480 (444)** | **15 / 20** | **17,600 / 52,300** | 0.996 | 0.6 |

* **The gap is small**: the compiled program reaches 50% of the food as fast as the hand-written one and 90% about 5%
  later; it completes 15 worlds against 18. Head to head it wins 26 of 80 games against the hand ant (food is shared, so
  a few percent of speed decides more than it earns alone).
* **The level-1 forager** (6 rules, no kit) scores like the reference's starter, which also checks that the semantics
  above match the reference's: a failed `move` falls through to the next rule.
* One design lesson: the first version of `return home` simply failed when blocked or lost and left the rest to
  `otherwise roam`. Every blocked carrier then wandered off the trail: twice as many stuck carriers (1.2 against 0.6 per world) and 20 wins in 80
  head to head (26 now). The
  skill now retries, sidesteps and feels around itself, so rule authors cannot get it wrong.
* **Explain why** (`--fire-counts`): in `trail.rules` 30% of all acting rounds go to `follow trail` (it is tried every round
  by every searching ant and usually fails after sensing), 28% to `explore`, 14% to `return home`; the four food checks
  cost 6% each. The biggest saving for a rule author is reordering or rationing `follow trail`.

## In the workshop

Either brain box accepts rules (detected by the first real line: `when`, `always`, `otherwise`, `mood` or `kit`), flat
assembly or official `.ant`. Under each editor a note shows the size, the lint warnings or the error with its line number
(live, 250 ms after the last key). Two rules examples are in the "load example" menu. **Explain why** (tick "count which rule
each ant acts in") makes the Worker attribute every acting ant-round to a rule's test or action; the panel shows the
shares as bars. Counting does not change the match (same state hash) but runs about 3x slower, so it is off by default.
Share links carry rules text like any other brain.

## Not done

Level 3 (the structured script language), skills beyond the trail kit, balanced Raider and Guard archetypes, the Academy
UI, and rule-level editing aids (highlighting, a rule list you can drag, a per-ant trace). The compiler is the part those
layers sit on; `compileRules` returns the source map (`ruleAt`) a trace needs.
