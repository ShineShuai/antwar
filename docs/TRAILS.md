# Phase 2: does the trail kit work? (measured)

`reference.html` (Easy authoring, Skills) proposes a trail kit, a paired protocol: outbound ants write a step-count-mod-3
code, returning ants step to the neighbour holding code-1. It calls this "unproven" and asks for a hand-written strong
ant, measured, before a Trails level is promised. This is that experiment, for the **Classic** rules (carry 1, 6 markers).

## Results

20 generated 100x100 contest worlds (seeds 1-20, `generateWorld`), one colony alone against an idle one, 100,000 rounds,
480 food per world. `node cli/eval.ts --ant FILE`. Nothing dies in these runs.

| ant | food home, median (min-max) | worlds with all 480 | rounds to 50% / 90% (median) | delivered per pickup | carriers holding food > 5,000 rounds at the end, per world |
|---|---|---|---|---|---|
| official `starter.ant` fixture | 29 (14-56) | 0 | - | 0.87 | 68 |
| reference page flat starter | 73 (27-116) | 0 | - | 0.97 | 72 |
| **mod-3 gradient** (the kit as specified) | 249 (115-434) | 0 | 65,100 / - | 0.87 | **34** |
| mod-3 gradient + food trail | 16 (3-26) | 0 | - | 0.30 | 35 |
| breadcrumb, no food trail | 339 (209-454) | 0 | 48,250 / - | 0.99 | 0 |
| **breadcrumb + food trail** | **480 (332-480)** | **10 / 20** | **26,350 / 72,325** | 0.99 | 0.2 |

* The harness reproduces the reference's own baseline: its flat starter scores a median 73 here (page: 76, range 22-183).
* The official `starter.ant` is much weaker (29): on a failed move or pickup it returns to the sense state instead of wandering.
* With 300,000 rounds the breadcrumb + food trail ant brings home **all 480 on all 20 worlds**, with no stuck carrier.
  At 100,000 rounds the other 10 worlds are only unfinished, not lost: it is speed-limited, not stuck.
* Head to head (`--vs`): against the reference starter it wins 20/20 on either hill and loses no ant (median 91 alive).
  Mirror match over 60 worlds: colony 0 wins 33, colony 1 wins 27, so no first-colony bias; 5 of the 60 are decisive raids
  (the loser keeps <= 100 food and loses 4-20 ants; the winner collects each fallen ant's 3 + carried packets, and two of the five ended above 480).

## Findings

1. **The mod-3 gradient fails its own acceptance test** (the reference asks for >= 95% of carriers to return). Only 87% of
   pickups are delivered and a third of the colony (34 of 91) is still circling with food at 100,000 rounds. With three
   codes, a neighbour two steps further out looks like a valid "step back" (s+2 = s-1 mod 3), so a carrier can be walked
   outwards and round a loop. Traced: carriers revisit cells every ~15 moves for thousands of rounds. This is the failure
   the reference predicted ("overlapping trails with no decay can send returners around loops"); it is inherent to mod-3.
2. **Breadcrumbs fix it.** Each cell stores the direction back to the cell the explorer came from, written once on first
   entry. A cell's parent is always older than the cell, so following parents ends at the nest and cannot loop.
   Result: 98.8-99.1% delivered, 0 stuck carriers.
3. **A food trail needs two anti-jam rules**, or it makes things worse than no trail (16 food):
   * *Followers yield.* On a one-cell-wide trail an outbound follower and an inbound carrier block each other forever
     (traced: carriers motionless for 5,000+ rounds). A follower whose trail move is blocked steps off the lane.
   * *Blocked carriers sidestep* one time in four. Without it 1-9 carriers per world stayed frozen in clusters near the
     nest; with it, 0. (On worlds 1-5 the median went 415 -> 480.)
4. **Heading must live in the pc.** Classic cannot read an ant's direction, and a carrier cannot see the cell behind it,
   so a returner must know which way it faces to turn toward its parent. Every routine therefore exists in 6 copies and
   every `turn` jumps to the matching copy. The mod-3 kit needs only 3 copies.

## The protocol (`ants/gen-crumb.ts`)

* Markers: 0-2 = parent direction + 1 as a 3-bit number (0 = uncoded); 3 = food trail. 4 of the 6 are used.
* Explorer: arrive, read the 3 bits, write them if the cell is uncoded; look for food (never on a nest cell: that food is
  a delivered packet); follow a food-trail neighbour whose parent points back at us; else wander (1 turn in 5).
* Carrier: drop if on the nest; step in if the nest is ahead; else read the 3 bits, turn at most 3 times, move; mark the
  food trail on every cell; blocked -> retry, 1 in 4 sidestep.
* Cost, measured: 22.5 rounds per carrier step and 28.8 per explorer step (15 of them are the move's own rest).
  567 states with the food trail.

## Go / no-go

* **Difficulty curve: go.** 29-73 (starters) -> 249 (mod-3) -> 339 (breadcrumb) -> 480 (+ food trail) at 100,000 rounds is
  a wide, climbable range, and the best hand ant is still ~10x slower than the reference's rough 5-7k-round estimate
  (90% of the food at 72k rounds). Headroom: exploration (random walk), carrying two (Tinyminds), recruitment.
* **Trail kit: go, but with the breadcrumb protocol, not mod-3**, and ship the two anti-jam rules inside the kit.
  Its contract for the rules compiler: heading-tracked state copies (x6), 4 markers, and a sim test of
  "no carrier holds food for more than 12,000 rounds in 30,000" (`test/ants.test.ts`).
* **Rules level: not evaluated.** There is no rules compiler yet, so the second half of phase 2 ("port it to rules,
  measure the gap") is open. The x6 copies multiply every rule's state count; the 2,000-instruction authoring limit
  needs checking against a real rules program.

## Reproduce

    node ants/gen-crumb.ts > ants/crumb.asm            # --no-food-trail for the scout
    node ants/gen-trail.ts > ants/trail.asm            # the mod-3 kit
    node cli/eval.ts --ant ants/crumb.asm --seeds 20   # solo, idle opponent
    node cli/eval.ts --ant ants/crumb.asm --vs OTHER --swap --seeds 20

Caveats: our own world generator (reference page numbers agree for the baseline); 20 worlds; one hand design per protocol;
the sample sizes for head-to-head are small.
