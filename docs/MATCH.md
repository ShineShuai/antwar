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
`isSymmetric(map)` validates any world. The contest generator's output is unchanged (pinned in `test/match.test.ts`).
Ants still start facing east and ids still run row-major, so the terrain is fair, the move order is not (hence both colours).

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
