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
* `wander` is the reference's skill (1/3 left, 1/3 right, 1/3 step). `explore` is a persistent walk: it turns 1 step in 64
  (`explore N` sets it, N from 2 to 64; `explore 5` was the original). Exploration quality is the biggest lever: `docs/EXPLORE.md`,
  `docs/TRAILS.md`.

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

*The table below was measured with `explore 5`; with the new default every personality that explores forages faster (`docs/EXPLORE.md`).*

A template, three sliders and an optional role mix generate a rules program. The workshop shows them under each editor:
moving a control rewrites the text; once the text is edited by hand the controls grey out until "Reset to template" (the
text starts with a `# personality:` line that lets the controls come back, and only while the text is exactly what the
generator wrote).

* Templates: **Forager** (no trails, carries home by luck), **Trail-layer** (the trail kit, i.e. `ants/trail.rules`),
  **Guard** (walks around inside the nest and sits on food, so nobody can stand there to take it; bold or fierce guards also leave
  their post for foes in view), **Raider** (trail-layer that also heads for foe nests), **Keeper** (trail-layer whose carriers, after two free
  deliveries, settle on their pile 1 time in 10 after each delivery and stay: 689 states; the one archetype that beats the plain
  trail-layer, `docs/STEALING.md`).
* Sliders: **Curiosity** = share of random wandering (`when 1 in N -> wander`, N = 16, 8, 4, 2); **Boldness** = timid (flee
  a foe ahead), indifferent, bold (step toward a foe ahead), fierce (also the sides); carriers never fight; **Sociability** =
  loner, follower, devoted (`follow trail` after / before the food checks), trail templates only.
* Role mix (trail and raider): worker = the template, scout = trail-layer with curiosity 3 that lays but never follows
  trails, guard = the guard; percentages compile to the `mix` flip chain (801 instructions for 70/20/10). The control starts at
  90/10/0 because every share given to guards or scouts measured as a loss (`docs/STEALING.md`).

Measured like everything else (20 worlds, 100,000 rounds, idle opponent; head to head over 80 games, both hills), with the
compiler as it was before the `follow trail` optimization (explorer step 3% slower; the comparisons between rows hold):

| personality | food home, median (min) | worlds with all 480 | rounds to 90% | head to head |
|---|---|---|---|---|
| Forager (defaults) | 110 (42) | 0 | - | - |
| **Trail-layer, curiosity 0 (the default)** | **480 (444)** | **15** | **52,300** | identical to `ants/trail.rules` |
| curiosity 1 / 2 / 3 / 4 | 480 / 480 / 478 / 438 | 12 / 12 / 6 / 3 | 61.9k / 63.4k / 68.7k / 88.7k | |
| sociability loner / follower / devoted (curiosity 1) | 461 / 480 / 478 | 5 / 12 / 9 | 76.4k / 61.9k / 57.0k | |
| boldness fierce (curiosity 1) | 478 (382) | 8 | 65.8k | 33-47 against indifferent |
| 90/10/0 worker/scout mix | - | - | - | 36-44 against the pure trail-layer (`docs/STEALING.md`) |
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
  took 1,261 packets from the raider's nest, more than twice as many, without trying. `docs/STEALING.md` measures why and
  what was tried against it (concealing, guarding, sitting on piles): against the original ant nothing beat the plain trail-layer;
  against the retuned one (`docs/TUNING.md`) a light dose of sitting does (the Keeper), the rest still loses.

## Lint (warnings, never blockers)

shadowed rules (an unconditional rule that cannot fail hides the ones below it), a mood nothing switches to, a mood that
never switches away (a mood that only waits is a deliberate rest and is not reported), a program that never picks up or never drops food, a `return home` mood without a nest check, scent
written but never read (or read but never written).

## Results: the kit through the compiler

*Measured with the original explorer (`explore 5`) and a dead end eaten 1 time in 4; the defaults are now `explore 64` and always
(`docs/EXPLORE.md`, `docs/TUNING.md`: the trail ant beats the original 73-0-7).*

`ants/trail.rules` (13 rules, 382 instructions, 239 states) against the hand-written `ants/trail.asm` (204 states);
20 worlds, 100,000 rounds, idle opponent (same protocol as `docs/TRAILS.md`).

| | food home, median (min) | worlds with all 480 | rounds to 50% / 90% | delivered per pickup | stuck carriers per world |
|---|---|---|---|---|---|
| reference page flat starter | 73 (27) | 0 | - | 0.97 | 72 |
| `ants/forager.rules` (level 1, no kit) | 92 (29) | 0 | - | - | - |
| `ants/trail.asm` (hand mod-3 + food trail) | 480 (461) | 18 / 20 | 17,350 / 49,750 | 0.999 | 0.3 |
| **`ants/trail.rules` (compiled)** | **480 (460)** | **14 / 20** | **18,500 / 50,700** | 0.998 | 0.5 |

* **The gap is small**: the compiled program reaches 50% of the food within 7% of the hand-written one's time and 90% about 2%
  later (the figures above are after the `follow trail` optimization below; 20 worlds is noisy, about +-5%); it completes 14
  worlds against 18. Before that optimization it won 26 of 80 games against the hand ant (food is shared, so a few percent
  of speed decides more than it earns alone).
* **The level-1 forager** (6 rules, no kit) scores like the reference's starter, which also checks that the semantics
  above match the reference's: a failed `move` falls through to the next rule.
* One design lesson: the first version of `return home` simply failed when blocked or lost and left the rest to
  `otherwise roam`. Every blocked carrier then wandered off the trail: twice as many stuck carriers (1.2 against 0.6 per world) and 20 wins in 80
  head to head (26 now). The
  skill now retries, sidesteps and feels around itself, so rule authors cannot get it wrong.
* **Explain why** (`--fire-counts`): in `trail.rules` 30% of all acting rounds go to `follow trail` (it is tried every step
  by every searching ant), 23% to `explore`, 17% to `return home`; the four food checks cost 6% each.

### Optimizing `follow trail`

Where its rounds went (3 worlds, 30,000 rounds): about 232k evaluations, half of them *on* a food-trail cell (the nest area
is dense with trail), each costing a sense of the cell, a read of the cell's code (1-3 senses) and the checks ahead, left and
right. The reorder: the common off-trail case now costs two senses (is the cell under me on the trail, is one ahead) and only
a trail cell ahead triggers the code read that checks it leads away from the nest.

| `trail.rules` | follow trail, rounds per explorer step | explorer step | carrier step |
|---|---|---|---|
| before | 6.01 | 28.39 | 21.98 |
| **reordered (shipped)** | **5.10** | **27.50** | 22.08 |
| also joining from left-ahead / right-ahead | - | 28.68 | 22.05 |
| hand-written `trail.asm` | - | 25.57 | 21.95 |

* The reorder saves 0.9 rounds per explorer step (3%); the food results are within the noise of 20 worlds (14/20 complete,
  90% at 50.7k rounds, against 15/20 and 52.3k).
* Joining a trail from the sides costs more than it finds (12/20 worlds, 90% at 55.4k): rejected.
* What is left of the 1.9-round gap to the hand-written ant is the stateless design: `step` and `follow trail` each read the
  code under the ant (about 2 rounds), which the hand ant knows from its pc. Removing it means putting the 3 trail phases in
  the pc (3 copies of every mood); it was not worth the complexity for about 9% per step. **Decided against, for good:** the food
  gap to the hand ant was about 2% at 90% of the food, and the Keeper (1,111 instructions) times three is about 3,300, past the
  2,000-instruction limit, so the gain would be unreachable for the best ant anyway.
* Tests (`test/lang.test.ts`) pin the behaviour on hand-marked corridors, so a later rewrite can be checked against it:
  walks outwards and eats the dead end, ignores a trail that leads toward the nest, joins one that leads away.

## In the workshop

Either brain box accepts rules (detected by the first real line: `when`, `always`, `otherwise`, `mood` or `kit`), flat
assembly or official `.ant`. Under each editor a note shows the size, the lint warnings or the error with its line number
(live, 250 ms after the last key). Two rules examples are in the "load example" menu. **Explain why** (tick "count which rule
each ant acts in") makes the Worker attribute every acting ant-round to a rule's test or action; the panel shows the
shares as bars. Counting does not change the match (same state hash) but runs about 3x slower, so it is off by default.
Share links carry rules text like any other brain.

**Follow one ant.** Click an ant on the board: it gets a yellow ring and the "Selected ant" panel shows where it is, the rule
it is about to run (test or action) highlighted, and a trace of its recent acting rounds, newest first, consecutive rounds in
the same rule collapsed (`r1522-1544 x9 search: otherwise explore (action)`). The trace is kept by the Worker (about 400 rounds,
one entry per round the ant is not resting after a move) and does not change the match. It reads straight off the program
counter, so it works for assembly and `.ant` brains too (it then names the source line). **Jumping:** clicking a trace row, an
explain row, the "next:" line, or a lint warning or error with a line number selects that line in the editor; the explain
row of the followed ant's current rule is highlighted. Reading a trace shows exactly where an ant's rounds go: in
`trail.rules` a step is four food tests, two rounds of `follow trail` and then `explore`.

## Not done

Skills beyond the trail kit (level 3 is in `docs/SCRIPT.md`), balanced Raider and Guard archetypes, the Academy
UI, and syntax colouring inside the text box (a textarea cannot colour part of its text; the rule rows and the trace do the
explaining instead). The compiler is the part those layers sit on; `compileRules` returns the source map (`ruleAt`).
