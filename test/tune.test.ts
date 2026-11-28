// Automatic tuning (src/tune.ts, cli/tune.ts): the moves, the scores, the climb on a made-up landscape, the confirmation, the command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Game } from '../src/core/match.ts';
import { headPlayer } from '../src/headtohead.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { DEFAULTS, parsePersonality, personality } from '../src/lang/templates.ts';
import type { Personality } from '../src/lang/templates.ts';
import { climb, confirm, confirmLines, neighbors, pairedDiff, stepLines, worldScores } from '../src/tune.ts';
import type { Evaluate, TuneConfig } from '../src/tune.ts';

const root = new URL('../', import.meta.url).pathname;
const text = (p: Partial<Personality> & Pick<Personality, 'template'>): string => personality({ ...DEFAULTS[p.template], ...p });
const labels = (t: string, mix = false): string[] => neighbors(t, mix).map((m) => m.label);

test('neighbors: each slider one level up and down, within its range', () => {
  assert.deepEqual(labels(text({ template: 'trail' })), [
    'curiosity focused -> steady', 'boldness indifferent -> timid', 'boldness indifferent -> bold', 'sociability follower -> loner', 'sociability follower -> devoted']);
  // at the ends of a slider only one way is left; a forager has no sociability
  assert.deepEqual(labels(text({ template: 'forager', curiosity: 4, boldness: 3 })), ['curiosity wild -> restless', 'boldness fierce -> bold']);
  for (const m of neighbors(text({ template: 'trail' }))) { assert.ok(parsePersonality(m.text), m.label); assert.notEqual(m.text, text({ template: 'trail' })); }
  assert.throws(() => neighbors('hand written\n'), /not a generated personality/);
  assert.throws(() => neighbors(text({ template: 'trail' }) + '# edited\n'), RangeError);
});

test('neighbors: the Keeper\'s settling, with and without a dose that follows the colonies', () => {
  const keeper = text({ template: 'keeper' });
  assert.ok(!keeper.includes('settling='), 'the default level is not written in the text');
  const s = neighbors(keeper).filter((m) => m.label.startsWith('settling'));
  assert.deepEqual(s.map((m) => m.label), ['settling sometimes -> seldom', 'settling sometimes -> often']);
  // one level from the default back to it writes no settling token: the text is the default keeper's
  const seldom = personality({ ...DEFAULTS.keeper, settling: 1 });
  assert.ok(neighbors(seldom).some((m) => m.label === 'settling seldom -> sometimes' && m.text === keeper));
  // a keeper made for three colonies tries every level, and the dose that follows the colonies is gone from the result
  const many = personality({ ...DEFAULTS.keeper, colonies: 3 }), ms = neighbors(many).filter((m) => m.label.startsWith('settling'));
  assert.deepEqual(ms.map((m) => m.label), ['settling 3+ colonies -> rarely', 'settling 3+ colonies -> seldom', 'settling 3+ colonies -> sometimes', 'settling 3+ colonies -> often']);
  assert.ok(ms.every((m) => parsePersonality(m.text)?.colonies === undefined));
  assert.ok(neighbors(many).filter((m) => !m.label.startsWith('settling')).every((m) => parsePersonality(m.text)?.colonies === 3), 'the other sliders keep it');
  assert.ok(neighbors(text({ template: 'trail' })).every((m) => !m.label.startsWith('settling')), 'settling is the Keeper\'s alone');
});

test('neighbors: the role mix moves in steps of 10 points, only when asked and only for trail and raider', () => {
  const trail = text({ template: 'trail' });
  assert.equal(labels(trail).some((l) => l.startsWith('mix')), false);
  assert.deepEqual(labels(trail, true).filter((l) => l.startsWith('mix')), ['mix 100/0/0 -> 90/10/0', 'mix 100/0/0 -> 90/0/10']);
  const mixed = personality({ ...DEFAULTS.trail, mix: { worker: 70, scout: 20, guard: 10 } });
  assert.deepEqual(labels(mixed, true).filter((l) => l.startsWith('mix')), [
    'mix 70/20/10 -> 60/30/10', 'mix 70/20/10 -> 60/20/20', 'mix 70/20/10 -> 80/10/10', 'mix 70/20/10 -> 70/10/20', 'mix 70/20/10 -> 80/20/0', 'mix 70/20/10 -> 70/30/0']);
  assert.ok(neighbors(mixed, true).every((m) => parsePersonality(m.text)), 'every move is a text the sliders can restore');
  assert.equal(labels(text({ template: 'keeper' }), true).some((l) => l.startsWith('mix')), false);
  assert.equal(labels(text({ template: 'raider' }), true).filter((l) => l.startsWith('mix')).length, 2);
});

const g = (seed: number, swap: boolean, f0: number, f1: number): Game => ({ a: 0, b: 1, seed, swap, food: [f0, f1], alive: [91, 91], hash: 0 });

test('worldScores: the mean over the two colours of each world, in seed order; margin or points', () => {
  const games = [g(2, false, 30, 10), g(2, true, 0, 0), g(1, false, 5, 15), g(1, true, 15, 5)];
  assert.deepEqual(worldScores(games, 'margin'), [0, 0.25], 'world 1: -0.5 and +0.5; world 2: +0.5 and an empty game (0)');
  assert.deepEqual(worldScores(games, 'points'), [0.5, 0.75], 'world 1: lost and won; world 2: won and drew');
  assert.deepEqual(worldScores([g(1, false, 0, 0)], 'margin'), [0]);
});

test('pairedDiff: mean, standard error and z of the gain; a gain that is the same everywhere is certain', () => {
  const d = pairedDiff([3, 5, 7], [1, 2, 3]);
  assert.equal(d.mean, 3); assert.equal(d.n, 3); assert.ok(Math.abs(d.se - 1 / Math.sqrt(3)) < 1e-12); assert.ok(Math.abs(d.z - 3 * Math.sqrt(3)) < 1e-9);
  assert.equal(pairedDiff([2, 2, 2], [1, 1, 1]).z, Infinity); assert.equal(pairedDiff([1, 1], [2, 2]).z, -Infinity); assert.equal(pairedDiff([1, 2], [1, 2]).z, 0);
  assert.throws(() => pairedDiff([1], [1]), RangeError); assert.throws(() => pairedDiff([1, 2], [1, 2, 3]), RangeError);
});

// A made-up landscape: the score is minus the distance of the sliders from a target, plus noise that depends on the text and the world.
const TARGET = { curiosity: 2, boldness: 2, sociability: 2 };
const dist = (t: string): number => { const p = parsePersonality(t) as Personality; return Math.abs(p.curiosity - TARGET.curiosity) + Math.abs(p.boldness - TARGET.boldness) + Math.abs(p.sociability - TARGET.sociability); };
const hash = (t: string, seed: number): number => { let h = seed * 2654435761; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 1000; };
const landscape = (noise: number, log?: { text: string; seeds: readonly number[] }[]): Evaluate => async (t, seeds) => {
  log?.push({ text: t, seeds });
  return seeds.map((s) => -dist(t) + (noise * (hash(t, s) - 500)) / 500);
};
const cfg = (o: Partial<TuneConfig> = {}): TuneConfig => ({ seeds: 6, from: 100, maxSteps: 20, z: 2, mix: false, ...o });
const START = text({ template: 'trail', curiosity: 0, boldness: 0, sociability: 0 });

test('climb: reaches the best brain of a landscape, step by step on fresh worlds, and stops there', async () => {
  const log: { text: string; seeds: readonly number[] }[] = [], seen: number[] = [];
  const r = await climb(START, landscape(0.05, log), cfg(), (s) => seen.push(s.step));
  assert.equal(r.stopped, 'optimum'); assert.equal(dist(r.best), 0); assert.equal(r.path.length, 6);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6], 'a last step finds nothing better'); assert.equal(r.steps.at(-1)?.taken, undefined);
  r.steps.forEach((s, k) => assert.deepEqual(s.seeds, Array.from({ length: 6 }, (_, i) => 100 + k * 6 + i), 'fresh worlds every step'));
  // within a step every brain plays the same worlds, and the first brain played is the one held
  for (const s of r.steps) {
    const mine = log.filter((c) => c.seeds[0] === s.seeds[0]);
    assert.equal(mine[0].text, s.brain.text); assert.ok(mine.every((c) => c.seeds.join() === s.seeds.join()));
  }
  // a brain that was held is never tried again
  const held = new Set(r.steps.map((s) => s.brain.text));
  r.steps.forEach((s, k) => assert.ok(s.candidates.every((c) => !r.steps.slice(0, k).some((p) => p.brain.text === c.move.text)), `step ${k}`));
  assert.equal(held.size, 7);
});

test('climb: stops at max-steps; needs z; a flat landscape and a noisy one change nothing', async () => {
  const two = await climb(START, landscape(0.05), cfg({ maxSteps: 2 }));
  assert.equal(two.stopped, 'max-steps'); assert.equal(two.path.length, 2); assert.equal(two.steps.length, 2);
  const flat = await climb(START, async (_t, seeds) => seeds.map(() => 0), cfg());
  assert.equal(flat.stopped, 'optimum'); assert.equal(flat.best, START); assert.deepEqual(flat.path, []);
  // a gain of 1 against noise of +-40 is invisible in 6 worlds: no move with z >= 2, but with z >= 0 the best looking one is taken
  const noisy = landscape(40);
  assert.equal((await climb(START, noisy, cfg({ maxSteps: 1 }))).path.length, 0);
  assert.equal((await climb(START, noisy, cfg({ maxSteps: 1, z: 0 }))).path.length, 1);
  // the move taken is the one with the biggest gain among those that pass
  const best = await climb(START, async (t, seeds) => seeds.map(() => (parsePersonality(t)?.sociability === 1 ? 5 : parsePersonality(t)?.curiosity === 1 ? 3 : 0)), cfg({ maxSteps: 1 }));
  assert.deepEqual(best.path.map((m) => m.label), ['sociability loner -> follower']);
});

test('climb: an evaluation that throws (the budget of a run) ends it with that error', async () => {
  let calls = 0;
  await assert.rejects(climb(START, async (_t, seeds) => { if (++calls > 3) throw new Error('out of time'); return seeds.map(() => 0); }, cfg()), /out of time/);
});

test('stepLines: the brain, every move with its gain, and the move taken', async () => {
  const r = await climb(START, landscape(0.05), cfg({ maxSteps: 1 })), lines = stepLines(r.steps[0]);
  assert.match(lines[0], /^step 1 \(worlds 100\.\.105\): brain scores -6\.0\d\d$/);
  assert.equal(lines.filter((l) => l.startsWith('> ')).length, 1); assert.ok(lines.some((l) => /^ {2}taken: /.test(l)));
  assert.ok(stepLines((await climb(START, async (_t, s) => s.map(() => 0), cfg())).steps[0]).some((l) => /local\) optimum/.test(l)));
});

test('confirm: a clear gain, a clear loss and no difference are told apart', () => {
  const worlds = Array.from({ length: 12 }, (_, i) => i + 1), play = (mine: number, theirs: number): Game[] => worlds.flatMap((s) => [g(s, false, mine, theirs), g(s, true, mine, theirs)]);
  const win = confirm(play(1, 9), play(9, 1)), lose = confirm(play(9, 1), play(1, 9)), same = confirm(play(5, 5), play(5, 5));
  assert.match(confirmLines(win, 'ref', 12).join('\n'), /start +0\.0%.*\n +tuned +100\.0%.*\n.*margin \+1\.600.*points share \+1\.000.*\nThe tuned brain scores clearly higher/);
  assert.match(confirmLines(lose, 'ref', 12).at(-1) ?? '', /clearly WORSE/);
  assert.match(confirmLines(same, 'ref', 12).at(-1) ?? '', /^No clear difference/);
  // the margin can be clear while the score (coarse) is not yet: said so, and not as "no difference"
  const some = worlds.flatMap((s) => [g(s, false, 5 + (s % 3), 5), g(s, true, 5 + (s % 3), 5)]), v = confirmLines(confirm(play(5, 5), some), 'ref', 12).at(-1) ?? '';
  assert.match(v, /margin is clearly higher|clearly higher/);
});

// ---------- the command
const run = (args: string[]) => spawnSync(process.execPath, ['cli/tune.ts', ...args], { cwd: root, encoding: 'utf8' });

test('cli/tune.ts: plays the games of the head-to-head engine, keeps them in a state file, and resumes with any --jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tune-'));
  try {
    const brain = join(dir, 'weak.brain'), ref = join(dir, 'ref.brain'), state = join(dir, 'state.json');
    writeFileSync(brain, text({ template: 'trail', curiosity: 3, boldness: 0, sociability: 0 })); writeFileSync(ref, readFileSync(join(root, 'ants/trail.rules'), 'utf8'));
    const args = [brain, '--vs', ref, '--seeds', '3', '--rounds', '700', '--max-steps', '1', '--confirm', '3', '--json'];
    const a = run([...args, '--jobs', '1', '--state', state]);
    assert.equal(a.status, 0, a.stderr);
    const j = JSON.parse(a.stdout) as { config: Record<string, unknown>; steps: { brain: { scores: number[] }; candidates: { move: { label: string }; scores: number[] }[] }[]; best: string; confirmation?: unknown };
    assert.deepEqual(j.config.symmetric, true); assert.equal(j.config.objective, 'margin'); assert.equal(j.steps.length, 1);
    assert.deepEqual(j.steps[0].candidates.map((c) => c.move.label), labels(readFileSync(brain, 'utf8')), 'every neighbour is played');
    // the scores are those of headPlayer on mirrored worlds, brain first, both colours
    const rules = { rules: 'classic' as const, rounds: 700, symmetric: true }, programs = [readFileSync(brain, 'utf8'), readFileSync(ref, 'utf8')].map((t) => loadAnyBrain(t).program), play = headPlayer(programs, rules);
    const games = [1, 2, 3].flatMap((seed) => [false, true].map((swap) => ({ a: 0, b: 1, seed, swap, ...play({ a: 0, b: 1, seed, swap }) })));
    assert.deepEqual(j.steps[0].brain.scores, worldScores(games, 'margin'));
    const size = statSync(state).size;
    // the same run again with other workers: nothing is played again, the answer is the same
    const b = run([...args, '--jobs', '2', '--state', state]);
    assert.equal(b.status, 0, b.stderr); assert.equal(b.stdout, a.stdout); assert.equal(statSync(state).size, size);
    // contest worlds are another world
    const c = JSON.parse(run([...args, '--contest', '--confirm', '0']).stdout) as typeof j;
    assert.equal(c.config.symmetric, false); assert.notDeepEqual(c.steps[0].brain.scores, j.steps[0].brain.scores);
    // the state belongs to its run
    const d = run([brain, '--vs', ref, '--seeds', '3', '--rounds', '800', '--state', state]);
    assert.equal(d.status, 2); assert.match(d.stderr, /belongs to a run with another/);
    // text output and --out
    const out = join(dir, 'tuned.brain'), t = run([brain, '--vs', ref, '--seeds', '3', '--rounds', '700', '--max-steps', '1', '--confirm', '0', '--out', out]);
    assert.equal(t.status, 0, t.stderr); assert.match(t.stdout, /^weak\.brain tuned against ref\.brain: 3 fresh mirrored worlds a step/); assert.match(t.stdout, /\nstep 1 \(worlds 1\.\.3\)/);
    assert.equal(readFileSync(out, 'utf8'), j.best, 'the tuned brain is written');
    assert.ok(parsePersonality(readFileSync(out, 'utf8')), 'and is a brain the sliders can restore');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cli/tune.ts: refuses what does not make sense (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tune-'));
  try {
    const brain = join(dir, 'a.brain'), hand = join(dir, 'hand.brain'), ref = join(dir, 'ref.brain');
    writeFileSync(brain, text({ template: 'trail' })); writeFileSync(hand, 'mood search\n  otherwise explore\n'); writeFileSync(join(dir, 'junk.brain'), 'this is not a brain\n'); writeFileSync(ref, text({ template: 'forager' }));
    for (const [args, re] of [
      [[brain], /usage: tune\.ts/], [['--vs', ref], /usage/], [[brain, '--vs', ref, '--rules', 'nope'], /unknown ruleset "nope"/], [[brain, '--vs', ref, '--objective', 'wins'], /--objective is one of margin, points/],
      [[brain, '--vs', ref, '--budget', '5'], /--budget needs --state/], [[brain, '--vs', ref, '--seeds', '1'], /--seeds must be an integer >= 2/], [[brain, '--vs', ref, '--confirm', '1'], /--confirm needs 2 or more/],
      [[brain, '--vs', ref, '--z', '0'], /--z must be/], [[hand, '--vs', ref], /not a generated personality/], [[brain, '--vs', join(dir, 'junk.brain')], /in the brain or the reference/],
    ] as [string[], RegExp][]) { const r = run(args); assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, re, args.join(' ')); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
