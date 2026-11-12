// Message handler shared by the Worker and the tests: handle(msg) -> { msg, transfer }.
import { loadBrain } from '../src/core/asm.ts';
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import type { Sim } from '../src/core/sim.ts';
import type { Reply, Request } from './protocol.ts';

export interface Response { msg: Reply; transfer: Transferable[] }

export function createEngine() {
  let sim: Sim | null = null;
  const frame = (s: Sim): Response => {
    const f = s.frame();
    return { msg: { type: 'frame', hash: s.hash(), ...f }, transfer: [f.food.buffer, f.marks.buffer, f.ants.buffer] };
  };
  return {
    handle(m: Request): Response {
      try {
        switch (m.type) {
          case 'init': {
            if (m.rules !== undefined && m.rules !== 'classic') throw new Error('v1 accepts only the classic ruleset');
            const rules = CLASSIC;
            const map = m.mapText ? parseMap(m.mapText) : generateWorld(m.seed);
            const programs = m.brains.map((text) => loadBrain(text, rules));
            if (programs.length === 1) programs.push(programs[0]);
            sim = createSim({ map, programs, seed: m.seed, rules });
            const { W, H, rock, hill } = map;
            return { msg: { type: 'ready', W, H, rock: rock.slice(), hill: hill.slice() }, transfer: [] };
          }
          case 'run':
            if (!sim) throw new Error('not initialised');
            sim.run(m.n);
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
