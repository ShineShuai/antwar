# Nest stealing (measured)

A pick-up works on any cell that holds food, a nest included, and any ant can stand on any free cell. So the food a colony
delivers is a stash that anyone can take, one packet per visit to its cell. `node cli/eval.ts --vs OTHER` counts it:
`stole` = packets this colony picked up on the other colony's nest cells, `lost` = the other way round.

The study was run twice. **Round 1** (below, "Against the original trail ant") used the trail-layer as it was before the retuning of
`docs/EXPLORE.md` and `docs/TUNING.md` (explorer turning 1 step in 5, dead end eaten 1 time in 4). **Round 2** repeats it against
the retuned `ants/trail.rules` ("T"), and **one conclusion of round 1 did not survive**: against the faster ant a light dose of
pile-sitting wins, and a version that starts sitting late wins more, and a joint check settled its dose: that is the Keeper template.

Both rounds: the colony under test against T, 80 games (40 worlds, both hills), 100,000 rounds unless noted. W-D-L is for the
colony under test; food is the median nest food at the end; stole / lost are medians per game. 480 packets exist on a world.

## Round 2: against the retuned trail ant

| colony under test | W-D-L | food (it vs T) | stole | lost |
|---|---|---|---|---|
| T (a mirror match) | 40-0-40 | 231 vs 231 | 492 | 492 |
| never takes food from a foe nest | 0-0-80 | 0 vs 480 | 0 | 248 |
| raider template | 6-0-74 | 115 vs 357 | 357 | 465 |
| 10% scouts | 33-0-47 | 203 vs 255 | 470 | 489 |
| 10% / 20% guards roaming the nest | 41-0-39 / 30-1-49 | 249 / 238 vs 233 / 273 | 442 / 357 | 427 / 337 |
| carrier sits on its pile after dropping, 1 in 10 | 15-0-65 | 225 vs 299 | 128 | 71 |
| 1 in 12 | 31-0-49 | 250 vs 274 | 171 | 112 |
| 1 in 15 | 54-0-26 | 284 vs 243 | 242 | 167 |
| 1 in 20 | **57-0-23**; seeds 41-80: **58-1-21** | 282 vs 239 | 288 | 228 |
| 1 in 30 | **57-0-23**; seeds 41-80: **52-0-28** | 287 vs 218 | 354 | 311 |
| 1 in 40 | 45-1-34; seeds 41-80: 54-0-26 | 256 vs 238 | 393 | 369 |
| 1 in 64 | 44-0-36 | 262 vs 221 | 450 | 429 |

"Sits" means: after the delivery the carrier stays on its pile for good (a mood that only waits), with the stated chance per
delivery; the others get on with foraging. The rows are variants generated from `ants/trail.rules`. The next table starts the
sitting late, and that version is the `keeper` template.

What round 2 says:

1. **Findings 1-4 of round 1 stand, with bigger numbers.** The faster ant steals more: each side takes about 490 packets per
   mirror match (333 before). Not stealing is still ruinous (0-80). A stash still cannot be hidden.
2. **Light sitting works; heavy sitting still loses.** A dose-response with a cliff: 1 in 10 and 1 in 12 lose (15-65, 31-49), 1 in 15 to
   1 in 40 win (54-26 to 57-23 on seeds 1-40, 52-28 to 58-21 on fresh seeds 41-80), 1 in 64 fades to a coin flip. The Keeper takes 1 in
   30: pooled over 160 games it is 109-0-51 against T (1 in 20 is 115-1-44, closer to the cliff). Starting late is better still
   (next section).
3. **Where the sitters are.** About a third of the keepers sit by round 100,000 (30 of 91 for the Keeper at 1 in 10, 15-21 at 1 in 15,
   8-23 for 1 in 30 immediate, in idle-opponent games; the
   delivery count per ant is what sets it, and stolen packets are delivered again). The cliff is where the sitters outnumber the
   foragers the colony still needs.
4. **Why it helps now and did not before is not shown.** One guess: the retuned ant finishes foraging by about round 35,000, so most of
   the game is the fight over the stash, which sitters protect; before, foraging lasted most of the game and every sitter was a
   lost forager. It was not tested.
5. **Guards, scouts and raiders still do not beat T**, as in round 1 (10% guards are now level with T instead of clearly worse).

### Starting late (the Keeper)

Ants have no clock, but the program counter can count: the state carries the number of deliveries so far (one search/return pair of
moods per free delivery), and only after K free deliveries does each delivery end in the settle step (stay on the pile for good
with chance 1 in N). Against T, seeds 1-40 (80 games):

| K free deliveries, then 1 in N | W-D-L | food (it vs T) | stole | lost |
|---|---|---|---|---|
| 0, 1 in 30 (the earlier version) | 57-0-23 | 287 vs 218 | 354 | 311 |
| 1, 1 in 30 | 51-0-29 | 271 vs 219 | 390 | 351 |
| 1, 1 in 15 | 51-0-29 | 293 vs 238 | 270 | 217 |
| 2, 1 in 30 | 54-0-26 | 269 vs 220 | 407 | 372 |
| 2, 1 in 15 (the first delayed Keeper) | **62-0-18**; seeds 41-80: **59-0-21** | 296 vs 223 | 319 | 257 |
| **2, 1 in 10 (the Keeper now)** | 61-0-19; seeds 41-80: 57-0-23 | 280 vs 236 | 257 | 200 |
| 3, 1 in 15 | 62-0-18 | 279 vs 213 | 360 | 321 |
| 3, 1 in 10 | 62-0-18 | 281 vs 225 | 308 | 257 |

With a delay of two or three deliveries the colony tolerates a much stronger settle chance (1 in 10-15, where the immediate version
fell off a cliff at 1 in 12), and that is worth about 5 more wins in 80 than the immediate 1 in 30. Against T the delayed doses are
tied (2 free deliveries then 1 in 15: 121-0-39 over 160 games; 1 in 10: 118-0-42). It costs states: 689 and 1,111 instructions
(K = 3 is 913 and 1,471; K = 5 no longer fits the 2,000 limit). The step from K = 0 to K = 1 did not help (51-29), so the gain is not
smooth in K; noise in 80 games is about 4.5 wins.

### Joint check: one change at a time against the Keeper

The explore, eating and sidestep settings were each tuned before the Keeper existed, and the Keeper's dose with them off. Each
alternative below plays the Keeper (explore 64, dead end always eaten, sidestep 1 in 4, 2 free deliveries, 1 in 15) with one
thing changed; 80 games, both hills, seeds 1-40:

| change | W-D-L | food (it vs Keeper) |
|---|---|---|
| explore 1 in 32 | 41-0-39 | 253 vs 254 |
| explore 1 in 16 | 35-0-45 | 237 vs 264 |
| dead end eaten 1 time in 2 | 43-0-37 | 258 vs 255 |
| sidestep 1 in 2 | 44-0-36 | 259 vs 242 |
| sidestep 1 in 8 | 40-1-39 | 255 vs 253 |
| **settle 1 in 10** | **52-0-28**; seeds 41-80: **50-0-30** | 280 vs 241 |
| settle 1 in 7 | 47-0-33 | 262 vs 247 |
| settle 1 in 5 | 30-0-50 | 238 vs 266 |
| 3 free deliveries, settle 1 in 10 | 37-0-43 | 255 vs 262 |

Nothing beats the Keeper by more than noise except the stronger settle chance: **1 in 10 beats 1 in 15 by 102-0-58 over 160
games** and is tied with it against T (57-23 on the fresh seeds against 59-21), so the Keeper settles 1 time in 10. The dose-response is
again a cliff, now between 1 in 7 and 1 in 5. At 1 in 10 about a third of the ants (30 of 91 in idle-opponent games) end up sitting.
The remaining corners (3 free deliveries with 1 in 15, 2 with 1 in 20, wander, roam) are in the next section.

### Corners of the sweep: against the Keeper as shipped

The settings the joint check left open, each playing the shipped Keeper (explore 64, dead end always eaten, sidestep 1 in 4, 2 free
deliveries, settle 1 in 10); 80 games, both hills, seeds 1-40 unless noted. Variants are generated rules text, not compiler changes.

| change | W-D-L | food (it vs Keeper) | stole | lost | stuck carriers per game |
|---|---|---|---|---|---|
| 3 free deliveries, settle 1 in 15 | 24-1-55 | 236 vs 281 | 181 | 232 | 1.8 |
| 2 free deliveries, settle 1 in 20 | 21-1-58 | 228 vs 275 | 177 | 229 | 2.3 |
| curiosity 1 (`when 1 in 16 -> wander` while searching) | 30-1-49 | 245 vs 273 | 167 | 179 | 9.4 |
| `otherwise wander` for `otherwise roam` in the return moods | 47-0-33; seeds 41-80: 40-0-40 | 264 vs 246; 261 vs 253 | 181; 174 | 168; 171 | 15.5; 12.3 |
| (the Keeper against itself, first hill only, 40 games) | 21-1-18 | 266 vs 260 | 176 | 185 | 9.1 |

1. **The Keeper's dose stays.** Both weaker doses lose clearly (24-55, 21-58), although against the plain trail-layer 3 free with 1 in
   15 was as good as the Keeper (62-18 against 61-19). With 102-58 for 1 in 10 over 2 free with 1 in 15, 1 in 10 now beats
   every weaker dose it was played against (1 in 15 and 1 in 20 head to head; 1 in 15 against 1 in 20 was not).
2. **Wandering while searching probably hurts** (30-49; noise is about 4.5 wins): a Keeper that wanders 1 step in 16 loses to one that does not.
3. **`wander` as the carrier's fallback is no gain.** It won 47-33 on seeds 1-40 and tied 40-40 on 41-80: 87-0-73 over 160 games (261 against
   251 food), which is inside the noise (+7 wins over a coin flip, about 1.1 standard deviations). Not adopted.
4. **Stuck carriers** (holding food for more than 5,000 rounds at the end) are 9 per game for the Keeper and 2 for the weaker doses.
   The fallback `wander` raises them to 12-16 without losing games. Whether sitters jam the carriers' way to the nest was not tested, and the
   Keeper figure is one 40-game mirror run.

Not run: combinations (each single change above and in the joint check is inside the noise, so a combination cannot be told apart from the
Keeper in 80 games), curiosity 2 and up (curiosity 1 already loses), and any other fallback for a lost carrier than `wander`.

### A raider squad inside the Keeper colony: tried, worse

The Raider template as a whole loses (6-74 against T), but what about a few dedicated raiders among Keeper workers? Each new ant
becomes a raider with chance 1 in P (a trail-layer that also heads for foe nests, `when foe home ahead -> step` and the two
sides) and a Keeper worker otherwise. Against the Keeper, seeds 1-40 (80 games):

| raiders | W-D-L | food (it vs Keeper) | stole | lost |
|---|---|---|---|---|
| 5% (1 in 20) | 34-0-46 | 255 vs 266 | 182 | 189 |
| 10% (1 in 10) | 25-0-55 | 241 vs 287 | 180 | 196 |

The more raiders, the worse; they take no more than a Keeper colony takes anyway (about 180 each way) and cost the foragers they
were. Dropped; the programs were 990 states and 1,605 instructions. Raiders that stay at the foe's nest rather than return
(camping) are the next section.

### A camper squad inside the Keeper colony: tried, worse

Each new ant becomes a camper with chance 1 in P and a Keeper worker otherwise. A camper takes no food: it explores, follows trails
(a stolen packet's trail leads from the victim's nest out to the thief's own, so trails run both ways), heads for any foe nest cell
in view (`when foe home ahead -> step` and the two sides) and, standing on one, waits there for good (`when foe home here -> wait`).
Against the shipped Keeper, seeds 1-40 (80 games):

| campers | W-D-L | food (it vs Keeper) | stole | lost | alive at the end (median of 91) |
|---|---|---|---|---|---|
| 5% (1 in 20) | 31-0-49 | 238 vs 277 | 157 | 174 | 76 |
| 10% (1 in 10) | 13-0-67 | 215 vs 306 | 136 | 163 | 71 |
| (none: the Keeper against itself, first hill only, 40 games) | 21-1-18 | 266 vs 260 | 176 | 185 | 81 |

The campers do camp: in 6 games with 10% campers (seeds 1-6) 0 to 16 of the colony's ants stood on the foe's nest at rounds 10,000,
30,000 and 100,000 (ants of any kind; mostly 3-12). Camping does not pay: the more campers, the worse, the colony ends with 5-10
fewer ants alive (probably they sit among the foe's ants and are killed; the cause was not checked), and it steals and loses a little
less than a plain Keeper does, as the campers take no food. Whether the campers got in the way of the foe's deliveries was not measured. Dropped; the programs were 855 states and 1,402 instructions.

Limits: generated worlds only; the doses were picked among several on the first 40 seeds and the Keeper's was confirmed on seeds 41-80;
the head-to-head results of different doses come from one family of runs.

## Round 1: against the original trail ant

(The original trail ant: `explore 5`, a dead end eaten 1 time in 4.)

### What happened

| colony under test | W-D-L | food (it vs T) | stole | lost |
|---|---|---|---|---|
| T (a mirror match) | 39-2-39 | 223 vs 223 | 333 | 333 |
| **never takes food from a foe nest** | **0-0-80** | **0 vs 479** | 0 | 236 |
| carriers drop deeper inside the nest | 44-0-36 | 234 vs 216 | 354 | 346 |
| 5 / 10 / 20 / 30% guards roaming the nest, sitting on food | 38-42 / 26-54 / 19-61 / 16-64 | 224 / 202 / 189 / 174 vs 232 / 254 / 288 / 333 | 324 / 298 / 240 / 177 | 323 / 324 / 248 / 146 |
| 1 carrier in 40 / 20 / 10 sits on its pile after dropping | 35-45 / 27-53 / 24-56 | 219 / 216 / 219 vs 240 / 266 / 274 | 298 / 239 / 138 | 302 / 232 / 88 |
| 10 / 20% scouts (no stealing change) | 36-44 / 33-47 | 213 / 208 vs 244 / 246 | 314 / 322 | 334 / 330 |
| raider (heads for foe nests) | 0-80 | 105 vs 365 | 108 | 252 |

The raider row is from 5 worlds (means), the others from 80 games.

### Findings (round 1; 5 and 6 are superseded by round 2)

1. **In a mirror match about 330 of the 480 packets are stolen by each side**: most of the hauling is packets moving
   between the two stashes. The result is close to a coin flip (39-2-39).
2. **Not stealing is ruinous.** A colony that ignores food on the foe's nest ends with nothing: the trail-layer takes 236
   packets from it and leaves it 0 food. The default templates steal by accident (any `food ... and not home ...` rule
   also fires on a foe's nest), and that is why they work.
3. **A stash cannot be hidden: stealing recruits.** 90% of the thefts (676 of 748 over 4 worlds) are made by a thief standing
   on its own colony's food trail: the carrier of the first stolen packet lays a trail from the victim's nest to its own,
   and the next explorers follow it back out. The stash is a rich patch with a trail to it. First thefts happen between
   rounds 675 and 5,600. Dropping deeper inside the nest changes nothing (44-36, 346 lost).
4. **The stash is a few cells.** After 10,000-60,000 rounds the nest food sits on 6-17 cells and the 5 biggest cells hold
   60-100% of it: the cells carriers drop on, which have to be free for carriers to use. Guards that roam the nest and sit on
   food therefore cover only about 15% of the packets (20% guards: 20-34 of 130-250), and every guard is a forager less:
   the more guards, the worse it gets.
5. **Blocking the pile works, and costs more than it saves.** When the ant that has just dropped stays on its pile, the
   packets under it cannot be taken: at 1 carrier in 10 the losses fall by 74% (88 against 333). But 23-30 of the 91 ants
   (a quarter to a third) end up sitting at 1 in 10 (12-21 at 1 in 40), the thieves and foragers are gone, and the colony
   loses 24-56. Every setting loses.
6. **No strategy here beat the plain trail-layer.** Scouts, guards, raiders and carrying deeper were all measured as equal
   or worse. A colony's edge in these games is the foraging speed of `docs/TRAILS.md`, not a defence.

## Not tried

Killing thieves (an ant dies with 5 foes around it; a stash guard would need a squad), a clock to steal late or to start sitting late
(counting deliveries in the state is a clock of sorts, and it helped; a chain of random timers could approximate a real one),
camping next to the foe's piles to take each packet the moment its carrier leaves (a camper squad that takes no food and a raider squad
that returns were both tried and are worse), making the first delivery cells unattractive to
explorers, a delay K beyond 3 (needs a smaller program), and a joint sweep of the sitting dose with the explore and eating settings.

## The Keeper in 3 colonies (measured with the league)

The Keeper was only ever tested head to head. On fair 3-colony worlds (`generateFairWorld(3, seed)`, a new world per seed, every brain on
every hill once per world: `cli/league.ts`) its two-colony advantage does not carry over:

| league | rounds | games | points per game (95% over the worlds) | first places |
|---|---|---|---|---|
| keeper, trail, forager | 100,000 | 90 (30 worlds) | trail 3.53 ± 0.19, **keeper 2.47 ± 0.19**, forager 0.00 | 69, 21, 0 |
| keeper, trail, a copy of trail | 100,000 | 90 (30 worlds) | trail 2.22 ± 0.43, copy 2.18 ± 0.43, **keeper 1.60 ± 0.21** | 44, 43, 3 |
| keeper, trail, forager | 30,000 | 180 (60 worlds) | trail 3.10 ± 0.13, keeper 2.90 ± 0.13, forager 0.00 | 99, 81, 0 |
| keeper, trail (2 colonies, mirrored; the control) | 100,000 | 60 (30 worlds) | **keeper 1.53 ± 0.20**, trail 0.47 ± 0.20 | 46, 14 |

Reproduce: `node cli/personality.ts --template keeper > keeper.rules`, then `node cli/league.ts keeper.rules ants/trail.rules
ants/forager.rules --seeds 30 --rounds 100000 --jobs 1` (about 2 minutes; the copy of the trail ant is any file with the same text). Two checks say
the tooling is sound: the two identical trail ants tie (2.22 and 2.18), and the control reproduces the head-to-head result (the Keeper wins
46 of 60). So the flip is real at 100,000 rounds: in a 3-colony league the Keeper finishes last against two trail ants (it wins 3 of 90
games), and against a trail ant and a forager it is second, behind the trail ant. At 30,000 rounds the gap to the trail ant is inside the
noise (0.2 ± 0.18 points).

**The cause is the settling dose, and its best value depends on the number of colonies.** The Keeper's settlers (a share `1 in N` of the
ants coming home go and sit) cost production, and in 3-colony play they cost more than they take. Sweeping N against two trail ants (same
30 worlds, seeds 1 to 30, 100,000 rounds, 90 games each; the Keeper's points per game, the trail ants' in brackets):

| settling | Keeper | first places | trail ants |
|---|---|---|---|
| 1 in 7 (slider: often) | 1.28 ± 0.16 | 0 | 2.41, 2.31 |
| 1 in 10 (the default) | 1.60 ± 0.21 | 3 | 2.22, 2.18 |
| 1 in 15 (seldom) | 2.40 ± 0.26 | 28 | 1.87, 1.73 |
| 1 in 20 (rarely, the slider's rarest) | 2.91 ± 0.24 | 47 | 1.82, 1.27 |
| **1 in 40** (text edited) | **3.31 ± 0.25** | 66 | 1.53, 1.16 |
| 1 in 64 (edited; the language's largest N) | 2.73 ± 0.25 | 45 | 1.77, 1.50 |

The curve rises as settling gets rarer, peaks somewhere from 1 in 20 to 1 in 64 (the exact top, about 1 in 40, is within the noise of its
neighbours) and the Keeper then beats both trail ants. The finding that matters was confirmed on 30 fresh worlds (seeds 31 to 60): at 1 in 40
the Keeper scores 3.22 ± 0.27 with 63 first places of 90 (trail ants 1.43 and 1.34), and the default Keeper again comes last, 1.49 ± 0.18 with
5 first places (trail ants 2.31 and 2.20). **In 2 colonies the optimum is the other way**: the default Keeper beats the 1-in-40 Keeper
1.47 ± 0.23 to 0.53 ± 0.23 (44 wins of 60). So a Keeper written for two colonies is a poor 3-colony brain, and the dose should be rarer the
more rivals there are. Reproduce the slider's four levels in one command: `node cli/personality.ts --template keeper > k.rules`, `cp ants/trail.rules t2.rules`, `node cli/sweep.ts
k.rules ants/trail.rules t2.rules --league --param settling --seeds 30 --rounds 100000 --jobs 1` (about 9 minutes; the Arena's Sweep tab does
the same with *Against: all the other brains*). The 1 in 40 and 1 in 64 rows are outside the slider: edit `when 1 in 20 -> switch sit` in a
level-0 text to `1 in 40` and run `node cli/league.ts k40.rules ants/trail.rules t2.rules --seeds 30 --rounds 100000 --jobs 1` (about 2 minutes). Why a rarer dose is better is not known (candidates: the settlers are exposed to two rivals instead of one; the
production lost is a larger part of the total); the mechanism was not measured, only the dose-response. The slider's range stops at 1 in 20 and the
language at 1 in 64, so the best 3-colony value is outside the slider. That is now handled by a colonies-aware default (`colonies=N` in the personality line,
1 in 40 for three or more colonies; `docs/RULES.md`), which reproduces the 1 in 40 row exactly (3.31 points a game, 66 first places). The Keeper's numbers here are for the trail ant and the forager as opponents only.
Its fairness (the Keeper in every colony) was measured too: no order bias (`docs/MATCH.md`, *Does the move order favour a colony?*).

