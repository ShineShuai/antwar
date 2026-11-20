# Tuning the kit's constants

After `explore` (`docs/EXPLORE.md`) the two other chances hard-coded in the trail kit were swept the same way. One was already at
its optimum; the other was wrong.

**Cumulatively, the shipped trail ant beats the original (explore 5 and a dead end eaten 1 time in 4) 73-0-7 over 80 games** (both
hills, seeds 1-40; median food 360 against 93). Alone against an idle opponent it completes 57 of 60 worlds against 47, and reaches 90%
of the food in about 35k rounds on average against 54k (seeds 1-60: 20/20 and 37/40 completed, mean 33.4k and 35.7k; the original
14/20 and 33/40, 51.2k and 56.2k).

## Blocked carrier sidestep (`return home`, 1 time in 4): unchanged

A carrier that cannot move retries next round, and 1 time in N it steps sideways instead (breaks jams).

| sidestep | all 480 (seeds 1-20) | mean rounds to 90% | stuck carriers per world |
|---|---|---|---|
| always | 18/20 | 37.9k | 0.3 |
| 1 in 2 | 18/20 | 36.2k | 0.1 |
| 1 in 3 | 18/20 | 37.4k | 0.2 |
| **1 in 4 (kept)** | **18/20** | **37.9k** | **0.1** |
| 1 in 8 | 16/20 | 36.6k | 0.3 |
| 1 in 16 | 17/20 | 35.6k | 0.2 |
| never | 16/20 | 38.1k | **3.7** |

Flat between 2 and 16: all inside the noise. The only clear fact is that sidestepping must exist (never: jams). With the eating
change in, 1 in 4 was also the best of 2, 4 and 8 on the held-out worlds 21-60 (40/40 and 35.8k, against 38/40 and 38.4k for 1 in 2,
39/40 and 36.1k for 1 in 8). The value set by hand was on the plateau's top.

## Dead-end eating (`follow trail`, was 1 time in 4): now every time

On a food trail an ant that finds no continuation ahead, left or right is at a dead end (the food is gone). It used to eat that last
trail cell 1 time in 4. Trails that outlive their food keep sending ants to nothing, so more eating is better:

| eaten | all 480 (seeds 1-20) | mean to 90% | stuck | held-out 21-60: all 480, mean to 90% |
|---|---|---|---|---|
| never | 3/20 | 55.8k | 0.1 | |
| 1 in 16 | 13/20 | 40.6k | 0.7 | |
| 1 in 8 | 16/20 | 43.1k | 0.2 | |
| 1 in 4 (before) | 18/20 | 37.9k | 0.1 | 38/40, 40.3k |
| 1 in 3 | 20/20 | 33.7k | 0.0 | 40/40, 36.8k |
| 1 in 2 | 20/20 | 33.2k | 0.0 | 40/40, 35.8k |
| always, after a flip that costs a round | 18/20 | 33.2k | 0.2 | 37/40, 36.2k |
| **always, no flip (now)** | **20/20** | **33.4k** | **0.0** | **37/40, 35.7k** |

Head to head, 80 games each (both hills):

| colony under test | against | W-D-L | median food |
|---|---|---|---|
| 1 in 2 | 1 in 4 | 45-1-34 | 254 vs 209 |
| 1 in 2 | 1 in 3 | 51-0-29 | 256 vs 206 |
| always (with a flip) | 1 in 2 | 47-1-32 (seeds 41-80; 28-52 the other way round on 1-40) | 261 vs 220 |
| always (with a flip) | 1 in 4 | 55-0-25 | 294 vs 165 |
| **always (no flip)** | **1 in 4** | **53-0-27** (seeds 1-40), **61-0-19** (seeds 41-80) | 277 vs 188, 282 vs 183 |
| always (no flip) | 1 in 2 | 44-0-36 | 243 vs 222 |

Alone, 1 in 2 and 1 in 3 complete slightly more worlds (60/60 against 57/60), but head to head the order is always >= 1 in 2 > 1 in 3 >
1 in 4, and head to head is what the game scores, so the rule is "always" and it needs no flip: `follow trail` has 3 states
fewer (239 in all, 382 instructions; it was 242 and 385).

## A frontier-seeking explorer: tried, worse

The idea: an explorer prefers cells nobody has visited. The kit already marks every visited cell (codes 0-2), so before each step the
explorer senses the cell ahead for a code (up to three senses) and, if there is one, turns at random 1 time in Q before stepping.
Alone against an idle opponent, seeds 1-20:

| turn when the cell ahead is coded | all 480 | mean rounds to 90% |
|---|---|---|
| never (the shipped explorer) | 20/20 | 33.4k |
| 1 in 4 | 18/20 | 35.9k |
| 1 in 2 | 19/20 | 41.4k |
| always (once, then step) | 17/20 | 56.0k |

The more it avoids visited cells, the slower the colony, so it was dropped; it never left the experiment (a temporary knob, not in
the code). Why was not investigated. Two guesses, both untested: explorers have to walk out through the colony's own coded
corridor next to the nest, and avoiding it slows them down; and the three senses per step cost about as much as the better coverage
gains. An avoidance that applies only far from the nest would need a distance the ants do not have.

## Stuck carriers: a head-on knot; the fix gains nothing in games

`docs/EXPLORE.md` noted two worlds (seeds 16 and 17) where one carrier held its food for 91k rounds, and that it was not diagnosed.
With the kit as shipped, tracked every round, alone against an idle opponent, 100,000 rounds:

* Seeds 16 and 17 no longer do it: their longest holds are 4,553 and 8,257 rounds. Over seeds 1-60 the median world's longest hold is
  about 8k rounds (the longest hold that ended in a delivery: 23.5k, seed 14), and at the end of the game no carrier is still holding
  after 5,000 rounds, except in three worlds.
* **Five carriers are held to the end, in three worlds:** seed 48 (one carrier, 63k rounds when the game ends), seed 52 (two, 88k),
  seed 58 (two, 75k). They are what the `stuck` column of `cli/eval.ts` counts.

**Cause.** A knot in a one-cell corridor. In seed 52 two carriers walking home stand at (47,43) and (48,43), and a searching ant at
(48,42) walks the other way along the food trail: each wants a cell another holds. All three stopped at about round 15,500 and have
not moved since. A blocked carrier retries, and 1 time in 4 it sidesteps, but a sidestep turns only to the two directions next to
its own, and for every one of the five stuck carriers both are rock or another ant (in seed 48 the idle foe's ants). The searcher
steps off the lane the same way (turn left or right, then move), and the next `follow trail` turns it back to face the carriers. Nothing
in the program ever turns an ant around, so nobody backs out.

**Fix tried.** A blocked carrier turns around, instead of left or right, 1 time in N of its sidesteps (so 1 in 4N blocked rounds), or a
blocked follower does (1 time in 3 of its steps off the lane). Seeds 1-60 alone; head to head against the shipped ant, 80 games
(40 seeds, both hills):

| variant | stuck carriers (worlds) | all 480 | mean rounds to 90% | head to head |
|---|---|---|---|---|
| shipped | 5 (3) | 57/60 | 34.9k | |
| carrier turns around, 1 in 3 | 0 | 60/60 | 34.5k | 34-0-46 |
| carrier turns around, 1 in 8 | 0 | 60/60 | 36.4k | 40-0-40; seeds 41-80, one hill order only: 15-1-24 |
| follower turns around, 1 in 3 | 0 | 60/60 | 38.4k | not run |
| both, 1 in 3 | 0 | 60/60 | 39.6k | not run |

The knot is real and the fix removes it, but it does not win games: 34-46 and 40-40 are inside the noise, and the follower version
explores more slowly. A stuck carrier costs one ant of 91 in 3 worlds of 60, too little to show in 80 games. Not adopted; the kit is
unchanged. Not tried: the fix in the Keeper (its stuck count in a mirror match is about 9 per game, `docs/STEALING.md`; whether it is
the same knot was not checked), and followers with a smaller turn-around chance (only 1 in 3 was tried). The variants were temporary knobs in
`lower.ts`, not committed.

## Method and limits

Seeds 1-20 as the sweep, seeds 21-60 held out, head-to-head seeds 1-40 and (to check) 41-80; 100,000 rounds; generated worlds only.
The sweeps ran through temporary environment knobs in the lowering that are not in the code: the old values are not reproducible
from this tree except by checking out the commit before this one. Stuck-carrier counts are small and heavy-tailed. The three
head-to-head results for "always" are one family of runs (the orderings agree, the exact margins do not carry over to other
worlds).

## Not tried

The roam and wander rules and the rest of the kit's step logic. The joint check of explore, sidestep, eating and the Keeper's dose
is in `docs/STEALING.md` (nothing moved except the dose).
