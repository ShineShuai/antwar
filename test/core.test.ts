import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../src/core/rng.ts';
import { AsmError, OP, assemble, makeProgram, parseIcfp } from '../src/core/asm.ts';
import { parseMap } from '../src/core/map.ts';
import { CLASSIC, TINYMINDS, createSim } from '../src/core/sim.ts';
import type { Rules, WorldMap } from '../src/core/types.ts';
import { refSim } from '../testlib/ref-sim.ts';

const fx = (f: string): string => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('rng reproduces the official x0..x99 for s0 = 12345', () => {
  const rng = createRng(12345);
  assert.deepEqual(JSON.parse(fx('rng12345.json')).map(() => rng.next()), JSON.parse(fx('rng12345.json')));
});

test('assembler: labels, comments, blank lines', () => {
  const P = assemble('; c\nstart: sense ahead food else step\n  goto start\n\nstep: move else start\n  goto start', CLASSIC);
  assert.equal(P.n, 4);
  assert.deepEqual([...P.e].slice(0, 3), [2, 0, 0]);
  assert.equal(P.t[1], 0);
});

test('assembler: errors name the line', () => {
  const bad = (src: string, re: RegExp) => assert.throws(() => assemble(src, CLASSIC), (e) => e instanceof AsmError && re.test(e.message));
  bad('move else 0', /line 1: falls off the end/);
  bad('goto nowhere', /line 1: jump target/);
  bad('z:\n', /empty program/);
  bad('a:\na:\ngoto a', /line 2: duplicate label/);
  bad('flipzero 20000 else 0\ngoto 0', /flipzero p must be 1\.\.16384/);
  bad('sense ahead bogus else 0\ngoto 0', /unknown condition/);
  bad('sense ahead friend foe else 0\ngoto 0', /number of conditions/);
  bad('payload 1 else 0\ngoto 0', /not in this ruleset/);
  bad('turn up\ngoto 0', /turn left\|right/);
  assert.doesNotThrow(() => assemble('payload 1 else 0\ngoto 0', TINYMINDS));
});

test('ICFP .ant loader', () => {
  const P = parseIcfp(fx('starter.ant'), CLASSIC);
  assert.equal(P.n, 16);
  assert.equal(P.op[3], OP.FLIP);
  assert.throws(() => parseIcfp('Move 5 0', CLASSIC), /state must be/);
  assert.throws(() => parseIcfp('Drop 0\n\nDrop 0', CLASSIC), /empty state/);
});

test('map loader reads the official tiny world', () => {
  const m = parseMap(fx('tiny.world'));
  assert.equal(m.W * m.H, 100);
  assert.equal(m.hill.filter((h) => h === 0).length, 16);
  assert.equal(m.hill.filter((h) => h === 1).length, 16);
});

const strip = (n: number, extra = '') => parseMap(`${n}\n3\n${'# '.repeat(n)}\n# + ${'. '.repeat(n - 3)}#\n${'# '.repeat(n)}${extra}`);

test('a mover acts every 15 rounds', () => {
  const sim = createSim({ map: strip(40), programs: [parseIcfp('Move 0 0', CLASSIC)] });
  const x = () => sim.ant(0).pos % 40;
  sim.run(45); assert.equal(x(), 1 + 3); // moves in rounds 1, 16, 31
  sim.run(1); assert.equal(x(), 1 + 4);  // round 46
});

test('carry capacity: Classic 1, Tinyminds 2', () => {
  for (const [rules, want] of [[CLASSIC, 1], [TINYMINDS, 2]] as [Rules, number][]) {
    const map = strip(10); map.food[1 * 10 + 1] = 5;
    const sim = createSim({ map, programs: [parseIcfp('PickUp 0 0', rules)], rules });
    sim.run(5);
    assert.equal(sim.ant(0).has, want);
    assert.equal(sim.food[11], 5 - want);
  }
});

test('starter ant on the tiny world is deterministic and delivers food', () => {
  const run = () => {
    const P = parseIcfp(fx('starter.ant'), CLASSIC);
    const sim = createSim({ map: parseMap(fx('tiny.world')), programs: [P, P] });
    sim.run(10000);
    return { hash: sim.hash(), score: sim.score() };
  };
  const a = run();
  assert.deepEqual(a, run());
  assert.ok(a.score[0] + a.score[1] > 0, JSON.stringify(a));
});

// --- differential fuzz: optimized core vs the spec-literal reference ---------------------
const lcg = (seed: number): (() => number) => { let s = seed; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8); };

function randProgram(r: () => number, n: number) {
  const pick = (k: number): number => r() % k, tgt = () => pick(n);
  const gens = [
    () => ({ op: OP.SENSE, a: pick(4), b: 1 << pick(15), t: tgt(), e: tgt() }),
    () => ({ op: OP.SENSE, a: pick(4), b: 1 << (pick(2) ? 0 : 1), t: tgt(), e: tgt() }),
    () => ({ op: OP.MARK, a: pick(6), t: tgt() }), () => ({ op: OP.UNMARK, a: pick(6), t: tgt() }),
    () => ({ op: OP.MOVE, t: tgt(), e: tgt() }), () => ({ op: OP.MOVE, t: tgt(), e: tgt() }),
    () => ({ op: OP.MOVE, t: tgt(), e: tgt() }), () => ({ op: OP.PICKUP, t: tgt(), e: tgt() }),
    () => ({ op: OP.DROP, t: tgt() }), () => ({ op: OP.TURN, a: pick(2), t: tgt() }),
    () => ({ op: OP.TURN, a: pick(2), t: tgt() }), () => ({ op: OP.FLIP, a: 1 + pick(4), t: tgt(), e: tgt() }),
  ];
  return makeProgram(Array.from({ length: n }, () => gens[pick(gens.length)]()));
}

function randMap(r: () => number): WorldMap {
  const W = 16, H = 12, N = W * H;
  const map: WorldMap = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (x >= 3 && x <= 6 && y >= 3 && y <= 8) map.hill[p] = 0;
    else if (x >= 8 && x <= 11 && y >= 3 && y <= 8) map.hill[p] = 1;
    else if (edge || r() % 100 < 8) map.rock[p] = 1;
    else if (r() % 100 < 10) map.food[p] = 1 + (r() % 9);
  }
  return map;
}

test('differential fuzz: core == spec-literal reference (Classic)', () => {
  let deaths = 0, delivered = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = lcg(seed), map = randMap(r), n = 6 + (r() % 20);
    const programs = [randProgram(r, n), randProgram(r, n)];
    const a = createSim({ map, programs, seed }), b = refSim({ map, programs, seed });
    for (let round = 1; round <= 1500; round++) {
      a.step(); b.step();
      if (round % 25 === 0) assert.equal(a.dump(), b.snapshot(), `seed ${seed}, round ${round}`);
    }
    deaths += a.ants - a.alive(0) - a.alive(1);
    delivered += a.score()[0] + a.score()[1];
  }
  assert.ok(deaths > 0, 'fuzz never exercised the surround rule');
  console.log(`fuzz coverage: ${deaths} deaths, ${delivered} food on hills`);
});

test('daily seed: stable hash of the UTC date, 30-bit, differs per day', async () => {
  const { dailySeed } = await import('../src/core/seed.ts');
  const { utcDate } = await import('../web/clock.ts');
  assert.equal(dailySeed('2026-11-10'), dailySeed('2026-11-10'));
  assert.notEqual(dailySeed('2026-11-10'), dailySeed('2026-11-11'));
  assert.ok(dailySeed('2026-11-10') < 2 ** 30);
  assert.equal(utcDate(new Date('2026-11-10T23:59:59Z')), '2026-11-10');
  assert.equal(utcDate(new Date('2026-11-10T00:00:00Z')), '2026-11-10');
});

test('v1 supports at most two colonies', () => {
  const P = parseIcfp('Drop 0', CLASSIC);
  assert.throws(() => createSim({ map: strip(10), programs: [P, P, P] }), /one or two colonies/);
});

test('canonical state stream: layout, hash, snapshot/restore round trip', async () => {
  const { fnv1a } = await import('../src/core/sim.ts');
  assert.equal(fnv1a(new Uint8Array(0)), 0x811c9dc5);
  assert.equal(fnv1a(Uint8Array.from([97])), 0xe40c292c); // FNV-1a("a")
  const ant = parseIcfp(fx('starter.ant'), CLASSIC), map = parseMap(fx('tiny.world'));
  const sim = createSim({ map, programs: [ant, ant] });
  sim.run(700);
  const snap = sim.snapshot(), dv = new DataView(snap.buffer);
  assert.equal(snap.length, 12 + 100 * (4 + 2) + 32 * 9);
  assert.deepEqual([dv.getUint32(0, true), dv.getUint32(8, true) > 0], [700, true]); // round, draws
  assert.equal(sim.hash(), fnv1a(snap));
  sim.run(900);
  const twin = createSim({ map, programs: [ant, ant] });
  twin.restore(snap);
  assert.equal(twin.hash(), fnv1a(snap), 'restored state hashes like its snapshot');
  twin.run(900);
  assert.equal(twin.hash(), sim.hash(), 'replay from a checkpoint equals the straight run');
  assert.throws(() => twin.restore(snap.slice(1)), /does not match/);
});

test('property: food is conserved (map + carried = initial + 3 x deaths) and runs are repeatable', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = lcg(seed), map = randMap(r), n = 6 + (r() % 20);
    const programs = [randProgram(r, n), randProgram(r, n)];
    const total = (sim: ReturnType<typeof createSim>): number => {
      let t = sim.food.reduce((a, b) => a + b, 0);
      for (let i = 0; i < sim.ants; i++) if (sim.ant(i).alive) t += sim.ant(i).has;
      return t;
    };
    const a = createSim({ map, programs, seed }), b = createSim({ map, programs, seed });
    const initial = total(a);
    a.run(1200); b.run(1200);
    const deaths = a.ants - a.alive(0) - a.alive(1);
    assert.equal(total(a), initial + 3 * deaths, `seed ${seed}`);
    assert.equal(a.hash(), b.hash(), `seed ${seed} repeatable`);
  }
});

test('size caps: authored 2000 instructions, imported official ants 10000', () => {
  const states = (n: number) => Array.from({ length: n }, (_, i) => `Drop ${(i + 1) % n}`).join('\n');
  assert.equal(parseIcfp(states(2001), CLASSIC).n, 2001);
  assert.throws(() => parseIcfp(states(10001), CLASSIC), /more than 10000/);
  const asm = (n: number) => `${Array.from({ length: n - 1 }, () => 'drop').join('\n')}\ngoto 0`;
  assert.equal(assemble(asm(2000), CLASSIC).n, 2000);
  assert.throws(() => assemble(asm(2001), CLASSIC), /more than 2000/);
});
