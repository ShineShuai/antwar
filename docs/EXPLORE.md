# Exploration persistence

`explore` is the persistent random walk of the trail kit: each step it turns with chance 1/N (a random side), else goes straight
on; a blocked step turns at random. It was set to N = 5 when the trail work found that exploration was the biggest lever
(`docs/TRAILS.md`, finding 4: 4 in 5 -> 1 in 5 turns). That stopped too early. **N = 64 is clearly better, and so is anything
from 16 to 256**: the colony reaches 90% of the food about 25% sooner, completes more worlds, and wins 55-25 head to head.

`explore N` (N from 2 to 64) sets it; plain `explore` is now `explore 64` (`EXPLORE_DEFAULT` in `src/lang/parse.ts`).
**`explore 5` compiles to exactly the old program** (checked: same instructions), so every earlier measurement in these docs can
be reproduced by writing it.

## Method

`ants/trail.rules` with `explore N` in its last rule, against an idle opponent, generated worlds (seeds 1-20, then seeds 21-60
as held-out data), 100,000 rounds, 480 packets per world. `node cli/eval.ts --ant FILE --seeds 20 --rounds 100000`. The N = 5 row
reproduces the documented figures (14/20, 18.5k, 50.7k) before anything else was trusted.

## One colony, seeds 1-20

| turn 1 step in | worlds with all 480 | rounds to 50% (median) | rounds to 90% (median) | stuck carriers per world |
|---|---|---|---|---|
| 3 | 7/20 | 21.4k | 71.0k | 4.0 |
| 4 | 12/20 | 19.0k | 61.0k | 1.6 |
| **5 (the old default)** | **14/20** | **18.5k** | **50.7k** | **0.5** |
| 6 | 18/20 | 15.0k | 47.4k | 0.1 |
| 8 | 18/20 | 14.4k | 43.6k | 0.8 |
| 10 | 18/20 | 14.3k | 37.5k | 0.2 |
| 12 | 19/20 | 13.5k | 39.1k | 0.1 |
| 16 | 17/20 | 14.0k | 38.8k | 0.6 |
| 20 | 17/20 | 12.6k | 34.1k | 0.3 |
| 24 | 19/20 | 12.9k | 36.3k | 0.1 |
| 32 | 17/20 | 13.4k | 34.5k | 0.8 |
| **64 (the new default)** | **18/20** | **14.1k** | **36.8k** | **0.1** |
| 256 (needs a flip above 64) | 19/20 | 13.1k | 37.7k | 0.1 |
| never, only when blocked | 16/20 | 14.5k | 42.0k | 0.3 |

## Held-out seeds 21-60 (40 worlds)

| turn 1 step in | all 480 | 90% (mean) | stuck per world |
|---|---|---|---|
| 5 | 33/40 | 56.2k | 0.3 |
| 12 | 37/40 | 40.8k | 0.1 |
| 16 | 39/40 | 39.6k | 0.0 |
| 20 | 36/40 | 37.7k | 0.1 |
| 24 | 37/40 | 38.1k | 0.1 |
| 32 | 39/40 | 38.6k | 0.1 |
| 64 | 38/40 | 40.3k | 0.1 |

The plateau is flat from 12 to 256 (the differences between rows are inside the noise of 20-40 worlds); the cliff is on the
low side, and "never turn" is worse than a little turning.

## Head to head (80 games each: 40 worlds, both hills, 100,000 rounds)

| colony under test | against | W-D-L | median food |
|---|---|---|---|
| explore 16 | explore 5 | 57-1-22 | 286 vs 168 |
| explore 32 | explore 5 | 62-0-18 | 287 vs 175 |
| **explore 64** | **explore 5** | **55-0-25** | **327 vs 145** |
| explore 32 | explore 16 | 44-0-36 | 240 vs 217 |
| explore 32 | explore 64 | 34-0-46 | 208 vs 261 |
| explore 256 | explore 64 | 41-0-39 | 238 vs 230 |

Stealing does not change the verdict: the faster forager also steals as much as before (about 390 packets per game each way).

## Why 64, not 32 or 16

32 and 64 are inside the plateau; two things decided it. Over 60 worlds (seeds 1-60) N = 64 left **5 carriers stuck** at the end
(4 worlds), N = 32 left **19** (also 4 worlds, one with a cluster), and the old N = 5 about 22. And 64 beat 32 head to head,
46-34 (not significant by itself). 64 is also a power of two (the chance is exact: `flipzero 64`) and the largest value the
authoring levels allow.

## What is not better

* **Carrier holds are rarer but longer.** The longest time one carrier holds food (sampled every 50 rounds, seeds 1-20): median
  22.9k rounds with N = 5 against 8.6k with N = 64, but two worlds (seeds 16 and 17) keep one carrier for 91k rounds, where the
  old explorer's worst case was 54k. The 30,000-round "no carrier freezes" test (seeds 1-3) still passes. A permanently stuck
  carrier costs one ant of 91; it was not diagnosed.
* **Generated worlds only.** They resemble the contest's, but the official worlds were not tried.
* **Hand-written ants were not retuned.** The numbers in `docs/TRAILS.md`, the personality and compiled-versus-hand tables in
  `docs/RULES.md`, and `docs/STEALING.md` were measured with the old explorer (`explore 5`); the comparison of the compiled ant with
  the hand ant is under that setting too. `ants/trail.rules` and every Level 0 template that uses `explore` run the new default.

## Not tried

The other constants of the kit were set by hand and never swept: the carrier sidestep (1 in 4), the trail-end eating (1 in 4),
the roam rule. A frontier-seeking explorer (prefer a cell with no code) was designed but not built.
