// The task's own example ant (official .ant syntax).
export const STARTER = `Sense Ahead 1 3 Food ; 0: search: food ahead?
Move 2 0 ; 1: step onto it
PickUp 8 0 ; 2: pick up, go home
Flip 3 4 5 ; 3: wander
Turn Left 0 ; 4
Flip 2 6 7 ; 5
Turn Right 0 ; 6
Move 0 3 ; 7
Sense Ahead 9 11 Home ; 8: go home: home ahead?
Move 10 8 ; 9
Drop 0 ; 10: drop food
Flip 3 12 13 ; 11: wander
Turn Left 8 ; 12
Flip 2 14 15 ; 13
Turn Right 8 ; 14
Move 8 11 ; 15
`;

/** The same ant in flat assembly: labels, `else <label>`, free `goto` (it plays exactly like STARTER; see test/goto.test.ts). */
export const STARTER_ASM = `search: sense ahead food else wander ; look for food
  move else search            ; step onto it
  pickup else search
  goto home
wander: flipzero 3 else w2    ; 1 in 3: turn left
  turn left
  goto search
w2: flipzero 2 else w3        ; 1 in 2: turn right
  turn right
  goto search
w3: move else wander          ; otherwise walk
  goto search
home: sense ahead home else hturn   ; carrying food: is the nest ahead?
  move else home
  drop
  goto search
hturn: flipzero 3 else h2
  turn left
  goto home
h2: flipzero 2 else h3
  turn right
  goto home
h3: move else hturn
  goto home
`;

/** Rules examples: these are exactly ants/forager.rules and ants/trail.rules (test/brain.test.ts keeps them in step). */
export const FORAGER_RULES = `# Level 1 forager (no kits): look for food, carry it home by luck. The reference's starter, as rules.
mood search
  when food ahead and not home ahead -> move
  when food here and not home here -> pickup, switch home
  otherwise wander

mood home
  when home here -> drop, switch search
  when home ahead -> move
  otherwise wander
`;

export const TRAIL_RULES = `# Trail forager (rules version of ants/trail.asm): the mod-3 trail kit plus a food trail.
kit trail
kit foodtrail

mood start
  always -> turn random, switch search

mood search
  when food here and not home here -> pickup, lay trail, turn around, switch return
  when food ahead and not home ahead -> step
  when food left ahead and not home left ahead -> turn left, step
  when food right ahead and not home right ahead -> turn right, step
  always -> follow trail
  otherwise explore

mood return
  when home here -> drop, turn random, switch search
  always -> return home
  when home ahead -> move
  when home left ahead -> turn left, move
  when home right ahead -> turn right, move
  otherwise roam
`;

export const EXAMPLES: readonly { name: string; text: string }[] = [
  { name: 'Starter (official .ant)', text: STARTER },
  { name: 'Starter (flat asm)', text: STARTER_ASM },
  { name: 'Forager (rules, no trails)', text: FORAGER_RULES },
  { name: 'Trail forager (rules, trail kit)', text: TRAIL_RULES },
  { name: 'Charger (always moves)', text: 'Move 0 1\nTurn Left 0\n' },
  { name: 'Idle (does nothing)', text: 'Drop 0\n' },
];
