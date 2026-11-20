# Nest stealing (measured)

A pick-up works on any cell that holds food, a nest included, and any ant can stand on any free cell. So the food a colony
delivers is a stash that anyone can take, one packet per visit to its cell. `node cli/eval.ts --vs OTHER` counts it:
`stole` = packets this colony picked up on the other colony's nest cells, `lost` = the other way round.

The study was run twice. **Round 1** (below, "Against the original trail ant") used the trail-layer as it was before the retuning of
`docs/EXPLORE.md` and `docs/TUNING.md` (explorer turning 1 step in 5, dead end eaten 1 time in 4). **Round 2** repeats it against
the retuned `ants/trail.rules` ("T"), and **one conclusion of round 1 did not survive**: against the faster ant a light dose of
pile-sitting wins, and that is the Keeper template.

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
| **1 in 30 (the Keeper)** | **57-0-23**; seeds 41-80: **52-0-28** | 287 vs 218 | 354 | 311 |
| 1 in 40 | 45-1-34; seeds 41-80: 54-0-26 | 256 vs 238 | 393 | 369 |
| 1 in 64 | 44-0-36 | 262 vs 221 | 450 | 429 |

"Sits" means: after the delivery the carrier stays on its pile for good (a mood that only waits), with the stated chance per
delivery; the others get on with foraging. The rows are the keeper-style variants generated from `ants/trail.rules`; 1 in 30 is
exactly the `keeper` template.

What round 2 says:

1. **Findings 1-4 of round 1 stand, with bigger numbers.** The faster ant steals more: each side takes about 490 packets per
   mirror match (333 before). Not stealing is still ruinous (0-80). A stash still cannot be hidden.
2. **Light sitting works; heavy sitting still loses.** A dose-response with a cliff: 1 in 10 and 1 in 12 lose (15-65, 31-49), 1 in 15 to
   1 in 40 win (54-26 to 57-23 on seeds 1-40, 52-28 to 58-21 on fresh seeds 41-80), 1 in 64 fades to a coin flip. The Keeper takes 1 in
   30: pooled over 160 games it is **109-0-51** against T (1 in 20 is 115-1-44, closer to the cliff).
3. **Where the sitters are.** About a fifth of the keepers sit by round 100,000 (8-23 of 91 in idle-opponent games; the
   delivery count per ant is what sets it, and stolen packets are delivered again). The cliff is where the sitters outnumber the
   foragers the colony still needs.
4. **Why it helps now and did not before is not shown.** One guess: the retuned ant finishes foraging by about round 35,000, so most of
   the game is the fight over the stash, which sitters protect; before, foraging lasted most of the game and every sitter was a
   lost forager. It was not tested.
5. **Guards, scouts and raiders still do not beat T**, as in round 1 (10% guards are now level with T instead of clearly worse).

Limits: generated worlds only; the dose (30) was picked among several on the same first 40 seeds and confirmed on seeds 41-80 for
30, 20 and 40; the head-to-head results of different doses come from one family of runs.

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
(ants have no clock; a chain of random timers could approximate one: round 2 suggests the sitters' value comes late in the game),
camping next to the foe's piles to take each packet the moment its carrier leaves, making the first delivery cells unattractive to
explorers, and a joint sweep of the sitting dose with the explore and eating settings.
