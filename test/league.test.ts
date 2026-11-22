import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { leagueTable, leagueTasks, rotation } from '../src/league.ts';
import type { LeagueGame } from '../src/league.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('rotation: the brains take each hill once over n games (a Latin square), for 2 to 26 brains', () => {
  assert.deepEqual(rotation(4, 0), [0, 1, 2, 3]);
  assert.deepEqual(rotation(4, 1), [1, 2, 3, 0]);
  assert.deepEqual(rotation(3, 2), [2, 0, 1]);
  for (let n = 2; n <= 26; n++) {
    for (let e = 0; e < n; e++) {
      const hills = Array.from({ length: n }, (_, r) => rotation(n, r).indexOf(e)).sort((a, b) => a - b);
      assert.deepEqual(hills, Array.from({ length: n }, (_, h) => h), `n=${n} entry ${e}`);
    }
    for (let r = 0; r < n; r++) assert.deepEqual([...rotation(n, r)].sort((a, b) => a - b), Array.from({ length: n }, (_, h) => h), `n=${n} rotation ${r}: every entry once`);
  }
});

test('league tasks: n games per world, seed by seed, rotation by rotation', () => {
  assert.deepEqual(leagueTasks(3, [5, 9]), [
    { seed: 5, rot: 0 }, { seed: 5, rot: 1 }, { seed: 5, rot: 2 }, { seed: 9, rot: 0 }, { seed: 9, rot: 1 }, { seed: 9, rot: 2 },
  ]);
  assert.equal(leagueTasks(7, [1, 2, 3, 4]).length, 28);
});

/** The games of a league where the food depends on `food(hill, entry)`. */
const play = (n: number, seeds: number[], food: (hill: number, entry: number) => number): LeagueGame[] =>
  leagueTasks(n, seeds).map((t) => ({ ...t, food: rotation(n, t.rot).map((entry, hill) => food(hill, entry)) }));

test('a league cancels the hill: if only the place counts, every brain scores the same', () => {
  for (let n = 2; n <= 8; n++) {
    const rows = leagueTable(n, play(n, [1, 2, 3], (hill) => 100 - 7 * hill)); // the lowest hill always wins, then the next...
    assert.deepEqual(new Set(rows.map((r) => r.points)).size, 1, `n=${n}: equal points`);
    assert.equal(rows[0].points, 3 * n * (n - 1), `n=${n}: (n - 1) points a game over 3 * n games`);
    assert.deepEqual(rows.map((r) => r.entry), Array.from({ length: n }, (_, e) => e), 'equal rows keep the entry order');
    for (const r of rows) assert.equal(r.firsts, 3, `n=${n}: first once a world`);
    // where the points came from: the hill with the most food gave the most
    assert.deepEqual(rows[0].byHill, Array.from({ length: n }, (_, h) => 3 * 2 * (n - 1 - h)));
  }
});

test('a league ranks the brains: the stronger one scores more whichever hill it sits in', () => {
  const rows = leagueTable(4, play(4, [1, 2], (_hill, entry) => 10 * entry)); // entry 3 always has the most food, entry 0 the least
  assert.deepEqual(rows.map((r) => r.entry), [3, 2, 1, 0]);
  assert.deepEqual(rows.map((r) => r.points), [2 * 4 * 6, 2 * 4 * 4, 2 * 4 * 2, 0]); // 2 worlds * 4 games * (6, 4, 2, 0) points
  assert.deepEqual(rows.map((r) => r.rankSum / r.games), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((r) => r.games), [8, 8, 8, 8]);
  assert.deepEqual([...rows[0].byWorld.entries()], [[1, 24], [2, 24]]);
});

test('equal points are ordered by nest food, then by entry', () => {
  const games: LeagueGame[] = [{ seed: 1, rot: 0, food: [0, 20] }, { seed: 1, rot: 1, food: [0, 1] }]; // entry 1 wins on 20 food, entry 0 on 1
  const rows = leagueTable(2, games);
  assert.deepEqual(rows.map((r) => [r.entry, r.points, r.food]), [[1, 2, 20], [0, 2, 1]]);
});

test('ties: equal food shares the points and the first place', () => {
  const rows = leagueTable(3, play(3, [1], () => 50));
  assert.deepEqual(rows.map((r) => [r.points, r.firsts, r.shared, r.rankSum]), [[6, 0, 3, 3], [6, 0, 3, 3], [6, 0, 3, 3]]); // 3 games * 2 points, always first together
  const two = leagueTable(3, play(3, [1], (_h, e) => (e === 0 ? 10 : 5))); // entry 0 wins outright, 1 and 2 tie for second
  assert.deepEqual(two.map((r) => [r.entry, r.points, r.firsts, r.shared]), [[0, 12, 3, 0], [1, 3, 0, 0], [2, 3, 0, 0]]);
});

const league = (...args: string[]) => spawnSync(process.execPath, ['cli/league.ts', ...args], { cwd: root, encoding: 'utf8' });
const trail = 'ants/trail.rules', crumb = 'ants/crumb.asm', forager = 'ants/forager.rules';

test('cli/league.ts: three brains on fair worlds, the same results with 1 or 2 workers', () => {
  const run = (jobs: string) => league(trail, crumb, forager, '--seeds', '2', '--rounds', '1500', '--jobs', jobs, '--json');
  const a = run('1'), b = run('2');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout, 'results do not depend on --jobs');
  const j = JSON.parse(a.stdout) as { config: { rules: string; world: string }; table: { name: string; games: number; points: number; byHill: number[] }[]; games: unknown[]; meanPointsByHill: number[] };
  assert.deepEqual([j.config.rules, j.config.world, j.games.length], ['classic', 'fair', 6]);
  assert.equal(j.table.length, 3);
  assert.equal(j.table.reduce((s, r) => s + r.points, 0), 6 * 6, 'a game of 3 colonies gives 6 points in all');
  assert.ok(j.table.every((r) => r.games === 6 && r.byHill.length === 3));
  assert.deepEqual(j.meanPointsByHill.map((x) => Math.round(x * 1000) / 1000).reduce((s, x) => s + x, 0), 6, 'the hills together give 6 points a game');
});

test('cli/league.ts: two brains on point-mirror worlds, text table; the same brain twice', () => {
  const r = league(trail, trail, '--seeds', '2', '--rounds', '1000', '--jobs', '1');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 brains, 2 worlds .*point-mirror worlds.*2 rotations each, 1000 rounds, rules classic; 4 games/);
  assert.match(r.stdout, /trail\.rules#1/); assert.match(r.stdout, /trail\.rules#2/);
  assert.match(r.stdout, /Mean points by hill, 1 each when the place does not matter: A .*, B /);
  const c = league(trail, crumb, '--contest', '--seeds', '1', '--rounds', '800', '--json');
  assert.equal((JSON.parse(c.stdout) as { config: { world: string } }).config.world, 'contest');
});

test('cli/league.ts: refuses what does not make sense', () => {
  assert.equal(league(trail).status, 2, 'one brain');
  assert.equal(league(...Array.from({ length: 27 }, () => trail)).status, 2, '27 brains');
  const thirteen = league(...Array.from({ length: 13 }, () => trail), '--seeds', '1', '--rounds', '100');
  assert.equal(thirteen.status, 2); assert.match(thirteen.stderr, /no fair world for 13 colonies/);
  assert.equal(league(trail, crumb, forager, '--contest').status, 2);
  assert.equal(league(trail, crumb, '--rules', 'nope').status, 2);
  assert.equal(league(trail, crumb, '--world', 'ants/nothing.world', '--contest').status, 2);
  assert.equal(league(trail, crumb, '--seeds', '0').status, 2);
  const mism = league(trail, crumb, forager, '--world', 'test/fixtures/tiny.world', '--seeds', '1', '--rounds', '100', '--jobs', '1');
  assert.equal(mism.status, 2); assert.match(mism.stderr, /the world has 2 colonies but 3 brains were given/);
});
