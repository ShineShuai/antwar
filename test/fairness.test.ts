import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateFairWorld } from '../src/core/gen.ts';
import { playColonies } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { fairness, normalTwoSidedP } from '../src/fairness.ts';
import { compileRules } from '../src/lang/index.ts';

const near = (a: number, b: number, tol: number, what: string): void => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const root = fileURLToPath(new URL('..', import.meta.url));

test('normal p-values: the familiar points, symmetric, 1 at zero', () => {
  near(normalTwoSidedP(0), 1, 1e-6, 'z=0');
  near(normalTwoSidedP(1), 0.3173, 1e-4, 'z=1');
  near(normalTwoSidedP(1.96), 0.05, 1e-3, 'z=1.96');
  near(normalTwoSidedP(2.5758), 0.01, 3e-4, 'z=2.576');
  near(normalTwoSidedP(3.2905), 0.001, 1e-4, 'z=3.29');
  assert.equal(normalTwoSidedP(-2), normalTwoSidedP(2));
  assert.ok(normalTwoSidedP(40) < 1e-12);
});

test('fairness of a list of games: the shares, the points, the food, the verdict', () => {
  // three colonies take turns at winning: exactly fair
  const turns = Array.from({ length: 300 }, (_, g) => [0, 1, 2].map((c) => (c === g % 3 ? 10 : 4)));
  const f = fairness(turns);
  assert.deepEqual([f.games, f.colonies], [300, 3]);
  assert.deepEqual(f.rows.map((r) => r.wins), [100, 100, 100]);
  assert.deepEqual(f.rows.map((r) => r.z), [0, 0, 0]);
  assert.equal(f.p, 1); assert.equal(f.fair, true);
  near(f.rows[0].points, (4 + 1 + 1) / 3, 1e-9, 'mean points: 4 as the winner, 1 as one of two tied losers (twice); 3 colonies share n * (n - 1) = 6'); // 2 each
  near(f.rows[0].food, 6, 1e-9, 'mean food');
  near(f.resolution, 1.96 * Math.sqrt((2 / 9) / 300), 1e-12, 'resolution');
  // one colony wins 70 of 100
  const lopsided = fairness(Array.from({ length: 100 }, (_, g) => (g < 70 ? [9, 1] : [1, 9])));
  assert.deepEqual(lopsided.rows.map((r) => r.wins), [70, 30]);
  near(lopsided.rows[0].z, 4, 1e-9, 'z of 70 in 100'); near(lopsided.rows[1].z, -4, 1e-9, 'z');
  assert.ok(lopsided.p < 1e-3 && !lopsided.fair);
  // a tie splits the win; all ties is fair
  const ties = fairness(Array.from({ length: 10 }, () => [5, 5, 5, 5]));
  assert.deepEqual(ties.rows.map((r) => r.wins), [2.5, 2.5, 2.5, 2.5]); assert.equal(ties.fair, true);
  assert.deepEqual(ties.rows.map((r) => r.points), [3, 3, 3, 3]);
  assert.deepEqual(fairness([[7, 7, 1]]).rows.map((r) => r.wins), [0.5, 0.5, 0]);
  // the order of the colonies does not matter
  const games = Array.from({ length: 60 }, (_, g) => [(g * 7) % 5, (g * 3) % 4, g % 6]);
  const a = fairness(games), b = fairness(games.map((r) => [r[2], r[0], r[1]]));
  assert.deepEqual(b.rows.map((r) => r.wins), [a.rows[2].wins, a.rows[0].wins, a.rows[1].wins]);
  assert.equal(a.p, b.p);
  // thin: fewer than MIN_EXPECTED expected wins per colony (games < 10 * colonies)
  const three = (k: number): number[][] => Array.from({ length: k }, (_, g) => [g % 3 === 0 ? 1 : 0, g % 3 === 1 ? 1 : 0, g % 3 === 2 ? 1 : 0]);
  assert.equal(fairness(three(29)).thin, true, '29 games, 3 colonies: just under 10 each');
  assert.equal(fairness(three(30)).thin, false, '30 games, 3 colonies: 10 each');
  assert.equal(fairness(turns).thin, false, '300 games, 3 colonies');
  assert.equal(fairness(Array.from({ length: 100 }, (_, g) => (g % 26 === 0 ? [1, 0] : [0, 1]))).thin, false, '2 colonies, 100 games');
  assert.equal(fairness(Array.from({ length: 259 }, () => new Array<number>(26).fill(1))).thin, true, '26 colonies need 260 games');
  assert.equal(fairness(Array.from({ length: 260 }, () => new Array<number>(26).fill(1))).thin, false);
  assert.throws(() => fairness([]), RangeError);
  assert.throws(() => fairness([[1]]), RangeError);
  assert.throws(() => fairness([[1, 2], [1, 2, 3]]), RangeError);
});

test('the test itself: it rarely cries bias over fair play, and it sees a real bias (3 colonies, 100 games)', () => {
  let seed = 4242;
  const rnd = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };
  const trial = (weights: readonly number[]): boolean => {
    const total = weights.reduce((a, b) => a + b, 0);
    const games = Array.from({ length: 100 }, () => { let r = rnd(total), c = 0; while (r >= weights[c]) { r -= weights[c]; c++; } return [0, 1, 2].map((x) => (x === c ? 100 : 0)); });
    return fairness(games).fair;
  };
  let alarms = 0, misses = 0;
  for (let t = 0; t < 1500; t++) { if (!trial([1, 1, 1])) alarms++; if (trial([2, 1, 1])) misses++; } // 50 / 25 / 25 against 1/3 each
  assert.ok(alarms >= 5 && alarms <= 120, `false alarms: ${alarms} of 1500 (about 5% allowed, Bonferroni makes it less)`);
  assert.ok(misses <= 300, `a 50 / 25 / 25 split missed in ${misses} of 1500`);
});

test('playing it: games of identical brains on a fair world give a row of nest food per game', () => {
  const rules = RULESETS.colonies;
  const prog = compileRules(readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8'), rules).program;
  const map = generateFairWorld(3, 1);
  const foods = [1, 2, 3].map((seed) => playColonies(map, [prog, prog, prog], seed, 1500, rules));
  assert.ok(foods.every((f) => f.length === 3 && f.every((v) => Number.isInteger(v) && v >= 0)));
  assert.deepEqual(foods[0], playColonies(map, [prog, prog, prog], 1, 1500, rules), 'deterministic');
  assert.equal(fairness(foods).colonies, 3);
});

test('cli/fairness.ts: a table or JSON; refuses what does not make sense', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['cli/fairness.ts', 'ants/trail.rules', ...args], { cwd: root, encoding: 'utf8' });
  const ok = run('--colonies', '3', '--map-seed', '1', '--games', '3', '--rounds', '1500', '--json');
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout) as { games: number; colonies: number; rows: unknown[]; rules: string; world: string; fair: boolean };
  assert.deepEqual([j.games, j.colonies, j.rows.length, j.rules], [3, 3, 3, 'classic']);
  assert.match(j.world, /fair worlds, 3 colonies, the map of seed 1/);
  const table = run('--symmetric', '--games', '2', '--rounds', '1000');
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /symmetric worlds, a new world per game \| 2 games of 1000 rounds \| rules classic/);
  assert.match(table.stdout, /^A +\d+\.\d%/m);
  assert.match(table.stdout, /cannot be seen with 2 games/);
  assert.equal(run('--world', 'x.world', '--colonies', '3').status, 2);
  assert.equal(run('--symmetric', '--colonies', '3').status, 2);
  assert.equal(run('--colonies', '13').status, 2);
  assert.equal(run('--games', '0').status, 2);
  assert.equal(run('--rules', 'nope').status, 2);
});

import { foodVsOthers } from '../src/fairness.ts';
test('foodVsOthers: zero under fair play, the size and z of a bias, refused for too little data', () => {
  const fair = [[10, 12, 8], [9, 9, 12], [14, 10, 12], [8, 11, 9]];
  const rows = foodVsOthers(fair.map((f) => [...f]));
  assert.equal(rows.length, 3);
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.mean, 0)) < 1e-9, 'the means of "minus the others" cancel out');
  const biased = Array.from({ length: 50 }, (_, g) => [20 + (g % 3), 10 + (g % 5), 10 + (g % 2)]); // colony A is 10 ahead of each of the others, on average
  const b = foodVsOthers(biased);
  assert.ok(b[0].mean > 9 && b[0].mean < 11 && b[0].z > 10, `${b[0].mean} ${b[0].z}`); assert.ok(b[1].mean < 0 && b[2].mean < 0);
  assert.equal(foodVsOthers([[1, 1], [1, 1]])[0].z, 0, 'no spread: z is 0, not NaN');
  const two = foodVsOthers([[5, 3], [4, 6], [9, 2]]); assert.deepEqual(two.map((r) => Math.round(r.mean * 100) / 100), [2.33, -2.33], 'for two colonies the others are one colony');
  assert.throws(() => foodVsOthers([[1, 2]]), RangeError); assert.throws(() => foodVsOthers([[1], [2]]), RangeError); assert.throws(() => foodVsOthers([]), RangeError);
});

test('scripts/order-bias.ts: plays in pieces, resumes, and reports the same numbers as the library', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'order-')), root = (f: string): string => new URL(`../${f}`, import.meta.url).pathname;
  try {
    const brain = join(dir, 'A.brain'); writeFileSync(brain, readFileSync(root('ants/trail.rules'), 'utf8'));
    const run = (...a: string[]) => spawnSync(process.execPath, [root('scripts/order-bias.ts'), ...a], { encoding: 'utf8' });
    const first = run(brain, '--colonies', '3', '--games', '4', '--rounds', '300', '--budget', '0', '--out', dir);
    assert.equal(first.status, 0, first.stderr); assert.match(first.stdout, /0\/4 games \(budget reached/);
    const piece = (games: string) => run(brain, '--colonies', '3', '--games', games, '--rounds', '300', '--out', dir);
    assert.match(piece('2').stdout, /2\/2 games/); assert.match(piece('4').stdout, /4\/4 games/, 'it goes on from the 2 games already played');
    const file = join(dir, 'foods_3_classic_A.brain_from1.jsonl'), lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 4);
    const direct = spawnSync(process.execPath, [root('cli/fairness.ts'), brain, '--colonies', '3', '--games', '4', '--rounds', '300', '--json'], { encoding: 'utf8' });
    const cli = JSON.parse(direct.stdout) as { rows: { share: number }[] }, mine = fairness(lines.map((l) => JSON.parse(l) as number[]));
    assert.deepEqual(cli.rows.map((r) => r.share), mine.rows.map((r) => r.share), 'the same games as cli/fairness.ts');
    const rep = run('--report', file);
    assert.equal(rep.status, 0, rep.stderr); assert.match(rep.stdout, /^4 fair worlds/); assert.match(rep.stdout, /paired; Bonferroni \|z\| > 2.39 for 3 colonies/); assert.match(rep.stdout, /A: [+-]/);
    assert.equal(run('--report').status, 2); assert.equal(run(brain).status, 2); assert.equal(run(brain, '--colonies', '13', '--games', '1', '--out', dir).status, 2, 'no fair world for 13 colonies');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
