// A sweep of one slider: variants, tasks, the table, and the same games in cli/sweep.ts and in the panel's engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Game } from '../src/core/match.ts';
import { headToHead } from '../src/headtohead.ts';
import { DEFAULTS, TEMPLATES, parsePersonality, personality } from '../src/lang/templates.ts';
import { sweepCommand, sweepHeader, sweepLines, sweepParams, sweepSummary, sweepTasks, sweepVariants } from '../src/sweep.ts';
import type { SweepParam } from '../src/sweep.ts';
import { createBatchEngine } from '../web/batch-engine.ts';
import type { BatchReply } from '../web/batch-protocol.ts';

const root = (f: string): string => fileURLToPath(new URL(`../${f}`, import.meta.url));

test('sweepParams: the sliders each template has', () => {
  const by = Object.fromEntries(TEMPLATES.map((t) => [t, sweepParams(DEFAULTS[t])]));
  assert.deepEqual(by.forager, ['curiosity', 'boldness']);
  assert.deepEqual(by.guard, ['curiosity', 'boldness']);
  assert.deepEqual(by.trail, ['curiosity', 'boldness', 'sociability']);
  assert.deepEqual(by.raider, ['curiosity', 'boldness', 'sociability']);
  assert.deepEqual(by.keeper, ['curiosity', 'boldness', 'sociability', 'settling']);
});

test('sweepVariants: a brain at every level, the level it has marked, hand-edited or idle sliders refused', () => {
  const keeper = personality(DEFAULTS.keeper), v = sweepVariants(keeper, 'settling');
  assert.deepEqual(v.map((x) => x.label), ['rarely (1 in 20)', 'seldom (1 in 15)', 'sometimes (1 in 10)', 'often (1 in 7)']);
  assert.deepEqual(v.map((x) => x.base), [false, false, true, false], 'the default is level 2, 1 in 10');
  assert.equal(v[2].text, keeper, 'the level it has is the brain itself');
  v.forEach((x, i) => assert.deepEqual(parsePersonality(x.text), i === 2 ? DEFAULTS.keeper : { ...DEFAULTS.keeper, settling: i }), 'the default level is written without the settling header');
  const trail = sweepVariants(personality(DEFAULTS.trail), 'curiosity');
  assert.equal(trail.length, 5); assert.deepEqual(trail.map((x) => x.base), [true, false, false, false, false]);
  assert.equal(new Set(trail.map((x) => x.text)).size, 5, 'every level is a different brain');
  assert.throws(() => sweepVariants(personality(DEFAULTS.keeper) + '\n# edited', 'curiosity'), /not a generated personality/);
  assert.throws(() => sweepVariants('Drop 0', 'curiosity'), /not a generated personality/);
  assert.throws(() => sweepVariants(personality(DEFAULTS.forager), 'settling'), /no settling slider/);
  assert.throws(() => sweepVariants(personality(DEFAULTS.guard), 'sociability'), /no sociability slider/);
});

test('sweepTasks and sweepSummary: variant, seed, colour; the reference is the last entry', () => {
  const t = sweepTasks(3, [7, 8]);
  assert.equal(t.length, 3 * 2 * 2);
  assert.deepEqual(t.slice(0, 4), [{ a: 0, b: 3, seed: 7, swap: false }, { a: 0, b: 3, seed: 7, swap: true }, { a: 0, b: 3, seed: 8, swap: false }, { a: 0, b: 3, seed: 8, swap: true }]);
  assert.ok(t.every((x) => x.b === 3 && x.a < 3));
  const g = (a: number, food: [number, number], swap: boolean): Game => ({ a, b: 2, seed: 1, swap, food, alive: [1, 1], hash: 0 });
  const games = [g(0, [5, 3], false), g(0, [4, 4], true), g(1, [0, 9], false), g(1, [1, 8], true)];
  const rows = sweepSummary(2, games);
  assert.deepEqual(rows[0], headToHead([g(0, [5, 3], false), g(0, [4, 4], true)].map((x) => ({ ...x, a: 0, b: 1 }))));
  assert.equal(rows[0].a.points, 3); assert.equal(rows[1].a.points, 0);
  assert.throws(() => sweepSummary(3, games), RangeError, 'a variant without games');
});

test('sweepLines: marks, columns and the legend', () => {
  const many = (win: boolean): Game[] => Array.from({ length: 60 }, (_, k) => ({ a: 0, b: 1, seed: k, swap: k % 2 === 1, food: (win ? [9, 1] : [1, 9]) as [number, number], alive: [1, 1] as [number, number], hash: 0 }));
  const variants = [{ value: 0, label: 'low', base: false, text: '' }, { value: 1, label: 'high', base: true, text: '' }, { value: 2, label: 'mid', base: false, text: '' }];
  const rows = [headToHead(many(false)), headToHead(many(true)), headToHead(many(true).slice(0, 2))];
  const lines = sweepLines('curiosity', variants, rows);
  assert.match(lines[0], /^ {2}curiosity\s+score%/);
  assert.match(lines[1], /^- low {2}\s*0\.0 /); assert.match(lines[2], /^\+\*high\s+100\.0 /); assert.match(lines[3], /^ {2}mid /, 'two games decide nothing');
  assert.match(lines[lines.length - 1], /^\* the level the brain has/);
  assert.equal(sweepHeader('A.brain', 'curiosity', 'B.brain', 20, 30000, 'classic', true, 200), 'A.brain, curiosity swept against B.brain: 20 mirrored worlds, both colours, 30000 rounds, rules classic; 200 games');
  assert.equal(sweepCommand({ brain: 'A.brain', reference: 'B.brain', param: 'settling', seeds: 20, from: 1, rounds: 30000, rules: 'altorder', symmetric: false }),
    'node cli/sweep.ts A.brain --vs B.brain --param settling --seeds 20 --from 1 --rounds 30000 --rules altorder');
});

test('the panel and cli/sweep.ts: the same games and table, with 1 or 2 jobs; usage errors exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
  try {
    const a = personality(DEFAULTS.trail), ref = personality(DEFAULTS.forager);
    writeFileSync(join(dir, 'A.brain'), a); writeFileSync(join(dir, 'B.brain'), ref);
    const job = { brain: join(dir, 'A.brain'), reference: join(dir, 'B.brain'), param: 'curiosity' as SweepParam, seeds: 2, from: 3, rounds: 300, rules: 'classic' as const, symmetric: true };
    const argv = sweepCommand(job).split(' ').slice(2);
    const run = (...extra: string[]) => spawnSync(process.execPath, [root('cli/sweep.ts'), ...argv, ...extra], { encoding: 'utf8' });
    const j1 = run('--json', '--jobs', '1'), j2 = run('--json', '--jobs', '2'), table = run('--jobs', '2');
    for (const r of [j1, j2, table]) assert.equal(r.status, 0, r.stderr);
    assert.equal(j1.stdout, j2.stdout, 'results do not depend on the number of jobs');
    const variants = sweepVariants(a, 'curiosity'), tasks = sweepTasks(variants.length, [3, 4]);
    const e = createBatchEngine();
    assert.equal(e.handle({ type: 'init', setup: { kind: 'head', texts: [...variants.map((v) => v.text), ref], rules: 'classic', rounds: 300, symmetric: true } }).type, 'ready');
    const games: Game[] = tasks.map((t, i) => ({ ...t, ...((e.handle({ type: 'play', i, task: t }) as Extract<BatchReply, { type: 'played' }>).out as Game) }));
    assert.deepEqual((JSON.parse(j1.stdout) as { games: unknown[] }).games, JSON.parse(JSON.stringify(games)));
    const rows = sweepSummary(variants.length, games), lines = table.stdout.trimEnd().split('\n');
    assert.equal(lines[0], sweepHeader('A.brain', 'curiosity', 'B.brain', 2, 300, 'classic', true, games.length));
    assert.deepEqual(lines.slice(1), sweepLines('curiosity', variants, rows));
    const cli = (...x: string[]) => spawnSync(process.execPath, [root('cli/sweep.ts'), ...x], { encoding: 'utf8' });
    assert.equal(cli(join(dir, 'A.brain')).status, 2, 'needs --vs and --param');
    assert.equal(cli(join(dir, 'A.brain'), '--vs', join(dir, 'B.brain'), '--param', 'settling').status, 2, 'a trail-layer has no settling slider');
    writeFileSync(join(dir, 'H.brain'), a + '# edited by hand\n');
    assert.equal(cli(join(dir, 'H.brain'), '--vs', join(dir, 'B.brain'), '--param', 'curiosity').status, 2, 'a hand-edited brain');
    assert.equal(cli(join(dir, 'A.brain'), '--vs', join(dir, 'B.brain'), '--param', 'curiosity', '--seeds', '0').status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
