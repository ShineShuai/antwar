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
* Actions: `move` `pickup` `drop` `turn left|right|around|random` `mark N` `unmark N` `switch MOOD` and the skills
  `step` `wander` `explore` (and with kits `return home` `roam` `follow trail` `lay trail`).

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

## Not done

Level 0 (templates, sliders, role mix), level 3 (the structured script language), skills beyond the trail kit, the Academy
UI and in-browser editing. The compiler is the part those layers sit on; `compileRules` returns the source map (`ruleAt`) a
trace or an explain-why panel needs.
