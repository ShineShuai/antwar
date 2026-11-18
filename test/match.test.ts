import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrain, parseIcfp } from '../src/core/asm.ts';
import { CLASSIC_WORLD, SYMMETRIC_WORLD, allReachable, generateWorld, isSymmetric, twinOf } from '../src/core/gen.ts';
import { disk, step } from '../src/core/hex.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { MATCH_ROUNDS, colourSplit, pairwise, playGame, points, schedule, standings, worldFor } from '../src/core/match.ts';
import type { Game } from '../src/core/match.ts';
import { record } from '../src/core/replay.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { CLASSIC, createSim, fnv1a } from '../src/core/sim.ts';
import type { WorldMap } from '../src/core/types.ts';
import { lcg, randIcfp } from '../testlib/random.ts';

const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;
const starter = parseIcfp(fx('starter.ant'), CLASSIC), idle = loadBrain('Drop 0', CLASSIC);
const cellsOf = (m: WorldMap, pred: (p: number) => boolean): number[] => [...m.rock.keys()].filter(pred);

test('2 / 1 / 0 points per game', () => {
  assert.deepEqual([points(5, 4), points(4, 4), points(0, 0), points(3, 9)], [2, 1, 1, 0]);
  assert.equal(MATCH_ROUNDS, 100000);
});

test('the point mirror is a symmetry of the hex grid (even height): neighbours map to opposite neighbours, torus included', () => {
  for (const [W, H] of [[8, 6], [7, 10], [4, 4]]) {
    const n = W * H, at = (x: number, y: number): number => ((y + H) % H) * W + ((x + W) % W);
    for (let p = 0; p < n; p++) {
      const x = p % W, y = (p - x) / W;
      for (let d = 0; d < 6; d++) {
        const [nx, ny] = step(x, y, d), [tx, ty] = step(W - 1 - x, H - 1 - y, (d + 3) % 6);
        assert.equal(at(tx, ty), twinOf(n, at(nx, ny)), `${W}x${H} cell ${p} direction ${d}`);
      }
    }
  }
});

test('symmetric worlds: contest elements as mirrored pairs; the classic generator is unchanged', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const m = generateWorld(seed, SYMMETRIC_WORLD);
    assert.ok(isSymmetric(m), `seed ${seed}`);
    assert.ok(allReachable(m));
    const food = cellsOf(m, (p) => m.food[p] > 0);
    assert.deepEqual([food.length, food.reduce((s, p) => s + m.food[p], 0)], [96, 480]);
    for (const c of [0, 1]) {
      const set = new Set(cellsOf(m, (p) => m.hill[p] === c));
      assert.equal(set.size, 91);
      assert.ok([...set].some((p) => disk(p % 100, (p - (p % 100)) / 100, 5).every(([x, y]) => set.has(y * 100 + x))), `hill ${c} is a hexagon of side 6`);
    }
    // the second hill is the first one's twin
    assert.ok(cellsOf(m, (p) => m.hill[p] === 0).every((p) => m.hill[twinOf(10000, p)] === 1));
    // nothing but the perimeter and ten separate rocks: all twins, none touching a hill
    const rocks = cellsOf(m, (p) => m.rock[p] === 1 && p % 100 > 0 && p % 100 < 99 && p > 99 && p < 9900);
    assert.ok(rocks.length >= 10 * 8 && rocks.length <= 10 * 30);
    assert.ok(cellsOf(m, (p) => m.hill[p] >= 0).every((p) => [0, 1, 2, 3, 4, 5].every((d) => { const [x, y] = step(p % 100, (p - (p % 100)) / 100, d); return !m.rock[y * 100 + x]; })));
    assert.equal(formatMap(m), formatMap(generateWorld(seed, SYMMETRIC_WORLD)), 'deterministic');
  }
  assert.equal(isSymmetric(generateWorld(1)), false);
  assert.notEqual(formatMap(worldFor(4, true)), formatMap(worldFor(4, false)));
  assert.throws(() => generateWorld(1, { ...SYMMETRIC_WORLD, rocks: 9 }), /even/);
  assert.throws(() => generateWorld(1, { ...SYMMETRIC_WORLD, blobs: 7 }), /even/);
  assert.throws(() => generateWorld(1, { ...SYMMETRIC_WORLD, H: 99 }), /even/);
  // output of the contest generator for fixed seeds must not move (GENERATOR_VERSION stays 2); these hash the text, so they
  // moved once when formatMap's leading space went from even to odd rows (the worlds are identical)
  const enc = new TextEncoder();
  assert.deepEqual([1, 2, 3, 7, 12345, 99999].map((s) => fnv1a(enc.encode(formatMap(generateWorld(s, CLASSIC_WORLD))))),
    [2713063197, 3251088190, 1135346377, 2471877558, 976522501, 3859611524]);
});

test('isSymmetric rejects each kind of asymmetry', () => {
  const m = generateWorld(2, SYMMETRIC_WORLD), n = 10000;
  const free = (f: (x: WorldMap) => void): WorldMap => { const x: WorldMap = { ...m, rock: m.rock.slice(), food: m.food.slice(), hill: m.hill.slice() }; f(x); return x; };
  const p = cellsOf(m, (q) => m.food[q] > 0)[0], r = cellsOf(m, (q) => q % 100 === 50 && !m.rock[q] && m.hill[q] < 0 && !m.food[q])[0];
  assert.equal(isSymmetric(free((x) => { x.food[p]++; })), false);
  assert.equal(isSymmetric(free((x) => { x.rock[r] = 1; })), false);
  assert.equal(isSymmetric(free((x) => { const h = x.hill.findIndex((v) => v === 0); x.hill[h] = 1; x.hill[twinOf(n, h)] = 1; })), false, 'twin hills must differ');
  assert.equal(isSymmetric({ ...m, H: 99 }), false);
});

test('playGame: equals a direct run and a replay descriptor; swap puts the first brain on the second hill', () => {
  const map = parseMap(fx('tiny.world'));
  const plain = playGame(map, starter, idle, { seed: 1, swap: false }, 3000), flip = playGame(map, starter, idle, { seed: 1, swap: true }, 3000);
  const direct = createSim({ map, programs: [starter, idle], seed: 1 }); direct.run(3000);
  assert.deepEqual(plain, { food: [direct.score()[0], direct.score()[1]], alive: [direct.alive(0), direct.alive(1)], hash: direct.hash() });
  assert.ok(plain.food[0] > 0, 'the starter ant brought food home');
  const back = createSim({ map, programs: [idle, starter], seed: 1 }); back.run(3000);
  assert.deepEqual(flip.food, [back.score()[1], back.score()[0]], 'a keeps its own nest food in slot 0');
  assert.equal(flip.hash, back.hash());
  assert.equal(record({ rules: 'classic', seed: 1, rounds: 3000, programs: [starter, idle], map: fx('tiny.world') }).hash, plain.hash, 'a game is a replay');
});

test('schedule: every pair, seed and colour exactly once, in a fixed order', () => {
  const s = schedule(3, [5, 6]);
  assert.equal(s.length, 3 * 2 * 2);
  assert.deepEqual(s.slice(0, 4), [{ a: 0, b: 1, seed: 5, swap: false }, { a: 0, b: 1, seed: 5, swap: true }, { a: 0, b: 1, seed: 6, swap: false }, { a: 0, b: 1, seed: 6, swap: true }]);
  assert.equal(new Set(s.map((t) => JSON.stringify(t))).size, s.length);
  assert.ok(s.every((t) => t.a < t.b));
  assert.deepEqual(schedule(1, [1]), []);
});

test('standings, pairwise and colour split, worked out by hand', () => {
  const g = (a: number, b: number, swap: boolean, food: [number, number]): Game => ({ a, b, seed: 1, swap, food, alive: [91, 91], hash: 0 });
  const games = [g(0, 1, false, [10, 5]), g(0, 1, true, [3, 3]), g(0, 2, false, [0, 7]), g(1, 2, true, [4, 2]), g(1, 2, false, [1, 6]), g(0, 2, true, [2, 9])];
  assert.deepEqual(standings(3, games), [
    { entry: 2, games: 4, points: 6, wins: 3, draws: 0, losses: 1, margin: 17 },
    { entry: 1, games: 4, points: 3, wins: 1, draws: 1, losses: 2, margin: -8 }, // ties entry 0 on points; the food margin decides
    { entry: 0, games: 4, points: 3, wins: 1, draws: 1, losses: 2, margin: -9 },
  ]);
  assert.deepEqual(pairwise(3, games), { points: [[0, 3, 0], [1, 0, 2], [4, 2, 0]], games: [[0, 2, 2], [2, 0, 2], [2, 2, 0]] });
  assert.deepEqual(colourSplit(games), { first: 2, second: 3, draws: 1 });
  assert.deepEqual(standings(2, []).map((r) => r.points), [0, 0]);
});

test('Python oracle agrees on games from symmetric worlds, both colours', { skip: !hasPython && 'python3 not found' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-'));
  try {
    const r = lcg(4242), other = randIcfp(r, 18), map = worldFor(9, true), mapFile = join(dir, 'm.world');
    writeFileSync(mapFile, formatMap(map)); writeFileSync(join(dir, 'a.ant'), fx('starter.ant')); writeFileSync(join(dir, 'b.ant'), other);
    const B = parseIcfp(other, CLASSIC);
    for (const swap of [false, true]) {
      const files = swap ? ['b.ant', 'a.ant'] : ['a.ant', 'b.ant'];
      const py = spawnSync('python3', [root('oracle/ref.py'), '--map', mapFile, ...files.flatMap((f) => ['--ant', join(dir, f)]), '--rounds', '2500', '--seed', '9'], { encoding: 'utf8' });
      assert.equal(py.status, 0, py.stderr);
      const out = JSON.parse(py.stdout.trim().split('\n').at(-1) as string) as { hash: number };
      assert.equal(playGame(map, starter, B, { seed: 9, swap }, 2500).hash, out.hash, swap ? 'swapped' : 'plain');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tourney CLI: totals add up, results do not depend on --jobs, every game hash is reproducible', () => {
  const brains = ['test/fixtures/starter.ant', 'ants/forager.rules', 'ants/trail.rules'].map(root);
  const run = (...args: string[]) => spawnSync(process.execPath, [root('cli/tourney.ts'), ...args], { encoding: 'utf8' });
  const a = run(...brains, '--seeds', '2', '--rounds', '800', '--symmetric', '--json', '--jobs', '1'), b = run(...brains, '--seeds', '2', '--rounds', '800', '--symmetric', '--json', '--jobs', '3');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout, 'same output with 1 and 3 workers');
  const j = JSON.parse(a.stdout) as { config: { symmetric: boolean; seeds: number[] }; entries: string[]; standings: { points: number; games: number; entry: number }[]; games: Game[]; colourSplit: { first: number; second: number; draws: number } };
  assert.deepEqual([j.entries, j.config.seeds, j.config.symmetric], [['starter.ant', 'forager.rules', 'trail.rules'], [1, 2], true]);
  assert.equal(j.games.length, 12);
  assert.equal(j.standings.reduce((s, r) => s + r.points, 0), 2 * j.games.length, 'each game hands out 2 points in total: 2+0 or 1+1');
  assert.ok(j.standings.every((r) => r.games === 8));
  assert.equal(Object.values(j.colourSplit).reduce((x, y) => x + y, 0), 12);
  const progs = brains.map((f) => loadAnyBrain(readFileSync(f, 'utf8'), CLASSIC).program);
  for (const g of [j.games[0], j.games[5], j.games[11]]) {
    assert.deepEqual(playGame(worldFor(g.seed, true), progs[g.a], progs[g.b], g, 800), { food: g.food, alive: g.alive, hash: g.hash }, `game ${g.a}-${g.b} seed ${g.seed} swap ${g.swap}`);
  }
  const text = run(...brains, '--seeds', '1', '--rounds', '200', '--jobs', '1', '--games');
  assert.match(text.stdout, /3 brains, 1 worlds \(seeds 1\.\.1\), both colours, 200 rounds, rules classic; 6 games/);
  assert.match(text.stdout, /points taken by the row brain/);
  assert.equal((text.stdout.match(/ vs .* seed 1/g) ?? []).length, 6);
});

test('tourney CLI: refuses bad input with exit code 2', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [root('cli/tourney.ts'), ...args], { encoding: 'utf8' });
  const dir = mkdtempSync(join(tmpdir(), 'tourney-'));
  try {
    const ok = root('test/fixtures/starter.ant'), broken = join(dir, 'broken.ant');
    writeFileSync(broken, 'Move 99 0\n');
    for (const args of [[ok], [ok, ok, '--seeds', '0'], [ok, ok, '--rounds', 'x'], [ok, ok, '--rules', 'chess'], [ok, ok, '--jobs', '0'], [ok, broken]]) {
      const r = run(...args);
      assert.equal(r.status, 2, args.join(' '));
      assert.ok(r.stderr.length > 0);
    }
    assert.match(run(ok, broken).stderr, /state must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gen CLI: --symmetric writes a symmetric world in the official format', () => {
  const r = spawnSync(process.execPath, [root('cli/gen.ts'), '5', '--symmetric'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(isSymmetric(parseMap(r.stdout)));
  const c = spawnSync(process.execPath, [root('cli/gen.ts'), '5'], { encoding: 'utf8' });
  assert.equal(c.stdout, formatMap(generateWorld(5)));
});
