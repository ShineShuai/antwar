import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadBrain } from '../src/core/asm.ts';
import { generateWorld } from '../src/core/gen.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';

const root = new URL('../', import.meta.url).pathname;
const ANTS = [
  { file: 'ants/crumb.asm', gen: 'ants/gen-crumb.ts', args: [] },
  { file: 'ants/crumb-scout.asm', gen: 'ants/gen-crumb.ts', args: ['--no-food-trail'] },
  { file: 'ants/trail.asm', gen: 'ants/gen-trail.ts', args: [] },
  { file: 'ants/scout.asm', gen: 'ants/gen-trail.ts', args: ['--no-food-trail'] },
];

test('committed ant programs are exactly what their generators print, and they all assemble under Classic', () => {
  for (const a of ANTS) {
    const r = spawnSync(process.execPath, [a.gen, ...a.args], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(`${root}${a.file}`, 'utf8'), r.stdout, `${a.file} is stale: rerun ${a.gen} ${a.args.join(' ')}`);
    assert.ok(loadBrain(r.stdout, CLASSIC).n < 2000, a.file);
  }
});

test('breadcrumb ant: forages from a cold start and no carrier freezes (docs/TRAILS.md)', () => {
  const brain = loadBrain(readFileSync(`${root}ants/crumb.asm`, 'utf8'), CLASSIC), idle = loadBrain('Drop 0', CLASSIC);
  for (const seed of [1, 2, 3]) {
    const sim = createSim({ map: generateWorld(seed), programs: [brain, idle], seed });
    const streak = new Map<number, number>();
    let longest = 0;
    for (let r = 50; r <= 30000; r += 50) {
      sim.run(50);
      for (let i = 0; i < sim.ants; i++) {
        const a = sim.ant(i);
        if (a.col !== 0) continue;
        const k = a.has > 0 ? (streak.get(i) ?? 0) + 1 : 0;
        streak.set(i, k);
        longest = Math.max(longest, k);
      }
    }
    // a trip takes ~1,000-2,500 rounds and a jam clears within ~16,000 (seed 5 in 100,000 rounds); a frozen carrier would hold for the whole run.
    // The mod-3 gradient this replaces leaves about a third of the colony circling with food.
    assert.ok(longest * 50 <= 12000, `seed ${seed}: a carrier held food for ${longest * 50} rounds`);
    assert.ok(sim.score()[0] >= 150, `seed ${seed}: only ${sim.score()[0]} food after 30,000 rounds`);
  }
});

test('eval CLI: JSON summary for a short run', () => {
  const r = spawnSync(process.execPath, ['cli/eval.ts', '--ant', 'ants/crumb.asm', '--seeds', '1', '--rounds', '2000', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout) as { summary: { seeds: number; rounds: number }; rows: { seed: number; total: number }[] };
  assert.equal(j.summary.seeds, 1);
  assert.equal(j.summary.rounds, 2000);
  assert.equal(j.rows[0].total, 480);
});
