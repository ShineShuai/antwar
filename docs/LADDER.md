# The ladder: every shipped brain against every other

A static Hall of Fame: a round-robin of the brains in `ants/` and the Keeper, so that a new brain can be put next to them. It is a
measurement, not a rule, and it is not kept up to date by itself: rerun it when a brain or the simulator changes (`docs/MATCH.md` has the
tournament rules, `docs/TRAILS.md`, `docs/RULES.md` and `docs/STEALING.md` the brains).

```
node cli/personality.ts --template keeper > keeper.rules
node cli/rc.ts ants/starter.script --ant > starter.ant
node cli/tourney.ts keeper.rules ants/trail.rules ants/crumb.asm ants/crumb-scout.asm ants/trail.asm ants/scout.asm \
  ants/forager.rules starter.ant --symmetric --seeds 8 --from 1 --jobs 4
```

Eight brains, every pair on 8 point-mirror worlds (seeds 1 to 8), once from each hill, 100,000 rounds: 16 games a pair, 448 games, a game
2 points for more nest food, 1 for a tie, 0 for less. The same results come out of any `--jobs` and of any split into runs of fewer seeds
(this table was made in three runs of 1, 4 and 3 seeds).

```
 # brain             points   W   D   L   food +/-  score% [95% interval]
 1 keeper.rules         216 108   0   4  +30603     96.4  [93.1, 98.2]
 2 trail.rules          186  93   0  19  +30578     83.0  [77.6, 87.4]
 3 crumb.asm            156  78   0  34  +16601     69.6  [63.3, 75.3]
 4 trail.asm            138  69   0  43  +13291     61.6  [55.1, 67.7]
 5 crumb-scout.asm      100  50   0  62   -3207     44.6  [38.3, 51.2]
 6 scout.asm             68  34   0  78   -7087     30.4  [24.7, 36.7]
 7 forager.rules         32  16   0  96  -39925     14.3  [10.3, 19.5]
 8 starter.ant            0   0   0 112  -40854      0.0  [0.0, 1.7]
```

Points the row brain took from the column brain, of 32 (16 games of 2 points):

| | keeper | trail.rules | crumb | trail.asm | crumb-scout | scout | forager | starter |
|---|---|---|---|---|---|---|---|---|
| keeper.rules | - | 28 | 32 | 28 | 32 | 32 | 32 | 32 |
| trail.rules | 4 | - | 26 | 30 | 30 | 32 | 32 | 32 |
| crumb.asm | 0 | 6 | - | 24 | 30 | 32 | 32 | 32 |
| trail.asm | 4 | 2 | 8 | - | 28 | 32 | 32 | 32 |
| crumb-scout.asm | 0 | 2 | 2 | 4 | - | 28 | 32 | 32 |
| scout.asm | 0 | 0 | 0 | 0 | 4 | - | 32 | 32 |
| forager.rules | 0 | 0 | 0 | 0 | 0 | 0 | - | 32 |
| starter.ant | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |

Wins by hill: first 226, second 222 (an even split, as it should be on point-mirror worlds).

**The brains**

* `keeper.rules`: the Level 0 Keeper (trail-layer that settles on its pile after two free deliveries, 1 time in 10; `docs/STEALING.md`).
* `trail.rules`: the compiled trail-layer, the default of Level 0 (`docs/RULES.md`, `docs/TUNING.md`).
* `crumb.asm`: the hand-made breadcrumb ant (parent pointers) with a food trail; `trail.asm`: the mod-3 gradient ant with a food trail
  (`docs/TRAILS.md`).
* `crumb-scout.asm` and `scout.asm`: the same two without the food trail, "scouts" (`gen-crumb.ts` and `gen-trail.ts --no-food-trail`).
* `forager.rules`: the level-1 forager, six rules and no kit; `starter.ant`: the 16-state example ant of the task text
  (`ants/starter.script`, compiled with `rc.ts --ant`).

**What it shows**

* The order agrees with the other documents: the Keeper is above the plain trail-layer (14 wins and 2 losses of 16, 28 points of 32 here;
  118-0-42 over 160 games on contest worlds in `docs/STEALING.md`), the compiled trail-layer above the hand-written ants (`docs/RULES.md`),
  the breadcrumb ant above the mod-3 ant (24 against 8 points, as in `docs/TRAILS.md`), and every food-trail ant above its scout.
* Neighbours in the table are 18 to 38 points apart (of 224 possible). The closest are `crumb.asm` and `trail.asm`, 18 apart and 24 against 8
  points head to head; the last three brains lose almost every game against everyone above them.
* Not shown: games of more than two colonies (`docs/MATCH.md`, the league), other worlds than the point-mirror ones, and any brain
  that is not in `ants/` (the Keeper's other settings, the raider, the squads of `docs/STEALING.md`).

Limits: 8 worlds. The 95% intervals treat games as independent, and the two games on a world (one from each hill) are not, so they are a
little too narrow; the Keeper's lead over the compiled trail-layer is 14 games to 2 head to head, and the order of the middle brains rests on margins of
a few games.
