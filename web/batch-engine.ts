// The batch Worker's logic without the Worker, so tests can run it in-process (like engine.ts).
import { playGame, worldFor } from '../src/core/match.ts';
import type { Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { Program, WorldMap } from '../src/core/types.ts';
import { fairGame, worldMaker } from '../src/fairness.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import type { BatchReply, BatchRequest, BatchSetup, FairTask } from './batch-protocol.ts';

const WORLD_CACHE = 16; // 'head': worlds are made once per seed and used by both colours; the tasks of a seed are close together

export function createBatchEngine(): { handle(m: BatchRequest): BatchReply } {
  let setup: BatchSetup | undefined, programs: Program[] = [], makeWorld: ((seed: number) => WorldMap) | undefined;
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
          const s = m.setup;
          if (!Object.hasOwn(RULESETS, s.rules)) return { type: 'error', message: `unknown ruleset "${s.rules}"` };
          setup = undefined; programs = []; makeWorld = undefined; worlds.clear();
          const texts = s.kind === 'head' ? s.texts : [s.text];
          for (const [i, text] of texts.entries()) {
            try { programs.push(loadAnyBrain(text, RULESETS[s.rules]).program); } catch (e) {
              return { type: 'error', message: e instanceof Error ? e.message : String(e), brain: i };
            }
          }
          if (s.kind === 'fair') { makeWorld = worldMaker(s.world); makeWorld(0); } // (a world that cannot be made is an error now, not at the first game)
          setup = s;
          return { type: 'ready' };
        }
        if (!setup) return { type: 'error', message: 'play before init' };
        const rules = RULESETS[setup.rules];
        if (setup.kind === 'fair') {
          const { seed } = m.task as FairTask;
          return { type: 'played', i: m.i, out: { food: fairGame((makeWorld as (seed: number) => WorldMap)(seed), programs[0], seed, setup.rounds, rules) } };
        }
        const t = m.task as Task;
        return { type: 'played', i: m.i, out: playGame(world(t.seed, setup.symmetric), programs[t.a], programs[t.b], t, setup.rounds, rules) };
      } catch (e) {
        return { type: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
