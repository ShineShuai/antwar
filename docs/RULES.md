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

A template, three sliders (a fourth for the Keeper) and an optional role mix generate a rules program. The workshop shows them under each editor:
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
  loner, follower, devoted (`follow trail` after / before the food checks), trail templates only; **Settling** (Keeper only) =
  how readily a carrier settles after a delivery, rarely / seldom / sometimes / often = 1 time in 20, 15, 10, 7. The default is
  sometimes, and its text is the same as before the slider existed (the `# personality:` line only carries `settling=N` when
  it is not the default). Against the shipped Keeper (`docs/STEALING.md`) 1 in 15 loses 58-102 and 1 in 20 loses 21-58, and the cliff
  lies between 1 in 7 and 1 in 5. Sitters at the end of a game on seed 1, rarely to often: 13, 18, 30, 30 of 91.
  **The dose follows the colonies.** That tuning is for two colonies. With three the same Keeper comes last against two trail ants and 1 in 40
  comes first (`docs/STEALING.md`, *The Keeper in 3 colonies*), while in two colonies 1 in 40 loses to 1 in 10. So a Keeper can be *made for*
  three or more colonies: `colonies=N` (3 to 26) in the `# personality:` line, `--colonies N` in `cli/personality.ts`, and it settles
  1 in 40 (`SETTLE_MANY`); a Keeper made for two colonies has no `colonies` and its text is exactly what it always was (tested byte for byte).
  A settling level and `colonies` do not go together (the level decides), and no other template has it. In the workshop a Keeper you pick
  on a map with three or more colonies is made for them; a Keeper you already have gets a one-line tip with a button when the map has three
  or more (and the other way round when it goes back to two): the text is never changed behind your back, because a text is what you play.
* Role mix (trail and raider): worker = the template, scout = trail-layer with curiosity 3 that lays but never follows
  trails, guard = the guard; percentages compile to the `mix` flip chain (801 instructions for 70/20/10). The control starts at
  90/10/0 because every share given to guards or scouts measured as a loss (`docs/STEALING.md`).

Measured like everything else (20 worlds, 100,000 rounds, idle opponent, medians average the middle two; head to head over 80 games,
both hills) and **re-measured with the defaults of `docs/TUNING.md`** (explore 64, a dead end always eaten); the first version of this
table was measured with explore 5 and is replaced:

| personality | food home, median (min) | worlds with all 480 | rounds to 90% | head to head |
|---|---|---|---|---|
| Forager (defaults) | 94.5 (43) | 0 | - | - |
| **Trail-layer, curiosity 0 (the default)** | **480 (480)** | **20** | **31,350** | identical to `ants/trail.rules` |
| curiosity 1 / 2 / 3 / 4 | 480 / 480 / 480 / 478.5 | 19 / 19 / 20 / 9 | 35.2k / 38.8k / 46.9k / 68.0k (18 worlds) | |
| sociability loner / follower / devoted (curiosity 1) | 480 / 480 / 480 | 20 / 19 / 19 | 48.0k / 35.2k / 35.9k | |
| boldness fierce (curiosity 1) | 480 (479) | 19 | 42.6k | 11-0-69 against indifferent |
| 90/10/0 worker/scout mix | - | - | - | 36-44 against the pure trail-layer (`docs/STEALING.md`) |
| Raider (curiosity 0, devoted) | 480 (476) | 18 | 40.2k | **6-74** against the trail-layer (`docs/STEALING.md`) |
| Guard | 0 | 0 | - | - |

* The generator at curiosity 0 reproduces `trail.rules` exactly (the compiled programs are identical, checked), so the template is the
  hand-tuned ant, not a lookalike.
* **The sliders are real trade-offs, and monotonic**: more curiosity costs foraging speed (90% of the food at 31k rounds
  focused, 68k wild); a loner is slower than a follower (48.0k against 35.2k). On these worlds, with all the food on the map, curiosity never pays.
* **The other archetypes are not balanced** and were not tuned: the food race rewards speed, so aggression, guards and
  a mix of idle ants all lose to the plain trail-layer. The raider loses 6-74 although it never dies (91 ants alive)
  and its raids work: over 5 worlds (measured with the original kit) it took 538 packets from the foe nest and 96% of them reached its
  own nest. But **food at a nest is not safe**: every `food ... and not home ...` rule also picks up food from the *foe's* nest, so the
  trail-layer took 1,261 packets from the raider's nest, more than twice as many, without trying. `docs/STEALING.md` measures why and
  what was tried against it (concealing, guarding, sitting on piles): against the original ant nothing beat the plain trail-layer;
  against the retuned one (`docs/TUNING.md`) a light dose of sitting does (the Keeper), the rest still loses.

## Lint (warnings, never blockers)

shadowed rules (an unconditional rule that cannot fail hides the ones below it), a mood nothing switches to, a mood that
never switches away (a mood that only waits is a deliberate rest and is not reported), a program that never picks up or never drops food, a `return home` mood without a nest check, scent
written but never read (or read but never written).

## Results: the kit through the compiler

*Re-measured with the defaults of `docs/TUNING.md` (`explore 64`, a dead end always eaten); the first version of this table used `explore 5`
and a dead end eaten 1 time in 4 (`docs/EXPLORE.md`: the trail ant beats the original 73-0-7). The hand-written ants do not depend on
those settings: `trail.asm` gives exactly its old numbers, which also shows that the simulator and these 20 worlds are unchanged.*

`ants/trail.rules` (13 rules, 382 instructions, 239 states) against the hand-written `ants/trail.asm` (204 states);
20 worlds, 100,000 rounds, idle opponent (same protocol as `docs/TRAILS.md`).

| | food home, median (min) | worlds with all 480 | rounds to 50% / 90% | delivered per pickup | stuck carriers per world |
|---|---|---|---|---|---|
| reference page flat starter (from `docs/TRAILS.md`) | 73 (27) | 0 | - | 0.97 | 72 |
| `ants/forager.rules` (level 1, no kit) | 92 (29) | 0 | - | 0.58 | 66 |
| `ants/trail.asm` (hand mod-3 + food trail) | 480 (461) | 18 / 20 | 17,350 / 49,750 | 0.999 | 0.3 |
| **`ants/trail.rules` (compiled)** | **480 (480)** | **20 / 20** | **12,950 / 31,350** | 1.000 | 0.0 |

* **The compiled ant is now ahead of the hand-written one**: it reaches 50% of the food in 12,950 rounds against 17,350 and 90% in
  31,350 against 49,750, and completes all 20 worlds against 18. Head to head it wins 65-0-15 against `trail.asm` (31-9 and 34-6 on the
  two hills) and 53-0-27 against the best hand-written ant, the breadcrumb ant `crumb.asm` (`docs/TRAILS.md`). With the first kit it
  was a few percent slower than the hand ant and won 26 of 80 games.
* **The level-1 forager** (6 rules, no kit) scores like the reference's starter, which also checks that the semantics
  above match the reference's: a failed `move` falls through to the next rule.
* One design lesson: the first version of `return home` simply failed when blocked or lost and left the rest to
  `otherwise roam`. Every blocked carrier then wandered off the trail: twice as many stuck carriers (1.2 against 0.6 per world) and 20 wins in 80
  head to head (26 now). The
  skill now retries, sidesteps and feels around itself, so rule authors cannot get it wrong (26 wins in 80 then; 65 against the hand ant now).
* **Explain why** (`--fire-counts`): in `trail.rules` 25% of all acting rounds go to `follow trail` (it is tried every step
  by every searching ant), 28% to `explore`, 15% to `return home`; the four food checks cost about 7% each (it was 30 / 23 / 17 and 6% with
  `explore 5`).

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

**Debugger.** Under the followed ant the panel lists what it senses where it stands: *here*, *ahead*, *left ahead* and *right ahead*, each
with its rock, hill (and whether it is the ant's own), food, its own scents and a foe's, and any other ant (`web/inspect.ts`,
`senses`). For a rules brain a **break** is offered: pick a rule and *Run to break*, and the match runs until that ant is about to run
the rule (the replay engine stops before the round, so the "next:" line shows the rule). The first round of a run is always made, so
pressing it again goes on to the next time. The break counts the ant's acting rounds only (not the rounds it rests after a move), and
`explain` keeps counting while it runs.

**Heat map.** Every rule row of the explain panel, and every colony header, has a **map** button: the board is tinted where that colony's
ants were in that rule (its test or its action), or, for the colony's button, wherever its ants acted. The tint grows with the count
(square root, up to the hottest cell, whose count the note above the rows gives). The cells add up to the rule's row counts (a tested
invariant), counting restarts at a seek, a Reset or a change of target, and it only counts rounds run with the explain box ticked.
It answers "where on the map does this rule happen?": where food is taken, where an ant keeps trying a rule that cannot work, where
the traffic is. Both tools are in the replay engine's protocol (`heat`, `until`), so they are tested without a page.

**Versions and diff.** Under each editor, *Versions* keeps the brain's history in the browser (`web/versions.ts`, up to 30 per editor
and 2 MiB in all, the oldest go). A version is saved when you press *Save version* (with an optional label), when you start a match with a
brain that changed, ten seconds after you stop typing, and just before a brain is replaced (by an example, or by *Restore*); the untouched
starter ant and a text equal to the newest version are not saved again. Each version shows how it differs from the text now (+added
-removed lines); **Diff** shows the changed lines with two lines of context (a longest-common-subsequence line diff: a moved line is one
deletion and one addition), **Restore** puts a version back (the text now is saved first, so a restore can be undone), and *compare with*
diffs the editor against another editor. Property tests check that the diff gives back both texts and is minimal.

**More than two colonies.** The colonies of a match are the hills of its map: a generated world has two, a **world file** with hills
`a`, `b`, `c`... brings one editor per hill (Brain C (green), Brain D (amber), ... up to 26, each with its note, examples menu and
personality controls), and the **Example world** menu loads a generated 3, 4, 6 or 8 colony world (`web/colonies.ts`; the hills
are alike but the world is not exactly symmetric, so it is not a fair-match generator), a mirrored 2-colony world, or a fair world
for 2, 3, 4, 6 or 8 colonies. The picker shows what the map is. The number of colonies is not a Rules choice: any Rules plays any number of
colonies. A new seed or Randomize makes the mirrored and fair worlds again from the seed; any other map gives way to the contest
world of the seed (two colonies). Each
colony has its own colour and scent line on the board; the status line lists every score and, at round 100,000, shows
the ranking of docs/MATCH.md (the reference defines none for more than two; this is a proposal). Share links carry all brains. Added colonies
start as the starter ant, and last session's brains for C.. come back when the map does. Checked by `test/colonies.test.ts`
and, once by hand, by running the real page in jsdom (with an in-process Worker and a stub canvas) through 3, 6 and 4 colonies
and back to 2: that run is not part of the test suite and no browser was used.

## Not done

Skills beyond the trail kit (level 3 is in `docs/SCRIPT.md`), balanced Raider and Guard archetypes, the Academy
UI, and syntax colouring inside the text box (a textarea cannot colour part of its text; the rule rows and the trace do the
explaining instead). The compiler is the part those layers sit on; `compileRules` returns the source map (`ruleAt`).
