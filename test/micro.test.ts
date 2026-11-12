import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIcfp } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';

interface AntCheck { id: number; alive?: boolean; x?: number; y?: number; dir?: number; pc?: number; food?: number; rest?: number }
interface CellCheck { x: number; y: number; food?: number; marks?: number[] }
interface Check { round: number; ants?: AntCheck[]; cells?: CellCheck[]; draws?: number }
interface Case { name: string; map: string; ants: string[]; seed?: number; wrap?: boolean; rules?: RulesId; checks: Check[] }

const file = fileURLToPath(new URL('../spec/micro-tests.json', import.meta.url));
const cases = (JSON.parse(readFileSync(file, 'utf8')) as { cases: Case[] }).cases;

for (const c of cases) {
  test(`micro-test (TypeScript): ${c.name}`, () => {
    const map = parseMap(c.map);
    const rules = RULESETS[c.rules ?? 'classic'];
    const sim = createSim({ map, programs: c.ants.map((t) => parseIcfp(t, rules)), seed: c.seed ?? 12345, wrap: c.wrap ?? true, rules });
    for (const chk of [...c.checks].sort((a, b) => a.round - b.round)) {
      sim.run(chk.round - sim.cycle);
      for (const e of chk.ants ?? []) {
        const a = sim.ant(e.id), x = a.pos % map.W, y = (a.pos - x) / map.W;
        const got: Record<string, number | boolean> = { alive: a.alive, x, y, dir: a.dir, pc: a.pc, food: a.has, rest: a.rest };
        for (const [k, v] of Object.entries(e)) {
          if (k === 'id' || (k === 'x' || k === 'y') && !a.alive) continue;
          assert.equal(got[k], v, `round ${chk.round} ant ${e.id} ${k}`);
        }
      }
      for (const e of chk.cells ?? []) {
        const p = e.y * map.W + e.x;
        if (e.food !== undefined) assert.equal(sim.food[p], e.food, `round ${chk.round} cell ${e.x},${e.y} food`);
        if (e.marks) assert.deepEqual(e.marks.map((_, k) => sim.marks[k * map.W * map.H + p]), e.marks, `round ${chk.round} cell ${e.x},${e.y} marks`);
      }
      if (chk.draws !== undefined) assert.equal(sim.draws, chk.draws, `round ${chk.round} draws`);
    }
  });
}

test('micro-tests (Python second implementation) pass the same data', { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' }, () => {
  const py = spawnSync('python3', [fileURLToPath(new URL('../oracle/micro.py', import.meta.url)), file], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stdout + py.stderr);
});
