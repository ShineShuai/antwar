# Replay layer

A replay is inputs plus hashes, never an event log. Code: `src/core/replay.ts` (core: integer-only, no I/O),
`cli/replay.ts`, the workshop timeline.

## Two clocks (settled)

| what | every | stored | used for |
|---|---|---|---|
| hash checkpoint | 1,000 rounds (`HASH_EVERY`) and at the end | 4 bytes (FNV-1a of the state stream) | proof: compared across implementations, kept in the descriptor |
| keyframe | 2,000 rounds (`KEY_EVERY`) | full snapshot (~62 KB at 100x100, ~0.24 MB at 200x200, 2 colonies) | seeking only, never compared |

Both are taken the first time a round is reached (`frontier` = furthest round simulated). The reference gave 1,000 in the
RNG tab and 2,000 in Architecture for "the checkpoint"; they were two different things.

## `createReplay(opts)` (opts = `createSim` options)

- `run(n)`, `step()`: forward, recording. `hashAt(round)`: stored hash at a multiple of 1,000 already reached.
- `seek(round)`: either direction. Restores the keyframe at or below `round` (or keeps the current state when already between
  it and the target) and re-runs < 2,000 rounds. Past the frontier it simulates.
- `seek(round, before)`: the last leg always starts at the keyframe and `before()` runs ahead of every round of it (trace window
  = f(target round)). The workshop uses it to rebuild the followed ant's rule trace.

## Descriptor (JSON)

```
{ "v": 1, "rules": "classic", "seed": 12345,
  "wrap": false,                      // only when false
  "map": "<world text>",              // or "gen": 2 = generateWorld(seed) of that generator version
  "brains": [ { "hash": u32, "ir": {op[],a[],b[],t[],e[]}, "src": "optional, never executed" } ],   // one per colony
  "rounds": 100000, "checkpoints": [u32 ...], "hash": u32 }   // hash after 1000, 2000, ... and after `rounds`
```

Brain hash: FNV-1a over `u32 n`, then per instruction `u8 op, i32 a, i32 b, u16 t, u16 e` (little-endian).
IR has no `goto` (the loaders resolve it); `fromFlat` re-validates every field against the named ruleset.

`verify(json)` never throws; it returns `{ ok: true, rounds, hash }` or `{ ok: false, reason, message, round? }` with reason
`invalid | version | rules | generator | brain | hash`. For `hash`, `round` is the first checkpoint that disagrees (the
divergence is in the 1,000 rounds before it). Caps: 1,000,000 rounds, 26 brains, 10,000 instructions, 128 KB map text.

## CLI

    node cli/replay.ts record --map W --ant A [--ant B] [--rounds 100000] [--seed S] [--rules R] [--no-wrap] [--src] [--out F]
    node cli/replay.ts verify F...            # exit 1 on any mismatch
    node cli/replay.ts seek F ROUND           # state hash and score; `match` when ROUND is a checkpoint

Without `--map` the world is generated from the seed and the descriptor records the generator version.

## Workshop

- Timeline slider and keys: Left/Right = 1 round, Shift = 100, Space = run/pause. Seeking pauses.
- Seeking resets the rule counters ("Explain why") and rebuilds the followed ant's trace from the keyframe.
- **Copy link** adds `result: { round, hash }` when the editors still match the running match. Opening such a link re-runs
  to that round and shows "verified locally" or the two hashes. Links without a result open at round 0 as before.

## Not done

Descriptor export/import in the workshop UI, keyframe thinning for 26 colonies on 200x200 (about 60 MB at 100,000 rounds).
