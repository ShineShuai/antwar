# Phase 2: does the trail kit work? (measured)

`reference.html` (Easy authoring, Skills) proposes a trail kit, a paired protocol: outbound ants write a step-count-mod-3
code, returning ants step to the neighbour holding code-1. It calls this "unproven" and asks for a hand-written strong
ant, measured, before a Trails level is promised. This is that experiment, for the **Classic** rules (carry 1, 6 markers).

> **Correction.** The first version of this report said the mod-3 kit fails. That was wrong: my explorer had a polarity
> bug (`flipzero 5 else X` falls through 1 time in 5, so it turned 4 steps in 5, a near-random walk). Tangled paths
> overlap themselves, and overlapping paths are what make mod-3 returners loop. With the explorer fixed the kit works.
> The old numbers are kept below as a sensitivity result.

## Results

20 generated 100x100 contest worlds (seeds 1-20, `generateWorld`), one colony alone against an idle one, 100,000 rounds,
480 food per world. `node cli/eval.ts --ant FILE`. Nothing dies in these runs.

| ant | food home, median (min) | worlds with all 480 | rounds to 50% / 90% (median) | delivered per pickup | carriers holding food > 5,000 rounds at the end, per world |
|---|---|---|---|---|---|
| official `starter.ant` fixture | 29 (14) | 0 | - | 0.87 | 68 |
| reference page flat starter | 73 (27) | 0 | - | 0.97 | 72 |
| mod-3 gradient, no food trail | 480 (430) | 10 / 20 | 23,725 / 68,550 | 0.994 | 0.7 |
| mod-3 gradient + food trail | 480 (461) | 18 / 20 | 17,350 / 49,750 | 0.999 | 0.3 |
| breadcrumb, no food trail | 480 (434) | 12 / 20 | 20,075 / 62,700 | 0.997 | 0 |
| **breadcrumb + food trail** | **480 (480)** | **20 / 20** | **15,250 / 44,250** | 1.000 | 0 |

* The harness reproduces the reference's own baseline: its flat starter scores a median 73 here (page: 76, range 22-183).
* The official `starter.ant` is much weaker (29): on a failed move or pickup it returns to the sense state instead of wandering.
* Head to head (`--vs`, both hills): breadcrumb + food trail beats the reference starter 40/40 and loses no ant; in a mirror
  match over 60 worlds colony 0 wins 30 and colony 1 wins 30 (no first-colony bias; 5 are decisive raids, one of
  which kills 65 ants). Against the mod-3 ant with food trail it wins 59 of 80 (74%).

## Findings

1. **The reference's mod-3 kit passes its acceptance test** (>= 95% of carriers return): 99.4-99.9% of pickups are
   delivered and 0.3-0.7 carriers per world (of 91) are still circling at the end. It needs two things the reference
   does not mention:
   * **Persistent exploration.** With the tight random walk (turn 4 steps in 5) the same kit delivered only 87%, left 34
     carriers per world circling, and reached a median of 249 food. Loops come from paths that overlap themselves.
   * **Two anti-jam rules** (below).
2. **Breadcrumbs remove the loops by construction.** Each cell stores the direction back to the cell the explorer came
   from, written once on first entry; a parent is always older than its child, so following parents ends at the nest.
   Measured: 0 stuck carriers, 20/20 complete, 90% of the food home in 44k rounds instead of 50k, and it wins
   head to head. The price is state: heading must live in the pc (Classic cannot read an ant's direction and a carrier
   cannot see the cell behind it), so every routine exists in 6 copies: 567 states against 204 for mod-3.
3. **A food trail needs two anti-jam rules.** Without them it is worse than no trail (16 food, measured with the
   old explorer):
   * *Followers yield.* On a one-cell-wide trail an outbound follower and an inbound carrier block each other forever.
     A follower whose trail move is blocked steps off the lane.
   * *Blocked carriers sidestep* one time in four. Otherwise clusters of carriers and explorers near the nest freeze.
4. **Exploration quality is the biggest lever.** Turning 1 step in 5 instead of 4 in 5 took breadcrumb + food trail from
   a median 415 food (some worlds unfinished) to all 480 on all worlds, and the 50% time from 26k to 15k rounds.
5. Cost, measured (old explorer): 22.5 rounds per carrier step and 28.8 per explorer step; 15 of them are the move's rest.

## The protocols (`ants/gen-trail.ts` mod-3, `ants/gen-crumb.ts` breadcrumb)

* mod-3: markers 0-2 hold the one-hot code (steps from the nest) mod 3, marker 3 is the food trail. An arriving
  explorer adopts the code under it or writes its own (first writer wins); a carrier steps to the neighbour with code-1.
* Breadcrumb: markers 0-2 hold the direction back to the parent + 1 (0 = uncoded), marker 3 the food trail.
* Both: carriers mark every cell they walk; an empty ant on or beside a food-trail cell that continues outwards follows
  it; a trail end is eaten 1 time in 4; food on a nest cell is never picked up (it is a delivered packet).

## Go / no-go

* **Difficulty curve: go.** 29-73 (starters) -> 480 at 100,000 rounds is a wide, climbable range, and the best hand ant
  is still ~8x slower than the reference's rough 5-7k-round estimate (90% of the food at 44k rounds).
  Headroom: better search than a persistent random walk, carrying two (Tinyminds), recruitment.
* **Trails level: go, with the reference's mod-3 kit** (cheapest in states, and it passes) **plus** persistent
  exploration and the two anti-jam rules, shipped inside the kit. Breadcrumbs are the safe alternative when states allow.
* **Rules level:** see `docs/RULES.md` (the compiler, and the kit run through it).

## Reproduce

    node ants/gen-crumb.ts > ants/crumb.asm            # --no-food-trail for the scout
    node ants/gen-trail.ts > ants/trail.asm            # the mod-3 kit
    node cli/eval.ts --ant ants/crumb.asm --seeds 20   # solo, idle opponent
    node cli/eval.ts --ant ants/crumb.asm --vs OTHER --swap --seeds 20

Caveats: our own world generator (the baseline agrees with the page); 20 worlds; one hand design per protocol;
the head-to-head samples are small.
