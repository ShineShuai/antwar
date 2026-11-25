// Message handler shared by the Worker and the tests: handle(msg) -> { msg, transfer }.
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { RULESETS } from '../src/core/rules.ts';
import { MAX_ROUNDS, createReplay } from '../src/core/replay.ts';
import type { Replay } from '../src/core/replay.ts';
import type { Sim } from '../src/core/sim.ts';
import { loadAnyBrain, ruleAt } from '../src/lang/index.ts';
import type { Compiled } from '../src/lang/index.ts';
import type { Fires, HeatTarget, Reply, Request } from './protocol.ts';

export interface Response { msg: Reply; transfer: Transferable[] }

export function createEngine() {
  let rp: Replay | null = null;
  let compiled: (Compiled | undefined)[] = [];
  let counts: (Fires | null)[] = [];
  let ids: number[][] = [];
  let tracked: number | null = null;
  let heatTarget: HeatTarget | null = null, heat: Uint32Array | null = null, cells = 0;
  let ring: number[] = []; // [round, pc] pairs of the tracked ant, newest last, at most TRACE_MAX pairs
  const TRACE_MAX = 400;
  const fresh = (): (Fires | null)[] => compiled.map((c) => (c ? { test: new Array(c.rules.length).fill(0) as number[], act: new Array(c.rules.length).fill(0) as number[], glue: 0, total: 0 } : null));
  const frame = (s: Sim, stopped?: boolean): Response => {
    const f = s.frame();
    const fires = counts.map((c) => (c ? { test: [...c.test], act: [...c.act], glue: c.glue, total: c.total } : null));
    const h = heat ? heat.slice() : undefined;
    return { msg: { type: 'frame', hash: s.hash(), fires, trace: [...ring], ...(h ? { heat: h } : {}), ...(stopped ? { stopped } : {}), ...f },
      transfer: [f.food.buffer, f.marks.buffer, f.ants.buffer, ...(h ? [h.buffer] : [])] };
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
        if (heat && heatTarget && heatTarget.col === col && (heatTarget.rule === undefined || heatTarget.rule === m.rule) && a.pos >= 0) heat[a.pos]++;
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
            rp = createReplay({ map, programs: loaded.map((l) => l.program), seed: m.seed, rules });
            tracked = null; ring = []; heatTarget = null; heat = null;
            compiled = loaded.map((l) => l.compiled);
            counts = fresh();
            const s = rp.sim;
            ids = loaded.map((_, col) => Array.from({ length: s.ants }, (__, i) => i).filter((i) => s.ant(i).col === col));
            const { W, H, rock, hill } = map;
            cells = W * H;
            return { msg: { type: 'ready', W, H, rock: rock.slice(), hill: hill.slice() }, transfer: [] };
          }
          case 'track':
            if (!rp) throw new Error('not initialised');
            if (m.ant !== null && !(Number.isInteger(m.ant) && m.ant >= 0 && m.ant < rp.sim.ants)) throw new Error(`no ant ${m.ant}`);
            tracked = m.ant; ring = [];
            return frame(rp.sim);
          case 'heat': {
            if (!rp) throw new Error('not initialised');
            const t = m.target;
            if (t !== null) {
              if (!Number.isInteger(t.col) || t.col < 0 || t.col >= compiled.length || !compiled[t.col]) throw new Error(`colony ${t.col} has no rules brain: only rules brains have rules to count`);
              const n = (compiled[t.col] as Compiled).rules.length;
              if (t.rule !== undefined && !(Number.isInteger(t.rule) && t.rule >= 0 && t.rule < n)) throw new Error(`no rule ${t.rule} in colony ${t.col}'s brain`);
            }
            heatTarget = t ? { col: t.col, ...(t.rule === undefined ? {} : { rule: t.rule }) } : null;
            heat = heatTarget ? new Uint32Array(cells) : null;
            return frame(rp.sim);
          }
          case 'run':
            if (!rp) throw new Error('not initialised');
            if (m.until) {
              const s = rp.sim, u = m.until;
              if (!Number.isInteger(u.ant) || u.ant < 0 || u.ant >= s.ants) throw new Error(`no ant ${u.ant}`);
              const comp = compiled[s.ant(u.ant).col];
              if (!comp) throw new Error(`ant ${u.ant} does not run a rules brain: there are no rules to break on`);
              if (!Number.isInteger(u.rule) || u.rule < 0 || u.rule >= comp.rules.length) throw new Error(`no rule ${u.rule} in that brain`);
              const explain = !!m.explain && counts.some(Boolean);
              let stopped = false;
              for (let r = 0; r < m.n; r++) {
                if (r > 0) { const a = s.ant(u.ant); if (a.alive && a.rest <= 0 && ruleAt(comp, a.pc).rule === u.rule) { stopped = true; break; } }
                if (explain) count(s);
                record(s); rp.step();
              }
              return frame(s, stopped);
            }
            if ((m.explain && counts.some(Boolean)) || tracked !== null) {
              const explain = !!m.explain && counts.some(Boolean), s = rp.sim;
              for (let r = 0; r < m.n; r++) { if (explain) count(s); record(s); rp.step(); }
            } else rp.run(m.n);
            return frame(rp.sim);
          case 'seek': { // any round, either way; the followed ant's trace is re-simulated from the keyframe, rule counts restart
            if (!rp) throw new Error('not initialised');
            if (!Number.isSafeInteger(m.round) || m.round < 0 || m.round > MAX_ROUNDS) throw new Error(`bad round ${m.round}`);
            const s = rp.sim;
            ring = []; counts = fresh(); heat?.fill(0);
            rp.seek(m.round, tracked === null ? undefined : () => record(s));
            return frame(s);
          }
          case 'frame':
            if (!rp) throw new Error('not initialised');
            return frame(rp.sim);
          default:
            throw new Error(`unknown message "${(m as { type: string }).type}"`);
        }
      } catch (e) {
        return { msg: { type: 'error', message: e instanceof Error ? e.message : String(e) }, transfer: [] };
      }
    },
  };
}
