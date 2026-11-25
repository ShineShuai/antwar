// The replay loop of the viewers (web/replay-controller.ts) against the real replay engine, in this process, without a DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { playColonies } from '../src/core/match.ts';
import { RULESETS } from '../src/core/rules.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { createEngine } from '../web/engine.ts';
import type { Reply, Request } from '../web/protocol.ts';
import { createReplayController } from '../web/replay-controller.ts';
import type { Frame, InitRequest, Ready, ReplayWorker } from '../web/replay-controller.ts';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const TRAIL = read('ants/trail.rules'), FORAGER = read('ants/forager.rules');
const init = (seed = 5, brains = [TRAIL, FORAGER]): InitRequest => ({ type: 'init', seed, rules: 'classic', brains });

/** A Worker around the real engine; replies come on a later tick, as from a real Worker. `log` records what the page asked and what it let go of. */
function fake(log: { sent: Request[]; made: number; terminated: number }): ReplayWorker {
  const engine = createEngine();
  let dead = false;
  log.made++;
  const w: ReplayWorker = {
    onmessage: null,
    postMessage(m) { log.sent.push(m); const r = engine.handle(m).msg; setTimeout(() => { if (!dead) w.onmessage?.({ data: r }); }, 0); },
    terminate() { dead = true; log.terminated++; },
  };
  return w;
}

function rig(speed = 100, opts: { explain?: boolean } = {}) {
  const log = { sent: [] as Request[], made: 0, terminated: 0 }, events = { ready: [] as Ready[], frames: [] as Frame[], errors: [] as string[], running: [] as boolean[] };
  const c = createReplayController({ makeWorker: () => fake(log), speed: () => speed, explain: () => opts.explain ?? false, schedule: (cb) => void setTimeout(cb, 0) }, {
    ready: (m) => events.ready.push(m), frame: (f) => events.frames.push(f), error: (e) => events.errors.push(e), running: (on) => events.running.push(on),
  });
  const until = async (cond: () => boolean, ms = 10000): Promise<void> => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 2)); assert.ok(cond(), 'timed out'); };
  return { c, log, events, until };
}
const expected = (seed: number, rounds: number): number[] => playColonies(generateWorld(seed), [TRAIL, FORAGER].map((t) => loadAnyBrain(t, RULESETS.classic).program), seed, rounds, RULESETS.classic);

test('load: ready, then the first frame at round 0, paused', async () => {
  const { c, events, until, log } = rig();
  c.load(init(), { rounds: 500 });
  await until(() => events.frames.length === 1);
  assert.equal(events.ready.length, 1); assert.ok(events.ready[0].W > 0);
  assert.equal(events.frames[0].cycle, 0); assert.equal(c.cycle, 0); assert.equal(c.running, false); assert.equal(c.last, events.frames[0]);
  assert.deepEqual(log.sent.map((m) => m.type), ['init', 'frame']);
});

test('play runs the match at `speed` rounds a frame and stops at its end', async () => {
  const { c, events, until } = rig(100);
  c.load(init(), { rounds: 250 });
  await until(() => events.frames.length === 1);
  c.play();
  await until(() => !c.running && c.cycle === 250);
  assert.deepEqual(events.frames.map((f) => f.cycle), [0, 100, 200, 250]);
  assert.deepEqual(events.running, [true, false]);
  assert.deepEqual(Array.from(c.last?.score ?? []), expected(5, 250), 'the last frame is what a plain game gives');
});

test('seek: clamped, pauses, backwards and forwards give the same game; only the newest queued seek is made', async () => {
  const { c, events, until, log } = rig(50);
  c.load(init(), { rounds: 400 });
  await until(() => events.frames.length === 1);
  c.play(); await until(() => c.cycle >= 100);
  c.seek(9999); // while a run is in flight: queued, and the match is paused
  assert.equal(c.running, false);
  await until(() => c.cycle === 400 && !c.running);
  assert.deepEqual(Array.from(c.last?.score ?? []), expected(5, 400));
  const before = log.sent.length;
  c.seek(120); c.seek(30); c.seek(-5); c.seek(200); // one goes out at once, the rest are queued: only the newest of them is made
  await until(() => c.cycle === 200 && log.sent.length > before);
  assert.deepEqual(log.sent.slice(before).filter((m) => m.type === 'seek').map((m) => (m as { round: number }).round), [120, 200]);
  assert.deepEqual(Array.from(c.last?.score ?? []), expected(5, 200), 'going back gives the same game');
  c.seek(-5); await until(() => c.cycle === 0); assert.deepEqual(Array.from(c.last?.score ?? []), [0, 0]);
});

test('step runs one round and pauses; it is ignored while a request is in flight', async () => {
  const { c, events, until, log } = rig(100);
  c.load(init(), { rounds: 300 });
  await until(() => events.frames.length === 1);
  c.step(); await until(() => c.cycle === 1);
  assert.equal(c.running, false);
  c.step(); c.step(); // the second is dropped: the first is still in flight
  await until(() => c.cycle >= 2); await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.cycle, 2); assert.equal(log.sent.filter((m) => m.type === 'run').length, 2);
});

test('startAt: the first frame is at that round; a seek made before the engine is ready wins', async () => {
  const a = rig();
  a.c.load(init(), { rounds: 500, startAt: 120 });
  await a.until(() => a.events.frames.length === 1); assert.equal(a.events.frames[0].cycle, 120);
  assert.deepEqual(Array.from(a.c.last?.score ?? []), expected(5, 120));
  const b = rig();
  b.c.load(init(), { rounds: 500, startAt: 120 }); b.c.seek(40);
  await b.until(() => b.events.frames.length === 1); assert.equal(b.events.frames[0].cycle, 40);
  const c = rig(); c.c.load(init(), { rounds: 100, startAt: 999 });
  await c.until(() => c.events.frames.length === 1); assert.equal(c.events.frames[0].cycle, 100, 'startAt is clamped to the match');
});

test('play at the end of the match: one empty step, then it stops (no endless loop)', async () => {
  const { c, events, until, log } = rig(100);
  c.load(init(), { rounds: 100, startAt: 100 });
  await until(() => events.frames.length === 1);
  c.play(); await until(() => !c.running);
  assert.equal(c.cycle, 100); assert.ok(log.sent.filter((m) => m.type === 'run').length <= 1);
});

test('track: sent at once when idle, queued behind a request in flight; the trace comes back with the frame', async () => {
  const { c, events, until, log } = rig(10, { explain: true });
  c.load(init(), { rounds: 300 });
  await until(() => events.frames.length === 1);
  c.step(); await until(() => c.cycle === 1);
  c.track(3); await until(() => log.sent.some((m) => m.type === 'track'));
  assert.deepEqual(log.sent.filter((m) => m.type === 'track'), [{ type: 'track', ant: 3 }]);
  c.play(); await until(() => c.cycle >= 10);
  c.track(null); await until(() => log.sent.filter((m) => m.type === 'track').length === 2);
  assert.deepEqual(log.sent.filter((m) => m.type === 'track')[1], { type: 'track', ant: null });
  assert.ok(log.sent.filter((m) => m.type === 'run').every((m) => (m as { explain?: boolean }).explain === true), 'explain is asked for each run');
});

test('load again: the old Worker is let go of and its late messages are ignored; the state starts over', async () => {
  const { c, events, until, log } = rig(100);
  c.load(init(5), { rounds: 300 });
  await until(() => events.frames.length === 1);
  c.play(); await until(() => c.cycle >= 100);
  c.load(init(6), { rounds: 200 });
  assert.equal(log.terminated, 1); assert.equal(c.running, false); assert.equal(c.cycle, 0); assert.equal(c.last, undefined);
  const n = events.frames.length;
  await until(() => events.frames.length === n + 1);
  assert.equal(events.frames[n].cycle, 0); assert.equal(log.made, 2);
  c.seek(200); await until(() => c.cycle === 200);
  assert.deepEqual(Array.from((c.last as Frame | undefined)?.score ?? []), playColonies(generateWorld(6), [TRAIL, FORAGER].map((t) => loadAnyBrain(t, RULESETS.classic).program), 6, 200, RULESETS.classic));
});

test('an engine error stops playing and is reported; destroy lets go', async () => {
  const { c, events, until, log } = rig();
  c.load({ type: 'init', seed: 1, rules: 'classic', brains: [TRAIL, 'this is not a brain'] }, { rounds: 100 });
  await until(() => events.errors.length === 1);
  assert.match(events.errors[0], /./); assert.equal(c.running, false); assert.equal(events.frames.length, 0);
  c.destroy(); assert.equal(log.terminated, 1, 'the one Worker is let go of');
  c.seek(5); c.play(); assert.equal(c.running, false, 'nothing to play after destroy');
});
