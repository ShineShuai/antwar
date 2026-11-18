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

## Method and limits

Seeds 1-20 as the sweep, seeds 21-60 held out, head-to-head seeds 1-40 and (to check) 41-80; 100,000 rounds; generated worlds only.
The sweeps ran through temporary environment knobs in the lowering that are not in the code: the old values are not reproducible
from this tree except by checking out the commit before this one. Stuck-carrier counts are small and heavy-tailed. The three
head-to-head results for "always" are one family of runs (the orderings agree, the exact margins do not carry over to other
worlds).

## Not tried

The roam and wander rules, the rest of the kit's step logic, a frontier-seeking explorer (prefer a cell with no code), and a joint
sweep of explore, sidestep and eating (the three were tuned one at a time).
