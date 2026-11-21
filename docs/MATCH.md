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

## Symmetric worlds

`generateWorld(seed, SYMMETRIC_WORLD)` / `worldFor(seed, true)`: every element has a twin at `(W-1-x, H-1-y)`, which is index
`W*H-1-p`. For an even height this is a symmetry of the hex grid (neighbour `d` of a cell is the twin of neighbour `d+3` of its twin; tested on
tori). Hill 1 is hill 0's twin; 5 + 5 rocks and 4 + 4 food blobs are placed as pairs, a pair that does not fit is re-drawn.
`isSymmetric(map)` validates any world. The contest generator's output is unchanged (pinned in `test/match.test.ts`). For more than two
colonies see the next section.
Ants still start facing east and ids still run row-major, so the terrain is fair, the move order is not (hence both colours).

## Fair worlds for 3 or more colonies

`generateFairWorld(n, seed)` (`node cli/gen.ts SEED --colonies N`; in the workshop, Example world, "N colonies, fair (seed)"; the seed box
picks the world). The point mirror pairs two hills, so for n colonies the same is done with shifts: one **tile** (a hill, 1 to 3 rocks,
2 to 4 food blobs; 240 food per colony when the tile is 30 cells or more a side) is generated on its own torus and repeated `across`
by `down` times (across * down = n) on a wrapped world. Shifting the world by a tile maps rock to rock and food to food and takes hill 0
onto any other hill, so every colony has the same hill, food and rock in the same places; `isFair(map)` checks that for any world (an
even number of rows, hill 0's cells onto hill c's cells exactly). `fairLayout(n)` gives the tiling: the biggest tile, then the squarest
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
Not done: a ranking rule for more than two colonies (the workshop shows who has the most food), other brains than the trail ant, tilings
for 13, 17, 19, 23 and 26 colonies (a twisted lattice would do it).

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

Hidden seeds (HMAC of a secret), the stored pairwise matrix and incremental runs, `--symmetric` in the workshop and in `cli/eval.ts`,
a generator version for symmetric worlds separate from `GENERATOR_VERSION`.
