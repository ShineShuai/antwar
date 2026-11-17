import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OP, makeProgram, parseIcfp } from '../src/core/asm.ts';
import { GENERATOR_VERSION, generateWorld } from '../src/core/gen.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { HASH_EVERY, KEY_EVERY, MAX_ROUNDS, brainHash, createReplay, fromFlat, parseDescriptor, record, toFlat, verify } from '../src/core/replay.ts';
import { RULESETS } from '../src/core/rules.ts';
import type { RulesId } from '../src/core/rules.ts';
import { CLASSIC, TINYMINDS, createSim, fnv1a } from '../src/core/sim.ts';
import { loadAnyBrain } from '../src/lang/index.ts';
import { lcg, randMap, randProgram } from '../testlib/random.ts';
import { createEngine } from '../web/engine.ts';
import { STARTER } from '../web/default-ant.ts';
import type { Reply, Request } from '../web/protocol.ts';
import { decodeShare, encodeShare } from '../web/share.ts';

type Of<T extends Reply['type']> = Extract<Reply, { type: T }>;
const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const oracle = fileURLToPath(new URL('../oracle/ref.py', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;
const starter = parseIcfp(fx('starter.ant'), CLASSIC);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('settled intervals: hash checkpoints every 1,000 rounds (proof), keyframes every 2,000 (seek)', () => {
  assert.deepEqual([HASH_EVERY, KEY_EVERY], [1000, 2000]);
  assert.equal(KEY_EVERY % HASH_EVERY, 0);
});

test('fuzz: seek to any round, either way, equals a straight run (random programs, combat, two rulesets)', () => {
  const probes = [0, 1, 999, 1000, 1999, 2000, 2001, 4500, 6001, 6500, 3999, 2000, 17, 6500, 5000];
  for (const [id, rules] of [['classic', CLASSIC], ['tinyminds', TINYMINDS]] as const) {
    for (let seed = 1; seed <= 4; seed++) {
      const r = lcg(seed * 104729), map = randMap(r, seed % 2 === 1), P = [randProgram(r, 24), randProgram(r, 24)];
      const rp = createReplay({ map, programs: P, seed, rules });
      const straight = (n: number): number => { const s = createSim({ map, programs: P, seed, rules }); s.run(n); return s.hash(); };
      rp.run(3300); // frontier 3300: probes below it restore, probes above it simulate
      for (const round of probes) {
        rp.seek(round);
        assert.equal(rp.round, round);
        assert.equal(rp.sim.hash(), straight(round), `${id} seed ${seed} seek ${round}`);
      }
    }
  }
});

test('checkpoints are taken once, on first arrival; rewinding never changes them', () => {
  const rp = createReplay({ map: parseMap(fx('tiny.world')), programs: [starter, starter] });
  rp.run(2500);
  assert.deepEqual([rp.frontier, rp.hashAt(0) === fnv1a(createSim({ map: parseMap(fx('tiny.world')), programs: [starter, starter] }).snapshot())], [2500, true]);
  const h = [1000, 2000].map((r) => rp.hashAt(r));
  assert.equal(rp.hashAt(3000), undefined);
  assert.equal(rp.hashAt(1500), undefined, 'only multiples of HASH_EVERY');
  rp.seek(10); rp.seek(2200);
  assert.deepEqual([1000, 2000].map((r) => rp.hashAt(r)), h);
  assert.equal(rp.frontier, 2500);
  rp.seek(3100);
  assert.deepEqual([rp.frontier, rp.hashAt(3000) !== undefined], [3100, true]);
});

test('seek cost: any target within the frontier re-runs fewer than KEY_EVERY rounds; known boundaries are not re-snapshotted', () => {
  const rp = createReplay({ map: parseMap(fx('tiny.world')), programs: [starter, starter] });
  rp.run(9000);
  let ran = 0, snaps = 0;
  const run = rp.sim.run, snapshot = rp.sim.snapshot;
  rp.sim.run = (n: number): void => { ran += n; run(n); };
  rp.sim.snapshot = (): Uint8Array => { snaps++; return snapshot(); };
  for (const [from, to] of [[9000, 100], [100, 6500], [6500, 6501], [6501, 4000], [4000, 3999], [3999, 8999], [8999, 0], [0, 9000]]) {
    rp.seek(from); ran = 0;
    rp.seek(to);
    assert.ok(ran < KEY_EVERY, `${from} -> ${to} re-ran ${ran}`);
  }
  snaps = 0; rp.seek(0); rp.seek(9000);
  assert.equal(snaps, 0, 'all boundaries up to the frontier are already known');
});

test('seek: bad rounds throw; the trace hook sees every round of the last leg, from the keyframe', () => {
  const rp = createReplay({ map: parseMap(fx('tiny.world')), programs: [starter, starter] });
  for (const bad of [-1, 1.5, NaN, Infinity]) assert.throws(() => rp.seek(bad), /bad round/);
  rp.run(5000);
  const seen: number[] = [];
  rp.seek(4500, () => seen.push(rp.round));
  assert.equal(seen.length, 500, 'from the keyframe at 4000');
  assert.deepEqual([seen[0], seen.at(-1)], [4000, 4499]);
  seen.length = 0;
  rp.seek(4600, () => seen.push(rp.round)); // already past the keyframe, still re-run from it
  assert.equal(seen.length, 600);
});

test('Python oracle agrees at every 1,000 rounds: the descriptor checkpoints are the cross-implementation proof',
  { skip: !hasPython && 'python3 not found' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'replay-'));
    try {
      const world3 = formatMap(generateWorld(3));
      const cases: [string, RulesId, string, number][] = [['tiny.world', 'classic', fx('tiny.world'), 10000], ['world 3', 'classic', world3, 4000], ['world 3', 'tinyminds', world3, 4000]];
      for (const [name, id, mapText, rounds] of cases) {
        const m = join(dir, 'm.world'), a = join(dir, 'a.ant');
        writeFileSync(m, mapText); writeFileSync(a, fx('starter.ant'));
        const d = record({ rules: id, seed: 12345, rounds, programs: [starter, starter], map: mapText });
        const py = spawnSync('python3', [oracle, '--map', m, '--ant', a, '--rounds', String(rounds), '--seed', '12345', '--every', String(HASH_EVERY), '--rules', id], { encoding: 'utf8' });
        assert.equal(py.status, 0, py.stderr);
        const rows = py.stdout.trim().split('\n').map((l) => JSON.parse(l) as { round?: number; hash: number });
        assert.equal(rows.length, d.checkpoints.length + 1, 'one line per checkpoint, then the summary');
        d.checkpoints.forEach((h, k) => assert.deepEqual([rows[k].round, rows[k].hash], [(k + 1) * HASH_EVERY, h], `${name} ${id} round ${(k + 1) * HASH_EVERY}`));
        assert.equal(rows.at(-1)?.hash, d.hash, `${name} ${id} final`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('brainHash layout: u32 n, then u8 op, i32 a, i32 b, u16 t, u16 e per instruction (hand-listed bytes)', () => {
  const drop = makeProgram([{ op: OP.DROP, t: 0 }]);
  assert.equal(brainHash(drop), fnv1a(Uint8Array.from([1, 0, 0, 0, /* op */ 6, /* a */ 0, 0, 0, 0, /* b */ 0, 0, 0, 0, /* t */ 0, 0, /* e */ 0, 0])));
  const two = makeProgram([{ op: OP.SENSE, a: 1, b: 16, t: 1, e: 0 }, { op: OP.FLIP, a: 300, t: 0, e: 1 }]); // sense ahead food; flip 300
  assert.equal(brainHash(two), fnv1a(Uint8Array.from([2, 0, 0, 0,
    0, 1, 0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0,
    8, 44, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0])));
});

test('fromFlat: round trip; rejects what the loaders never produce', () => {
  const ok = toFlat(starter);
  assert.deepEqual(toFlat(fromFlat(clone(ok), CLASSIC)), ok);
  const broke = (f: (ir: ReturnType<typeof toFlat>) => void, rules = CLASSIC, re: RegExp = /./): void => {
    const ir = clone(ok); f(ir);
    assert.throws(() => fromFlat(ir, rules), re);
  };
  broke((ir) => { ir.op[0] = OP.GOTO; }, CLASSIC, /goto is not an IR/);
  broke((ir) => { ir.op[0] = 12; }, CLASSIC, /op must be/);
  broke((ir) => { ir.t[3] = 99; }, CLASSIC, /t must be/);
  broke((ir) => { ir.e.pop(); }, CLASSIC, /differ in length/);
  const drop = ir0(OP.DROP);
  assert.throws(() => fromFlat({ ...drop, e: [0], a: [1] }, CLASSIC), /unused a/);
  assert.throws(() => fromFlat({ ...drop, b: [1] }, CLASSIC), /unused b/);
  assert.throws(() => fromFlat({ op: [OP.MARK], a: [6], b: [0], t: [0], e: [0] }, CLASSIC), /marker/);
  assert.throws(() => fromFlat({ op: [OP.FLIP], a: [0], b: [0], t: [0], e: [0] }, CLASSIC), /flip p/);
  assert.throws(() => fromFlat({ op: [OP.DIRECTION], a: [0], b: [0], t: [0], e: [0] }, CLASSIC), /not in this ruleset/);
  assert.equal(fromFlat({ op: [OP.DIRECTION], a: [0], b: [0], t: [0], e: [0] }, TINYMINDS).n, 1);
  const two = { op: [OP.SENSE], a: [1], b: [3], t: [0], e: [0] }; // two conditions: only senseall (Tinyminds)
  assert.throws(() => fromFlat(two, CLASSIC), /one condition/);
  assert.equal(fromFlat(two, TINYMINDS).n, 1);
  assert.throws(() => fromFlat(null, CLASSIC), /object/);
  assert.throws(() => fromFlat({ op: [], a: [], b: [], t: [], e: [] }, CLASSIC), /1\.\./);
});
const ir0 = (op: number) => ({ op: [op], a: [0], b: [0], t: [0], e: [0] });

test('descriptor: record, JSON round trip, verify; generated and embedded maps; flags', () => {
  const P = [loadAnyBrain(STARTER, CLASSIC).program, starter];
  const gen = record({ rules: 'classic', seed: 3, rounds: 2500, programs: P });
  assert.deepEqual([gen.v, gen.gen, gen.map, gen.checkpoints.length, gen.brains.length], [1, GENERATOR_VERSION, undefined, 2, 2]);
  assert.deepEqual(verify(clone(gen)), { ok: true, rounds: 2500, hash: gen.hash });
  const s = createSim({ map: generateWorld(3), programs: P, seed: 3 }); s.run(2500);
  assert.equal(gen.hash, s.hash(), 'the recorded hash is the sim hash');
  const tiny = record({ rules: 'tinyminds', seed: 7, rounds: 3000, programs: [starter, starter], map: fx('tiny.world'), wrap: false, sources: [fx('starter.ant')] });
  assert.deepEqual([tiny.wrap, tiny.gen, tiny.rules, tiny.brains[0].src === fx('starter.ant'), tiny.checkpoints.length], [false, undefined, 'tinyminds', true, 3]);
  assert.equal(verify(clone(tiny)).ok, true);
  assert.equal(record({ rules: 'classic', seed: 1, rounds: 0, programs: P }).checkpoints.length, 0);
  assert.equal(parseDescriptor(clone(tiny)).brains[0].hash, brainHash(starter));
  assert.throws(() => record({ rules: 'classic', seed: 1, rounds: MAX_ROUNDS + 1, programs: P }), /rounds/);
});

test('verify names what is wrong: the first bad checkpoint, the final hash, the brain, the format, the generator', () => {
  const P = [starter, starter], d = record({ rules: 'classic', seed: 3, rounds: 3500, programs: P });
  const v = (edit: (x: ReturnType<typeof clone<typeof d>>) => void) => { const x = clone(d); edit(x); return verify(x); };
  const at = v((x) => { x.checkpoints[1] = (x.checkpoints[1] ^ 4) >>> 0; });
  assert.deepEqual(at, { ok: false, reason: 'hash', round: 2000, message: 'state hash differs at round 2000 (diverged after round 1000)' });
  assert.deepEqual(v((x) => { x.hash = (x.hash ^ 1) >>> 0; }), { ok: false, reason: 'hash', round: 3500, message: 'final state hash differs at round 3500' });
  assert.equal((v((x) => { x.brains[0].ir.t[0] = (x.brains[0].ir.t[0] + 1) % x.brains[0].ir.t.length; }) as { reason: string }).reason, 'brain');
  assert.equal((v((x) => { x.gen = GENERATOR_VERSION + 1; }) as { reason: string }).reason, 'generator');
  assert.equal((v((x) => { (x as { v: number }).v = 2; }) as { reason: string }).reason, 'version');
  assert.equal((v((x) => { (x as { rules: string }).rules = 'chess'; }) as { reason: string }).reason, 'rules');
  assert.equal((v((x) => { x.checkpoints.pop(); }) as { reason: string }).reason, 'invalid');
  assert.equal((v((x) => { x.rounds = MAX_ROUNDS + 1; }) as { reason: string }).reason, 'invalid');
  assert.equal((v((x) => { x.seed = -1; }) as { reason: string }).reason, 'invalid');
  assert.equal((v((x) => { x.brains = []; }) as { reason: string }).reason, 'invalid');
  assert.match((v((x) => { x.map = '5\n4\n'; delete x.gen; }) as { message: string }).message, /rows/);
  assert.match((v((x) => { delete x.gen; }) as { message: string }).message, /gen/);
  for (const junk of [null, 7, 'x', [], {}, { v: 1 }]) assert.equal(verify(junk).ok, false, JSON.stringify(junk));
  // a classic descriptor cannot smuggle an extended instruction past the rules it names
  const sneaky = clone(d); sneaky.brains[0].ir = ir0(OP.DIRECTION); sneaky.brains[0].hash = brainHash(makeProgram([{ op: OP.DIRECTION, a: 0, t: 0, e: 0 }]));
  assert.match((verify(sneaky) as { message: string }).message, /not in this ruleset/);
  assert.ok(RULESETS.classic);
});

test('engine seek: equals a straight run in both directions; bad rounds come back as messages', () => {
  const eng = createEngine(), direct = (n: number): number => { const s = createSim({ map: generateWorld(3), programs: [starter, starter], seed: 3 }); s.run(n); return s.hash(); };
  eng.handle({ type: 'init', seed: 3, brains: [fx('starter.ant'), fx('starter.ant')] });
  assert.equal((eng.handle({ type: 'run', n: 4300 }).msg as Of<'frame'>).cycle, 4300);
  for (const round of [1200, 0, 4999, 2000, 4300]) {
    const f = eng.handle({ type: 'seek', round }).msg as Of<'frame'>;
    assert.deepEqual([f.type, f.cycle, f.hash], ['frame', round, direct(round)], `seek ${round}`);
  }
  eng.handle({ type: 'seek', round: 100 });
  assert.equal((eng.handle({ type: 'run', n: 50 }).msg as Of<'frame'>).cycle, 150, 'run continues from the seek');
  for (const round of [-1, 2.5, MAX_ROUNDS + 1]) assert.match((eng.handle({ type: 'seek', round }).msg as Of<'error'>).message, /bad round/);
  assert.match((createEngine().handle({ type: 'seek', round: 1 }).msg as Of<'error'>).message, /not initialised/);
});

test('engine seek: the followed ant\'s trace is re-simulated from the keyframe and ends like a live trace', () => {
  const live = createEngine(), seeker = createEngine(), setup: Request = { type: 'init', seed: 3, brains: [fx('starter.ant'), fx('starter.ant')] };
  live.handle(setup); seeker.handle(setup);
  live.handle({ type: 'track', ant: 0 });
  const a = live.handle({ type: 'run', n: 4500 }).msg as Of<'frame'>; // traced from round 0, last 400 acting rounds kept
  seeker.handle({ type: 'run', n: 9000 });
  seeker.handle({ type: 'track', ant: 0 });
  const b = seeker.handle({ type: 'seek', round: 4500 }).msg as Of<'frame'>;
  assert.equal(b.hash, a.hash);
  assert.ok(b.trace.length >= 2 && b.trace.length % 2 === 0);
  const k = Math.min(a.trace.length, b.trace.length);
  assert.deepEqual(b.trace.slice(-k), a.trace.slice(-k));
  assert.ok(b.trace.every((x, i) => i % 2 || x > 4000), 'only rounds after the keyframe at 4000');
  const again = seeker.handle({ type: 'seek', round: 4500 }).msg as Of<'frame'>;
  assert.deepEqual(again.trace, b.trace, 'the trace depends on the target round only');
});

test('share link: the sender\'s result travels and is validated', async () => {
  const s = { seed: 3, brains: ['a', 'b'] as [string, string], result: { round: 100000, hash: 4294967295 } };
  assert.deepEqual(await decodeShare(await encodeShare(s)), { ...s, map: undefined, gen: undefined, rules: undefined });
  const raw = async (result: unknown): Promise<string> => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, seed: 1, brains: ['a', 'b'], result }));
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return Buffer.from(out).toString('base64url');
  };
  for (const bad of [null, 5, {}, { round: -1, hash: 1 }, { round: 1.5, hash: 1 }, { round: MAX_ROUNDS + 1, hash: 1 }, { round: 1, hash: -1 }, { round: 1, hash: 2 ** 32 }]) {
    assert.equal(await decodeShare(await raw(bad)), null, JSON.stringify(bad));
  }
});
