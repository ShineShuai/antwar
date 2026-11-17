// Flat-assembly programs written to exercise the Tinyminds flags: they pick up greedily and collide, so carrying two,
// blocked carriers and crowded carriers actually happen (random programs rarely do).
/** Picks up twice when it can, then walks home. */
export const GREEDY = `search: sense ahead food else wander
  move else wander
  pickup else wander
  pickup else home
  goto home
wander: flipzero 3 else w2
  turn left
  goto search
w2: flipzero 2 else w3
  turn right
  goto search
w3: move else search
  goto search
home: sense ahead home else hturn
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
  goto home`;

/** Always walking, takes whatever food it stands on, drops at home: ants collide a lot. */
export const CHARGER = `top: sense here food else mv
  pickup else mv
mv: move else rot
  sense here home else top
  drop
  goto top
rot: flipzero 2 else rr
  turn left
  goto top
rr: turn right
  goto top`;
