// The batch Worker's logic without the Worker, so tests can run it in-process (like engine.ts).
import { playGame, worldFor } from '../src/core/match.ts';
import type { Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { Program, WorldMap } from '../src/core/types.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import type { BatchReply, BatchRequest, BatchSetup } from './batch-protocol.ts';

const WORLD_CACHE = 16; // worlds are made once per seed and used by both colours; the tasks of a seed are close together

export function createBatchEngine(): { handle(m: BatchRequest): BatchReply } {
  let setup: BatchSetup | undefined, programs: Program[] = [];
  const worlds = new Map<number, WorldMap>();
  const world = (seed: number, symmetric: boolean): WorldMap => {
    let map = worlds.get(seed);
    if (!map) {
      map = worldFor(seed, symmetric);
      if (worlds.size >= WORLD_CACHE) worlds.delete(worlds.keys().next().value as number);
      worlds.set(seed, map);
    }
    return map;
  };
  return {
    handle(m) {
      try {
        if (m.type === 'init') {
          if (!Object.hasOwn(RULESETS, m.rules)) return { type: 'error', message: `unknown ruleset "${m.rules}"` };
          setup = m; programs = []; worlds.clear();
          for (const [i, text] of m.texts.entries()) {
            try { programs.push(loadAnyBrain(text, RULESETS[m.rules]).program); } catch (e) {
              return { type: 'error', message: e instanceof Error ? e.message : String(e), brain: i };
            }
          }
          return { type: 'ready' };
        }
        if (!setup) return { type: 'error', message: 'play before init' };
        const t: Task = m.task;
        return { type: 'played', i: m.i, out: playGame(world(t.seed, setup.symmetric), programs[t.a], programs[t.b], t, setup.rounds, RULESETS[setup.rules]) };
      } catch (e) {
        return { type: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
