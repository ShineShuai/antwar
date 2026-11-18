# Nest stealing (measured)

A pick-up works on any cell that holds food, a nest included, and any ant can stand on any free cell. So the food a colony
delivers is a stash that anyone can take, one packet per visit to its cell. `node cli/eval.ts --vs OTHER` counts it:
`stole` = packets this colony picked up on the other colony's nest cells, `lost` = the other way round.

Everything below: the colony under test against the default trail-layer ("T", `ants/trail.rules` **as it was when measured:
its explorer turned 1 step in 5, i.e. `explore 5`, and it ate a dead end 1 time in 4; the defaults are now `explore 64` and always,
`docs/EXPLORE.md`, `docs/TUNING.md`**), 80 games (40 worlds, both
hills), 100,000 rounds. W-D-L is for the colony under test; food is the median nest food at the end; stole / lost are medians
per game. 480 packets exist on a world.

## What happens

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

## Findings

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

Killing thieves (an ant dies with 5 foes around it; a stash guard would need a squad), a clock to steal late (ants have no
clock; a chain of random timers could approximate one), camping next to the foe's piles to take each packet the moment its
carrier leaves, and making the first delivery cells unattractive to explorers.
