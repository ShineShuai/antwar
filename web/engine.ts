// Message handler shared by the Worker and the tests: handle(msg) -> { msg, transfer }.
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import { createSim } from '../src/core/sim.ts';
import type { Sim } from '../src/core/sim.ts';
import { loadAnyBrain, ruleAt } from '../src/lang/index.ts';
import type { Compiled } from '../src/lang/index.ts';
import type { Fires, Reply, Request } from './protocol.ts';

export interface Response { msg: Reply; transfer: Transferable[] }

export function createEngine() {
  let sim: Sim | null = null;
  let compiled: (Compiled | undefined)[] = [];
  let counts: (Fires | null)[] = [];
  let ids: number[][] = [];
  let tracked: number | null = null;
  let ring: number[] = []; // [round, pc] pairs of the tracked ant, newest last, at most TRACE_MAX pairs
  const TRACE_MAX = 400;
  const frame = (s: Sim): Response => {
    const f = s.frame();
    const fires = counts.map((c) => (c ? { test: [...c.test], act: [...c.act], glue: c.glue, total: c.total } : null));
    return { msg: { type: 'frame', hash: s.hash(), fires, trace: [...ring], ...f }, transfer: [f.food.buffer, f.marks.buffer, f.ants.buffer] };
  };
  /** One ant-round of attribution for every colony whose brain is rules: which rule is the ant about to run? */
  const count = (s: Sim): void => {
    counts.forEach((c, col) => {
      const comp = compiled[col];
      if (!c || !comp) return;
      for (const i of ids[col]) {
        const a = s.ant(i);
        if (!a.alive || a.rest > 0) continue; // resting after a move: nothing runs this round
        const m = ruleAt(comp, a.pc);
        c.total++;
        if (m.rule < 0) c.glue++; else if (m.part === 'test') c.test[m.rule]++; else c.act[m.rule]++;
      }
    });
  };
  /** The tracked ant is about to run one instruction this round (it is not resting): note the round and where it is. */
  const record = (s: Sim): void => {
    if (tracked === null) return;
    const a = s.ant(tracked);
    if (!a.alive || a.rest > 0) return;
    ring.push(s.cycle + 1, a.pc);
    if (ring.length > TRACE_MAX * 2) ring = ring.slice(ring.length - TRACE_MAX * 2);
  };
  return {
    handle(m: Request): Response {
      try {
        switch (m.type) {
          case 'init': {
            const id = m.rules ?? 'classic';
            if (!Object.hasOwn(RULESETS, id)) throw new Error(`unknown ruleset "${String(id)}"; try ${Object.keys(RULESETS).join(', ')}`);
            const rules = RULESETS[id];
            const map = m.mapText ? parseMap(m.mapText) : generateWorld(m.seed);
            const loaded = m.brains.map((text) => loadAnyBrain(text, rules));
            if (loaded.length === 1) loaded.push(loaded[0]);
            sim = createSim({ map, programs: loaded.map((l) => l.program), seed: m.seed, rules });
            tracked = null; ring = [];
            compiled = loaded.map((l) => l.compiled);
            counts = compiled.map((c) => (c ? { test: new Array(c.rules.length).fill(0) as number[], act: new Array(c.rules.length).fill(0) as number[], glue: 0, total: 0 } : null));
            const s = sim;
            ids = loaded.map((_, col) => Array.from({ length: s.ants }, (__, i) => i).filter((i) => s.ant(i).col === col));
            const { W, H, rock, hill } = map;
            return { msg: { type: 'ready', W, H, rock: rock.slice(), hill: hill.slice() }, transfer: [] };
          }
          case 'track':
            if (!sim) throw new Error('not initialised');
            if (m.ant !== null && !(Number.isInteger(m.ant) && m.ant >= 0 && m.ant < sim.ants)) throw new Error(`no ant ${m.ant}`);
            tracked = m.ant; ring = [];
            return frame(sim);
          case 'run':
            if (!sim) throw new Error('not initialised');
            if ((m.explain && counts.some(Boolean)) || tracked !== null) {
              const explain = !!m.explain && counts.some(Boolean);
              for (let r = 0; r < m.n; r++) { if (explain) count(sim); record(sim); sim.step(); }
            } else sim.run(m.n);
            return frame(sim);
          case 'frame':
            if (!sim) throw new Error('not initialised');
            return frame(sim);
          default:
            throw new Error(`unknown message "${(m as { type: string }).type}"`);
        }
      } catch (e) {
        return { msg: { type: 'error', message: e instanceof Error ? e.message : String(e) }, transfer: [] };
      }
    },
  };
}
