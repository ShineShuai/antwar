// "Watch this game": the viewer's replay of a WatchSpec ends in the numbers the batch recorded (food per hill, and the state hash).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateFairWorld } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { schedule } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { fairGame, worldMaker } from '../src/fairness.ts';
import type { WorldSpec } from '../src/fairness.ts';
import { headPlayer } from '../src/headtohead.ts';
import { leagueEngine, leagueTasks } from '../src/league.ts';
import type { LeagueWorld } from '../src/league.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { watchFair, watchHead, watchLeague, watchMatch } from '../src/watch.ts';
import type { WatchSpec } from '../src/watch.ts';
import { createEngine } from '../web/engine.ts';
import type { Reply } from '../web/protocol.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const TRAIL = read('ants/trail.rules'), FORAGER = read('ants/forager.rules');
const ROUNDS = 500;

/** What the page does for "Watch": init the replay engine with the spec, run to its end, read the frame. */
function replay(w: WatchSpec): Extract<Reply, { type: 'frame' }> {
  const e = createEngine(), ready = e.handle({ type: 'init', seed: w.seed, mapText: w.mapText, rules: w.rules, brains: w.brains });
  assert.equal(ready.msg.type, 'ready', JSON.stringify(ready.msg));
  const r = e.handle({ type: 'run', n: w.rounds }).msg;
  assert.equal(r.type, 'frame');
  return r as Extract<Reply, { type: 'frame' }>;
}

test('watchHead: both colours, mirrored and contest worlds: the replay is the recorded game', () => {
  const texts = [TRAIL, FORAGER], names = ['A', 'B'];
  for (const symmetric of [true, false]) {
    const o = { texts, names, rules: 'classic' as const, rounds: ROUNDS, symmetric };
    const play = headPlayer(texts.map((t) => loadAnyBrain(t, RULESETS.classic).program), o);
    for (const t of schedule(2, [3, 4])) {
      const g = play(t), w = watchHead(t, o), f = replay(w);
      assert.deepEqual(Array.from(f.score), t.swap ? [g.food[1], g.food[0]] : g.food, `${JSON.stringify(t)} symmetric=${symmetric}`);
      assert.equal(f.hash, g.hash);
      assert.deepEqual(w.hills, t.swap ? ['B', 'A'] : ['A', 'B']);
    }
  }
});

test('watchHead: entries of a sweep (variant, reference) pick their texts and names', () => {
  const o = { texts: [TRAIL, 'Drop 0', FORAGER], names: ['low', 'mid', 'ref'], rules: 'classic' as const, rounds: 100, symmetric: true };
  const w = watchHead({ a: 1, b: 2, seed: 9, swap: true }, o);
  assert.deepEqual(w.brains, [FORAGER, 'Drop 0']); assert.deepEqual(w.hills, ['ref', 'mid']);
  assert.match(w.title, /^ref \(red\) vs mid \(blue\), world 9 \(mirrored\)$/);
});

test('watchLeague: rotations of 2 and 3 brains, a world per seed and a given map', () => {
  const cases: { texts: string[]; world: LeagueWorld }[] = [
    { texts: [TRAIL, FORAGER], world: { kind: 'gen' } },
    { texts: [TRAIL, FORAGER, TRAIL], world: { kind: 'gen' } },
    { texts: [TRAIL, FORAGER, TRAIL], world: { kind: 'map', mapText: formatMap(generateFairWorld(3, 2)) } },
    { texts: [TRAIL, FORAGER], world: { kind: 'gen', contest: true } },
  ];
  for (const { texts, world } of cases) {
    const n = texts.length, names = texts.map((_, i) => String.fromCharCode(65 + i)), o = { texts, names, rules: 'altorder' as const, rounds: ROUNDS, world };
    const player = leagueEngine(texts, o);
    for (const t of leagueTasks(n, [5, 6])) {
      const w = watchLeague(t, o), f = replay(w);
      assert.deepEqual(Array.from(f.score), player.play(t), `${n} brains, ${JSON.stringify(world).slice(0, 30)}, ${JSON.stringify(t)}`);
    }
  }
});

test('watchFair: one brain on every hill, for a map seed, a world per game and a given map', () => {
  const specs: WorldSpec[] = [{ kind: 'fair', colonies: 3, mapSeed: 1 }, { kind: 'mirror' }, { kind: 'contest', mapSeed: 4 }, { kind: 'map', mapText: formatMap(generateFairWorld(4, 2)) }];
  for (const world of specs) {
    const o = { text: TRAIL, name: 'A', rules: 'classic' as const, rounds: ROUNDS, world }, program = loadAnyBrain(TRAIL, RULESETS.classic).program;
    for (const seed of [7, 8]) {
      const w = watchFair(seed, o), f = replay(w);
      assert.deepEqual(Array.from(f.score), fairGame(worldMaker(world)(seed), program, seed, ROUNDS, RULESETS.classic), JSON.stringify(world));
      assert.equal(w.brains.length, w.hills.length);
    }
  }
});

test('watchMatch: the workshop match, with and without map text', () => {
  const o = { texts: [TRAIL, FORAGER], names: ['A', 'B'], seed: 12345, rules: 'classic' as const, rounds: 300 };
  const generated = watchMatch(o), direct = createEngine();
  direct.handle({ type: 'init', seed: 12345, rules: 'classic', brains: o.texts }); // no map text: the generator's world of the seed
  const want = direct.handle({ type: 'run', n: 300 }).msg as Extract<Reply, { type: 'frame' }>;
  assert.equal(replay(generated).hash, want.hash, 'the map as text is the same world');
  const mapText = formatMap(generateFairWorld(3, 5)), given = watchMatch({ ...o, texts: [TRAIL, FORAGER, TRAIL], names: ['A', 'B', 'C'], mapText });
  assert.equal(given.mapText, mapText); assert.equal(parseMap(given.mapText).hill.some((h) => h === 2), true);
  assert.equal(replay(given).score.length, 3);
});
