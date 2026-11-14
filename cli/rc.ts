#!/usr/bin/env node
// Rules compiler: node cli/rc.ts FILE.rules [--asm] [--fire-counts [--seeds 3] [--rounds 20000]]
// Prints size and lint warnings; --asm prints the flat assembly; --fire-counts runs the program on generated worlds
// (opponent idle) and shows which rule each ant-round is spent in: the sensing of its test, or its action.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateWorld } from '../src/core/gen.ts';
import { createSim } from '../src/core/sim.ts';
import { RulesError, compileRules, ruleAt } from '../src/lang/index.ts';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: {
  asm: { type: 'boolean', default: false }, 'fire-counts': { type: 'boolean', default: false },
  seeds: { type: 'string', default: '3' }, rounds: { type: 'string', default: '20000' },
} });
if (positionals.length !== 1) { console.error('usage: rc.ts FILE.rules [--asm] [--fire-counts [--seeds N] [--rounds R]]'); process.exit(2); }

try {
  const c = compileRules(readFileSync(positionals[0], 'utf8'));
  if (o.asm) { process.stdout.write(c.asm); process.exit(0); }
  console.log(`${positionals[0]}: ${c.rules.length} rules in ${c.moods.length} mood(s) -> ${c.instructions} instructions of 2000, ${c.program.n} states`);
  c.warnings.forEach((w) => console.log(`warning: ${w}`));
  if (o['fire-counts']) {
    const idle = compileRules('always -> drop').program;
    const test = new Array(c.rules.length).fill(0) as number[], act = new Array(c.rules.length).fill(0) as number[];
    let glue = 0, total = 0;
    for (let s = 1; s <= Number(o.seeds); s++) {
      const sim = createSim({ map: generateWorld(s), programs: [c.program, idle], seed: s });
      const mine = Array.from({ length: sim.ants }, (_, i) => i).filter((i) => sim.ant(i).col === 0);
      for (let r = 0; r < Number(o.rounds); r++) {
        for (const i of mine) {
          const a = sim.ant(i);
          if (!a.alive || a.rest > 0) continue; // resting ants do nothing this round
          const m = ruleAt(c, a.pc);
          total++;
          if (m.rule < 0) glue++; else if (m.part === 'test') test[m.rule]++; else act[m.rule]++;
        }
        sim.step();
      }
    }
    const pct = (n: number): string => `${((100 * n) / total).toFixed(1)}%`.padStart(6);
    console.log(`\nshare of the ${total} rounds in which an ant acted (excluding the rest after each move):`);
    console.log('  test   action  rule');
    c.rules.forEach((r, i) => console.log(`${pct(test[i])} ${pct(act[i])}  ${r.mood}: ${r.text}`));
    if (glue) console.log(`${pct(glue)}         (glue)`);
  }
} catch (e) {
  if (e instanceof RulesError) { console.error(e.message); process.exit(1); }
  throw e;
}
