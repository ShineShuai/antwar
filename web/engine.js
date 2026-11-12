// Message handler shared by the Worker and the tests: handle(msg) -> { msg, transfer }.
import { loadBrain } from '../src/core/asm.js';
import { generateWorld } from '../src/core/gen.js';
import { parseMap } from '../src/core/map.js';
import { CLASSIC, TINYMINDS, createSim } from '../src/core/sim.js';

export function createEngine() {
  let sim = null;
  const frame = () => {
    const f = sim.frame();
    return { msg: { type: 'frame', hash: sim.hash(), ...f }, transfer: [f.food.buffer, f.ants.buffer] };
  };
  return {
    handle(m) {
      try {
        if (m.type === 'init') {
          const rules = m.rules === 'tiny' ? TINYMINDS : CLASSIC;
          const map = m.mapText ? parseMap(m.mapText) : generateWorld(m.seed);
          const programs = m.brains.map((text) => loadBrain(text, rules));
          if (programs.length === 1) programs.push(programs[0]);
          sim = createSim({ map, programs, seed: m.seed, rules });
          const { W, H, rock, hill } = map;
          return { msg: { type: 'ready', W, H, rock: rock.slice(), hill: hill.slice() }, transfer: [] };
        }
        if (!sim) throw new Error('not initialised');
        if (m.type === 'run') sim.run(m.n);
        else if (m.type !== 'frame') throw new Error(`unknown message "${m.type}"`);
        return frame();
      } catch (e) {
        return { msg: { type: 'error', message: e.message }, transfer: [] };
      }
    },
  };
}
