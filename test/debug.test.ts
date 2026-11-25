// The brain tools' engine side: the heat map (where a rule fires) and break-on-rule, against the real replay engine; and the controller's requests for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULESETS } from '../src/core/rules.ts';
import { loadAnyBrain, ruleAt } from '../src/lang/index.ts';
import { createEngine } from '../web/engine.ts';
import type { Reply, Request } from '../web/protocol.ts';
import { createReplayController } from '../web/replay-controller.ts';
import type { Frame, ReplayWorker } from '../web/replay-controller.ts';
import { STARTER_ASM } from '../web/default-ant.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const TRAIL = read('ants/trail.rules'), FORAGER = read('ants/forager.rules');
const compiled = loadAnyBrain(TRAIL, RULESETS.classic).compiled as NonNullable<ReturnType<typeof loadAnyBrain>['compiled']>;

const f0 = (frame: (m: Request) => Frame): Frame => frame({ type: 'frame' });

function rig(brains = [TRAIL, FORAGER], seed = 5) {
  const e = createEngine();
  const ask = (m: Request): Reply => e.handle(m).msg;
  const frame = (m: Request): Frame => { const r = ask(m); assert.equal(r.type, 'frame', JSON.stringify(r)); return r as Frame; };
  assert.equal(ask({ type: 'init', seed, rules: 'classic', brains }).type, 'ready');
  return { ask, frame };
}
const sum = (h: Uint32Array | undefined): number => (h ? h.reduce((a, x) => a + x, 0) : -1);
/** The ant ids of a colony in a frame (rows: id, cell, colony, direction, carrying, pc). */
const antsOf = (f: Frame, col: number): number[] => Array.from({ length: f.ants.length / 6 }, (_, i) => i * 6).filter((i) => f.ants[i + 2] === col).map((i) => f.ants[i]);

test('heat: the cells add up to the rule counts, for a colony\'s traffic and for one rule', () => {
  const { frame } = rig();
  frame({ type: 'heat', target: { col: 0 } });
  const f = frame({ type: 'run', n: 300, explain: true });
  assert.equal(sum(f.heat), (f.fires[0] as { total: number }).total, 'traffic: every acting ant-round of colony A is on some cell');
  assert.equal(f.heat?.length, f.food.length);
  const fires = f.fires[0] as { test: number[]; act: number[] }, busiest = fires.test.map((t, r) => t + fires.act[r]).reduce((b, x, r, a) => (x > a[b] ? r : b), 0);
  frame({ type: 'seek', round: 0 });
  frame({ type: 'heat', target: { col: 0, rule: busiest } });
  const g = frame({ type: 'run', n: 300, explain: true }), gf = g.fires[0] as { test: number[]; act: number[] };
  assert.equal(sum(g.heat), gf.test[busiest] + gf.act[busiest], `rule ${busiest}`);
  assert.ok(sum(g.heat) > 0 && sum(g.heat) < (gf as unknown as { total: number }).total);
  const other = frame({ type: 'heat', target: { col: 1 } }); // the other colony: a new count, from zero
  assert.equal(sum(other.heat), 0);
});

test('heat: only while the engine explains; a seek, a new target and no target', () => {
  const { frame } = rig();
  frame({ type: 'heat', target: { col: 0 } });
  assert.equal(sum(frame({ type: 'run', n: 100 }).heat), 0, 'no explain: nothing is counted');
  assert.ok(sum(frame({ type: 'run', n: 100, explain: true }).heat) > 0);
  assert.equal(sum(frame({ type: 'seek', round: 50 }).heat), 0, 'a seek restarts the counts');
  frame({ type: 'run', n: 50, explain: true });
  const none = frame({ type: 'heat', target: null });
  assert.equal('heat' in none, false, 'no target, no heat in the frames');
  assert.equal('heat' in frame({ type: 'run', n: 10, explain: true }), false);
});

test('heat: refused for a brain that is not rules, a colony that is not there, a rule that is not there', () => {
  const { ask } = rig([TRAIL, STARTER_ASM]);
  assert.equal(ask({ type: 'heat', target: { col: 0 } }).type, 'frame');
  const e1 = ask({ type: 'heat', target: { col: 1 } }) as Extract<Reply, { type: 'error' }>; assert.equal(e1.type, 'error'); assert.match(e1.message, /no rules brain/);
  assert.match((ask({ type: 'heat', target: { col: 7 } }) as { message: string }).message, /no rules brain/);
  assert.match((ask({ type: 'heat', target: { col: 0, rule: 9999 } }) as { message: string }).message, /no rule 9999/);
  assert.match((ask({ type: 'heat', target: { col: 0, rule: -1 } }) as { message: string }).message, /no rule/);
});

test('run until: stops before the round in which the followed ant is about to run the rule; the first round is always run', () => {
  const { frame } = rig();
  const ids = antsOf(frame({ type: 'frame' }), 0);
  let ant = -1, pairs: [number, number][] = [], seen = new Set<number>();
  const H = 390; // the trace keeps the last 400 acting rounds: stay inside it
  for (const id of ids) { // an ant of colony A that runs several rules (most of them only walk about at first)
    frame({ type: 'seek', round: 0 }); frame({ type: 'track', ant: id });
    const t = frame({ type: 'run', n: H }).trace;
    pairs = []; for (let i = 0; i < t.length; i += 2) pairs.push([t[i], t[i + 1]]);
    seen = new Set(pairs.map(([, pc]) => ruleAt(compiled, pc).rule).filter((r) => r >= 0));
    if (seen.size >= 2) { ant = id; break; }
  }
  assert.ok(ant >= 0, `some ant of colony A runs two rules in ${H} rounds`);
  const rule = pairs.filter(([r, pc]) => r >= 2 && ruleAt(compiled, pc).rule >= 0).map(([r, pc]) => [r, ruleAt(compiled, pc).rule]).reduce((best, [r, rl]) => (r > (best[0] ?? 0) && !pairs.some(([r2, pc2]) => r2 >= 2 && r2 < r && ruleAt(compiled, pc2).rule === rl) ? [r, rl] : best), [0, -1])[1];
  assert.ok(rule >= 0);
  const first = pairs.find(([r, pc]) => r >= 2 && ruleAt(compiled, pc).rule === rule) as [number, number];
  assert.ok(first, 'the rule is run after the first round');
  frame({ type: 'seek', round: 0 });
  const stop = frame({ type: 'run', n: H, until: { ant, rule } });
  assert.equal(stop.stopped, true); assert.equal(stop.cycle, first[0] - 1, 'before the round that would run the rule');
  const row = Array.from({ length: stop.ants.length / 6 }, (_, i) => i * 6).find((i) => stop.ants[i] === ant) as number;
  assert.equal(ruleAt(compiled, stop.ants[row + 5]).rule, rule, 'the ant stands in that rule');
  for (const r of seen) { // every rule the ant runs, including ones it enters right after a move (when it then rests for rounds)
    const firstOf = pairs.find(([round, pc]) => round >= 2 && ruleAt(compiled, pc).rule === r);
    if (!firstOf) continue;
    frame({ type: 'seek', round: 0 }); frame({ type: 'track', ant });
    assert.equal(frame({ type: 'run', n: H, until: { ant, rule: r } }).cycle, firstOf[0] - 1, `rule ${r}`);
  }
  frame({ type: 'seek', round: 0 }); frame({ type: 'track', ant }); frame({ type: 'run', n: H, until: { ant, rule } });
  const probe = frame({ type: 'run', n: 1 }); // the next round is the one in which the ant runs that rule: not a round of resting after a move
  assert.deepEqual(probe.trace.slice(-2).length === 2 && [probe.trace.at(-2), ruleAt(compiled, probe.trace.at(-1) as number).rule], [stop.cycle + 1, rule], 'it acts in that rule in the very next round');
  frame({ type: 'seek', round: stop.cycle }); frame({ type: 'track', ant });
  const next = frame({ type: 'run', n: H, until: { ant, rule } });
  assert.ok(next.cycle > stop.cycle, 'continuing goes past the rule it is in');
  if (next.stopped) assert.equal(ruleAt(compiled, next.ants[(Array.from({ length: next.ants.length / 6 }, (_, i) => i * 6).find((i) => next.ants[i] === ant) as number) + 5]).rule, rule);
  const unused = compiled.rules.findIndex((_, r) => !seen.has(r));
  if (unused >= 0) { frame({ type: 'seek', round: 0 }); const never = frame({ type: 'run', n: 100, until: { ant, rule: unused } }); assert.equal(never.cycle, 100, 'a rule it does not run: the run goes on to its length'); assert.equal(never.stopped, undefined); }
});

test('run until: for several ants and every rule they run, the stop is just before the round in which they act in that rule (not during the rounds of resting after a move)', () => {
  const { frame } = rig(), H = 390;
  let checked = 0;
  for (const id of antsOf(frame({ type: 'frame' }), 0).slice(0, 25)) {
    frame({ type: 'seek', round: 0 }); frame({ type: 'track', ant: id });
    const t = frame({ type: 'run', n: H }).trace, pairs: [number, number][] = [];
    for (let i = 0; i < t.length; i += 2) pairs.push([t[i], t[i + 1]]);
    for (const r of new Set(pairs.map(([, pc]) => ruleAt(compiled, pc).rule).filter((x) => x >= 0))) {
      const rounds = pairs.filter(([round, pc]) => round >= 2 && ruleAt(compiled, pc).rule === r).map(([round]) => round).slice(0, 12);
      frame({ type: 'seek', round: 0 }); frame({ type: 'track', ant: id });
      for (const [k, round] of rounds.entries()) { // each break, one after the other, is just before the next round in which the ant acts in the rule
        assert.equal(frame({ type: 'run', n: H, until: { ant: id, rule: r } }).cycle, round - 1, `ant ${id}, rule ${r}, break ${k + 1}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 20, `${checked} (ant, rule) pairs checked`);
});

test('run until: refused for no ant, a brain that is not rules, no such rule; counts still work while it runs', () => {
  const a = rig(), b = rig([STARTER_ASM, FORAGER]), asmAnt = antsOf(b.frame({ type: 'frame' }), 0)[0];
  assert.match((a.ask({ type: 'run', n: 10, until: { ant: 99999, rule: 0 } }) as { message: string }).message, /no ant/);
  assert.match((a.ask({ type: 'run', n: 10, until: { ant: 0, rule: 99999 } }) as { message: string }).message, /no rule 99999/);
  assert.match((b.ask({ type: 'run', n: 10, until: { ant: asmAnt, rule: 0 } }) as { message: string }).message, /does not run a rules brain/);
  const { frame } = rig();
  frame({ type: 'heat', target: { col: 0 } });
  const f = frame({ type: 'run', n: 50, explain: true, until: { ant: antsOf(f0(frame), 0)[0], rule: 0 } });
  assert.equal(sum(f.heat), (f.fires[0] as { total: number }).total, 'the heat adds up while a break is armed');
});

test('the controller asks for heat and for a break: queued behind a request in flight, ignored (break) when busy', async () => {
  const sent: Request[] = [], engine = createEngine();
  const w: ReplayWorker = { onmessage: null, terminate() {}, postMessage(m) { sent.push(m); const r = engine.handle(m).msg; setTimeout(() => w.onmessage?.({ data: r }), 0); } };
  const frames: Frame[] = [];
  const c = createReplayController({ makeWorker: () => w, speed: () => 20, explain: () => true, schedule: (cb) => void setTimeout(cb, 0) }, { ready() {}, frame: (f) => frames.push(f), error: (m) => { throw new Error(m); }, running() {} });
  const until = async (f: () => boolean): Promise<void> => { const t = Date.now(); while (!f() && Date.now() - t < 10000) await new Promise((r) => setTimeout(r, 2)); assert.ok(f(), 'timed out'); };
  c.load({ type: 'init', seed: 5, rules: 'classic', brains: [TRAIL, FORAGER] }, { rounds: 5000 });
  await until(() => frames.length === 1);
  c.heat({ col: 0 }); await until(() => frames.length === 2); assert.deepEqual(sent.at(-1), { type: 'heat', target: { col: 0 } });
  c.play(); // (sends a run at once, so the next calls find the engine busy)
  c.heat({ col: 0, rule: 1 }); c.heat(null); // a run is in flight (play sent it just now): both are queued, the newest wins
  await until(() => sent.filter((m) => m.type === 'heat').length === 2);
  assert.deepEqual(sent.filter((m) => m.type === 'heat').map((m) => (m as { target: unknown }).target), [{ col: 0 }, null], 'the first of the two was never sent');
  c.pause(); await until(() => !c.running);
  await new Promise((r) => setTimeout(r, 30));
  const mine = antsOf(frames.at(-1) as Frame, 0)[0];
  c.track(mine); await until(() => sent.at(-1)?.type === 'track'); await new Promise((r) => setTimeout(r, 20));
  c.seek(0); await until(() => c.cycle === 0); await new Promise((r) => setTimeout(r, 20));
  const before = sent.length; c.runUntil({ ant: mine, rule: 0 });
  await until(() => sent.length > before);
  assert.deepEqual(sent[before], { type: 'run', n: 5000, until: { ant: mine, rule: 0 }, explain: true });
  await until(() => frames.at(-1)?.stopped === true || c.cycle >= 5000);
  assert.equal(c.running, false);
  c.destroy();
});

// ---- what an ant senses, and the heat tint
import { senses } from '../web/inspect.ts';
import { heatAlpha } from '../web/viewer.ts';

test('senses: here, ahead, left ahead, right ahead, with rock, hills, food, own and foe scents and other ants', () => {
  const W = 6, H = 6, N = 36, rock = new Uint8Array(N), hill = new Int8Array(N).fill(-1), food = new Uint16Array(N), marks = new Uint8Array(2 * N);
  const p = 2 * W + 2; // (2, 2): even row: east is (3, 2); south-east of an even row is (2, 3); north-east is (2, 1)
  const ahead = 2 * W + 3, rightAhead = 3 * W + 2, leftAhead = 1 * W + 2; // facing east (0): right = SE (1), left = NE (5)
  rock[ahead] = 1; food[rightAhead] = 7; marks[rightAhead] = 0b101; marks[N + rightAhead] = 0b10; hill[leftAhead] = 0; marks[p] = 0b1;
  const ants = Int32Array.from([4, p, 0, 0, 0, 3, 9, rightAhead, 1, 2, 1, 5]); // ant 4 (colony A, facing E) and a foe, ant 9, carrying
  const rows = senses({ food, marks, ants }, { W, H, rock, hill }, 0);
  assert.deepEqual(rows.map((r) => r.name), ['here', 'ahead', 'left ahead', 'right ahead']);
  assert.deepEqual(rows.map((r) => r.cell), [p, ahead, leftAhead, rightAhead]);
  assert.equal(rows[0].text, 'own scent 0'); assert.equal(rows[1].text, 'rock'); assert.equal(rows[2].text, 'hill A (home)');
  assert.equal(rows[3].text, 'food 7, own scent 0,2, foe B scent 1, ant #9 (B)');
  const empty = senses({ food: new Uint16Array(N), marks: new Uint8Array(2 * N), ants: Int32Array.from([1, 20, 0, 3, 0, 0]) }, { W, H, rock: new Uint8Array(N), hill: new Int8Array(N).fill(-1) }, 0);
  assert.deepEqual(empty.map((r) => r.text), ['empty', 'empty', 'empty', 'empty']);
  const edge = senses({ food: new Uint16Array(N), marks: new Uint8Array(2 * N), ants: Int32Array.from([1, 0, 0, 3, 0, 0]) }, { W, H, rock: new Uint8Array(N), hill: new Int8Array(N).fill(-1) }, 0);
  assert.ok(edge.every((r) => r.cell >= 0 && r.cell < N), 'the world wraps: every sensed cell is in it');
});

test('heatAlpha: nothing for no count, faint to strong, never above 0.8', () => {
  assert.equal(heatAlpha(0, 10), 0); assert.equal(heatAlpha(5, 0), 0); assert.equal(heatAlpha(-1, 5), 0);
  assert.ok(heatAlpha(1, 1000) >= 0.12 && heatAlpha(1, 1000) < heatAlpha(250, 1000) && heatAlpha(250, 1000) < heatAlpha(1000, 1000));
  assert.ok(Math.abs(heatAlpha(1000, 1000) - 0.8) < 1e-9); assert.equal(heatAlpha(5000, 1000), heatAlpha(1000, 1000));
});
