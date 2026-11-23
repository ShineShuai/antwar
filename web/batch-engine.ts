// The batch Worker's logic without the Worker, so tests can run it in-process (like engine.ts).
import type { Task } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { Outcome } from '../src/core/match.ts';
import type { Program, WorldMap } from '../src/core/types.ts';
import { fairGame, worldMaker } from '../src/fairness.ts';
import { headPlayer } from '../src/headtohead.ts';
import { leaguePlayer } from '../src/league.ts';
import type { LeagueTask } from '../src/league.ts';
import { seriesGame } from '../src/series.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import type { BatchReply, BatchRequest, BatchSetup, FairTask } from './batch-protocol.ts';

export function createBatchEngine(): { handle(m: BatchRequest): BatchReply } {
  let setup: BatchSetup | undefined, programs: Program[] = [], makeWorld: ((seed: number) => WorldMap) | undefined, league: ReturnType<typeof leaguePlayer> | undefined;
  let head: ((t: Task) => Outcome) | undefined;
  return {
    handle(m) {
      try {
        if (m.type === 'init') {
          const s = m.setup;
          if (!Object.hasOwn(RULESETS, s.rules)) return { type: 'error', message: `unknown ruleset "${s.rules}"` };
          setup = undefined; programs = []; makeWorld = undefined; league = undefined; head = undefined;
          const texts = s.kind === 'fair' ? [s.text] : s.texts;
          for (const [i, text] of texts.entries()) {
            try { programs.push(loadAnyBrain(text, RULESETS[s.rules]).program); } catch (e) {
              return { type: 'error', message: e instanceof Error ? e.message : String(e), brain: i };
            }
          }
          if (s.kind === 'fair') { makeWorld = worldMaker(s.world); makeWorld(0); } // (a world that cannot be made is an error now, not at the first game)
          if (s.kind === 'league') { league = leaguePlayer(programs, s); league.world(0); }
          if (s.kind === 'series') seriesGame(programs, { ...s, rounds: 0 }, 0); // the map, the hills and `every` are checked now
          if (s.kind === 'head') head = headPlayer(programs, s);
          setup = s;
          return { type: 'ready' };
        }
        if (!setup) return { type: 'error', message: 'play before init' };
        const rules = RULESETS[setup.rules];
        if (setup.kind === 'series') return { type: 'played', i: m.i, out: { series: seriesGame(programs, setup, (m.task as FairTask).seed) } };
        if (setup.kind === 'league') return { type: 'played', i: m.i, out: { food: (league as NonNullable<typeof league>).play(m.task as LeagueTask) } };
        if (setup.kind === 'fair') {
          const { seed } = m.task as FairTask;
          return { type: 'played', i: m.i, out: { food: fairGame((makeWorld as (seed: number) => WorldMap)(seed), programs[0], seed, setup.rounds, rules) } };
        }
        return { type: 'played', i: m.i, out: (head as (t: Task) => Outcome)(m.task as Task) };
      } catch (e) {
        return { type: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
