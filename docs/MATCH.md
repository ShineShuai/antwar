# Match layer

Code: `src/core/match.ts` (integers only), `cli/tourney.ts`, `cli/gen.ts --symmetric`, `SYMMETRIC_WORLD` in `src/core/gen.ts`.

## Rules of a match

- A game is one world, one simulator seed (both from the same number), 100,000 rounds (`MATCH_ROUNDS`), Classic unless `--rules` says otherwise.
- Nest food decides: **2 points** for more, **1** each for equal, **0** for less. Carried food does not count.
- Every pair plays every world **twice, once per colour** (`schedule`): the first hill's ants act first in a round, so a single game
  favours a side. `swap` puts the first brain on the second hill.
- Standings: points, then **food margin** (nest food won minus lost, summed over games), then entry order.
- `colourSplit` counts wins by hill (first / second / draws). With two copies of one brain it measures the bias of the move
  order; the reference asks for at least 500 symmetric seeds before trusting a flag such as `altorder`.

## Fairness

A world is **fair for a brain** when that brain, put in every colony, has the most food in about 1 game of n (equal food splits the win).
That is a property of play, so it is measured: `cli/fairness.ts`, with the statistics in `src/fairness.ts` and `playColonies()` in
`src/core/match.ts`. It is tested **per map** (one map, only the simulator seed changes: `--map-seed S` or `--world FILE`) or **per
generator** (a new world every game). The two differ: the contest generator is fair on average, because colony labels are arbitrary, and
unfair on almost every single map (below).

Terrain symmetry is how fair worlds are made. It is a sufficient condition and not the definition; each gives every colony the same terrain:

* `isSymmetric(map)`: the point mirror, two hills, with a rock border (`SYMMETRIC_WORLD`, next section).
* `isShiftSymmetric(map)`: shifts of a wrapped world, n hills, no border (`generateFairWorld`, the section after).

Neither implies the other (the point-mirror worlds fail `isShiftSymmetric` and the shift worlds fail `isSymmetric`). Neither covers the order
the ants act in (`altorder`); the point mirror also does not cover that every ant starts facing east (a half turn takes east to west), a shift does.

**The test.** A colony's wins are counted over the games (a tie counts 1 / the colonies tied); z = (wins - games / n) / sqrt(games * (1 / n)
* (1 - 1 / n)); the p-value is two-sided and the smallest one is multiplied by n (Bonferroni). p >= 0.05 is reported as "no bias found",
which is **not proof of fairness**: the interval `resolution` (95% half-width of one colony's win share if play is fair; 5.7 points at 300
games and 2 colonies) says what could not have been seen. Checked on simulated fair play (3,000 to 4,000 runs each): false alarms 2% (2 colonies, which Bonferroni over-corrects: their two z values are
mirror images) to 6% (3 to 8 colonies, 100 games); below 10 expected wins per colony the normal approximation fails (26 colonies, 100 games: 14%;
300 games: 9%), so `fairness()` sets `thin` and the CLI warns when games < 10 * colonies. With 100 games a 50 / 25 / 25
split of 3 colonies is found 87% of the time and a 60 / 40 split of 2 colonies only 38%.

```
node cli/fairness.ts ants/trail.rules --map-seed 1                    # the contest map of seed 1
node cli/fairness.ts ants/trail.rules --symmetric --games 300         # the generator: a new point-mirror world per game
node cli/fairness.ts ants/trail.rules --colonies 3 --map-seed 2       # a fair world for 3 colonies
node cli/fairness.ts ants/trail.rules --world ring3.world --rules tinyminds --json
```

Measured, the plain trail ant in every colony, 30,000 rounds, 300 games per row unless noted (win counts by colony; p is the adjusted p):

| world | wins | food | verdict |
|---|---|---|---|
| contest map, seed 1 | 284 / 16 | 263 / 187 | **biased** (p < 0.0001) |
| contest map, seed 2 | 27 / 273 | 189 / 251 | **biased** (p < 0.0001) |
| point-mirror map, seed 1 | 147 / 154 | 224 / 224 | no bias found (p = 1) |
| point-mirror map, seed 2 | 145 / 155 | 219 / 221 | no bias found (p = 1) |
| shift map, 2 colonies, seed 1 | 150 / 150 | 215 / 223 | no bias found (p = 1) |
| shift map, 3 colonies, seed 1 | 89 / 98 / 113 | 209 / 213 / 215 | no bias found (p = 0.33) |
| shift map, 3 colonies, seed 2 | 96 / 100 / 105 | 212 / 215 / 213 | no bias found (p = 1) |
| shift map, 4 colonies, seed 1 (200 games) | 51 / 50 / 41 / 59 | 210 / 212 / 208 / 217 | no bias found (p = 0.48) |
| ring example world, 3 colonies | 115 / 83 / 103 | 113 / 104 / 104 | no bias found (p = 0.10) |
| ring example world, 4 colonies | 105 / 44 / 120 / 32 | 106 / 83 / 113 / 75 | **biased** (p < 0.0001) |
| contest generator, a new world per game | 149 / 151 | 230 / 229 | no bias found (p = 1) |
| point-mirror generator, a new world per game | 155 / 145 | 224 / 223 | no bias found (p = 1) |

Per map, 12 maps each, 40 games of 20,000 rounds (`--map-seed 1` to `12`): **11 of 12 contest maps are biased** (colony A wins 39, 0, 1, 9, 40,
31.5, 39, 11, 26, 0, 4.5 and 39 of 40 games; only seed 9 passes), **none of the 12 point-mirror maps** (closest: 14.5 / 25.5, p = 0.16) and
**none of 30 shift maps** (12 of 2 colonies, closest 26 / 14, p = 0.12; 10 of 3, closest 16 / 7 / 17, p = 0.10; 8 of 4, closest 8 / 11 / 6 / 15, p = 0.27).
Forty games only show a big bias, such as the contest maps' 39-1; with a false-alarm rate of 2 to 5% a test would flag one or none of 30 fair maps by chance.

* A 2-colony world is **not** fair by default: the workshop, `cli/eval.ts` and `cli/rc.ts` use the contest generator, whose maps are mostly
  lopsided. A fair 2-colony world is `worldFor(seed, true)` (point mirror; `cli/tourney.ts --symmetric`, `cli/eval.ts --symmetric`, and in
  the workshop Example world, "2 colonies, mirrored (seed)") or `generateFairWorld(2, seed)` (workshop: "2 colonies, fair (seed)"). The seed
  box picks the world; the default world of the workshop and of `cli/eval.ts` is unchanged, so old share links and numbers still mean the same.
* The ring example world for 3 colonies passes at 300 games (p = 0.10) although 400 games of another run gave 159 / 98 / 142 wins (the fair worlds
  section below): a pass at this size only means that the bias, if any, is small; the 4-colony ring is plainly unfair.
* The verdict looks at first place only; the mean ranking points (n - 1 when fair) are printed beside it.

**A brain that fights, at the match length.** The Keeper (steals, settles on its pile, `docs/STEALING.md`) in every colony, 100,000 rounds,
250 games per row (170 for the last); the colonies meet at the nests all game, so this is the stronger probe of the move order:

| world | rules | wins | food | verdict |
|---|---|---|---|---|
| point-mirror map, seed 1 | classic | 109 / 141 | 260 / 266 | no bias found (p = 0.086) |
| point-mirror map, seed 1 | `altorder` | 127 / 123 | 265 / 263 | no bias found (p = 1) |
| point-mirror map, seed 2 | classic | 123 / 127 | 258 / 260 | no bias found (p = 1) |
| point-mirror map, seed 2 | `altorder` | 127 / 123 | 261 / 258 | no bias found (p = 1) |
| shift map, 2 colonies, seed 1 | classic | 83 / 88 | 275 / 276 | no bias found (p = 1) |

Nothing is flagged, and the one near miss (map 1, classic: the second colony wins 141 of 250, p = 0.086) is 127 / 123 under `altorder`: at +-6
points they cannot be told apart. On the two classic maps together the first colony won 232 of 500 (46.4%, p = 0.11), the opposite sign to the
500 different worlds of the order-bias section below (52.5%), so there is no consistent order bias to remove, and none that `altorder`
has been shown to remove.
* Not measured: the Keeper on worlds of 3 or more colonies, `altorder` on shift maps, other brains (the raider, the squads), more than the
  maps above, and win chance for many colonies (1 / n is small, so the power drops).

## Symmetric worlds

`generateWorld(seed, SYMMETRIC_WORLD)` / `worldFor(seed, true)`: every element has a twin at `(W-1-x, H-1-y)`, which is index
`W*H-1-p`. For an even height this is a symmetry of the hex grid (neighbour `d` of a cell is the twin of neighbour `d+3` of its twin; tested on
tori). Hill 1 is hill 0's twin; 5 + 5 rocks and 4 + 4 food blobs are placed as pairs, a pair that does not fit is re-drawn.
`isSymmetric(map)` validates any world (it gives both colonies the same terrain; whether play is fair is measured: no bias was found on any of 12 maps). The contest generator's output is unchanged (pinned in `test/match.test.ts`). For more than two
colonies see the next section.
Ants still start facing east and ids still run row-major, so the terrain is fair, the move order is not (hence both colours).

## Fair worlds for 3 or more colonies

`generateFairWorld(n, seed)` (`node cli/gen.ts SEED --colonies N`; in the workshop, Example world, "N colonies, fair (seed)"; the seed box
picks the world). The point mirror pairs two hills, so for n colonies the same is done with shifts: one **tile** (a hill, 1 to 3 rocks,
2 to 4 food blobs; 240 food per colony when the tile is 30 cells or more a side) is generated on its own torus and repeated `across`
by `down` times (across * down = n) on a wrapped world. Shifting the world by a tile maps rock to rock and food to food and takes hill 0
onto any other hill, so every colony has the same hill, food and rock in the same places; `isShiftSymmetric(map)` checks that for any world (an
even number of rows; for each hill c a shift that maps rock to rock, food to food, hill 0's cells onto hill c's cells exactly, and the hill cells
as a whole onto themselves, so every colony sees the other hills in the same places). `fairLayout(n)` gives the tiling: the biggest tile, then the squarest
world; 4 colonies are 2 x 2 tiles of 50 x 50 (a 100 x 100 world with hills of 91 cells), 9 are 3 x 3, 16 are 4 x 4.

* Tiles need 16 cells a side, so **13, 17, 19, 23 and 26 colonies are refused** (a world is at most 200 cells a side), and tiles shrink as
  n grows: hills of 91, 61, 37 and 19 cells at tiles of 44+, 30+, 22+ and 16+ cells.
* The worlds have **no rock border** and need wrapped play (the simulator's default; `--no-wrap` of `cli/replay.ts` would break them).
  They are not files for the official engine.
* Fair terrain does not make the move order fair (ids still run colony by colony, `altorder` is the ruleset for that).

Measured: the plain trail ant on every hill, 400 games of 30,000 rounds each, under the `colonies` ruleset. The ring example world of
the workshop (`exampleWorld(n)`, similar hills but not the same places) is one world, so its 400 games are 400 simulation seeds; the
fair rows are 400 worlds (seeds 1001-1400). "Colony 0 minus the rest" is the mean food of colony 0 less the mean of the others, with its 95% interval.

| world | wins by colony (ties) | mean food by colony | colony 0 minus the rest |
|---|---|---|---|
| fair, 3 colonies | 126 / 130 / 140 (4) | 216.3 / 213.4 / 211.3 | +4.0 +- 6.9 |
| ring example, 3 colonies | 159 / 98 / 142 (1) | 114.0 / 101.7 / 106.0 | +10.2 +- 5.1 |
| fair, 4 colonies | 87 / 100 / 118 / 90 (5) | 207.8 / 210.2 / 217.0 / 210.2 | -4.7 +- 6.4 |
| ring example, 4 colonies | 141 / 54 / 162 / 39 (4) | 106.8 / 82.4 / 113.4 / 74.4 | +16.8 +- 5.0 |

On fair worlds no colony is ahead (wins are consistent with an even split; a food gap under about 7 cannot be excluded). On the ring
worlds the place decides: with 4 colonies the two stronger colonies win three to four times as often as the other two. 100,000-round
runs of 80 games agree (fair 3: 22 / 27 / 30 wins; fair 4: 21 / 18 / 19 / 22 and 25 / 20 / 18 / 17 on two sets of seeds; ring 3: 37 / 20 / 23).
Not done: other brains than the trail ant, tilings for 13, 17, 19, 23 and 26 colonies (a twisted lattice would do it); the ranking of more
than two colonies is the next section.

## Ranking more than two colonies

The contest scores a game of two colonies 2 (more nest food), 1 (equal) or 0 and defines nothing for more. The rule here (`colonyResult(food)`
in `src/core/ranking.ts`; the workshop's status line at the end of a match of 3 or more colonies) scores every pair of colonies that way:
**a colony earns 2 points for each colony with less food and 1 for each colony with the same food**; its **rank** is 1 plus the number of
colonies with more food, so equal food shares a rank and leaves a gap (1, 2, 2, 4). The status line shows the order, equal food joined by `=`:
`ranking A > C = D > B`.

| food A / B / C / D | ranks | points |
|---|---|---|
| 10 / 8 / 3 | 1, 2, 3 | 4, 2, 0 |
| 10 / 8 / 8 | 1, 2, 2 | 4, 1, 1 |
| 8 / 10 / 8 / 3 | 2, 1, 2, 4 | 3, 6, 3, 0 |
| 7 / 7 / 7 | 1, 1, 1 | 2, 2, 2 |

* For two colonies it is exactly `points(a, b)`, so every 2-colony table keeps its meaning.
* The points of a game add up to n * (n - 1), whatever the food; only the order of the food counts (3,000 random games are checked in
  `test/ranking.test.ts`), and more food never scores less.
* It is a proposal, not the original's rule. It needs no constant that would have to be invented for each n (a place-based scale does), and it
  keeps the order of every colony, which "winner takes all" throws away.
* `cli/tourney.ts` (`standings`, `pairwise`) still schedules games of two entries; games of n colonies are the league below.

## League: n brains on one world

`node cli/league.ts A B C [...] [--seeds 20] [--rounds 100000] [--world FILE | --contest] [--jobs N] [--json] [--games]` (`src/league.ts`):
n brains in n colonies. Every world is played n times with the brains rotating round the hills (rotation r puts brain (h + r) mod n in
hill h, a Latin square), so each brain takes each hill once per world and the advantage of a place cancels out, whether the world is fair
or not. A game is scored by `colonyResult` (2 points for each colony with less food, 1 for each tie) and the table is ordered by points,
then nest food. Worlds: two brains play point-mirror worlds (`--contest`: the contest generator), more play fair worlds for n colonies
(13, 17, 19, 23 and 26 have none: give `--world FILE`), or one `--world FILE` whose hills are the brains and only the simulator seed changes.
Rules are classic for two brains and colonies for more (`--rules`). Results do not depend on `--jobs`.

"per game" is the mean points, n - 1 for an average brain, with the 95% interval over the worlds (the n games of a world are not independent).
The last line, the mean points by hill, shows what the place is worth: 2 each for 3 colonies if it is worth nothing.

```
3 brains, 20 worlds (seeds 1..20; fair worlds for 3 colonies), 3 rotations each, 100000 rounds, rules colonies; 60 games
 # brain        points  per game        rank  1st  shared  food
 1 trail.rules     206  3.43 +-0.36    1.28   48       0   368
 2 crumb.asm       132  2.20 +-0.21    1.90   11       0   222
 3 trail.asm        22  0.37 +-0.29    2.82    1       0    72
Mean points by hill, 2 each when the place does not matter: A 1.97, B 1.93, C 2.10
```

The same brain three times on the lopsided ring world (`exampleWorld(3)`, 40 simulator seeds) gives every entry exactly 240 points, the place
being cancelled by the rotation (identical brains play identical games, so this is exact), while the hill line shows the place that was
cancelled: A 2.63, B 1.60, C 1.77. List a brain twice to see what a world's places are worth.
Not done: more brains than colonies (every subset, or a random one), the workshop does not show a league.

## Order bias, measured (Classic and `altorder`)

One brain on both hills of 500 symmetric worlds (seeds 1-500, 100,000 rounds, one game per seed). The brain is the Keeper
(`personality(DEFAULTS.keeper)`, 689 states), the strongest probe at hand because its colonies meet at the nests all game.

| order | first hill wins | second hill wins | draws | first's share of decided games (95% interval) | mean nest food, first / second |
|---|---|---|---|---|---|
| Classic | 262 | 237 | 1 | 52.5% (48.1-56.9) | 262.4 / 258.5 |
| `altorder` | 254 | 243 | 3 | 51.1% (46.7-55.5) | 261.8 / 261.1 |

Neither differs from 50% (z = 1.1 and 0.5), so **no bias was found in either order, and the test does not show that `altorder` removes
one**: a Classic bias would have to be larger than about 4.4 points to show at this size, and a first run of 20 seeds (6-13-1 for the second hill)
was noise. To see a 1-point bias you need about 10,000 seeds (0.9 s per game here, so about 2.5 hours on one core).
Not measured: other brains (the plain trail-layer, the raider), other worlds than the symmetric generator.

## Tournament CLI

    node cli/tourney.ts A.ant B.rules C.asm ... [--seeds 20] [--from 1] [--rounds 100000] [--rules classic]
                        [--symmetric] [--jobs 4] [--json] [--games]

Prints standings with score% and a 95% Wilson interval (draws count half; the two games on one world are correlated, so the
interval is approximate), the pairwise points matrix, and the wins by hill. `--json` adds every game
(`a, b, seed, swap, food, alive, hash`): the hash is the final state hash, so any game can be re-run and checked
(`cli/replay.ts record` on the same world gives the same hash). `--jobs` uses worker threads; the output does not depend on it.
Cost: about 0.6 s per 100,000-round game per core, so 3 brains x 20 worlds x 2 colours x 3 pairs is 120 games.

## Not done

Hidden seeds (HMAC of a secret), the stored pairwise matrix and incremental runs, `--symmetric` in `cli/rc.ts`,
a generator version for symmetric worlds separate from `GENERATOR_VERSION`.
