import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcfp } from '../src/core/asm.ts';
import { formatMap, parseMap } from '../src/core/map.ts';
import { CLASSIC, createSim } from '../src/core/sim.ts';
import { generateWorld } from '../src/core/gen.ts';
import { lcg, randIcfp, randMap } from '../testlib/random.ts';
import { STARTER } from '../web/default-ant.ts';

const oracle = fileURLToPath(new URL('../oracle/ref.py', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;

test('second implementation (Python, written from the reference text) agrees on the state hash',
  { skip: !hasPython && 'python3 not found' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'xcheck-'));
    let deaths = 0, torus = 0;
    try {
      for (let seed = 1; seed <= 40; seed++) {
        const r = lcg(seed * 7919), border = seed % 2 === 1, n = 6 + (r() % 20);
        const mapText = formatMap(randMap(r, border)), a = randIcfp(r, n), b = randIcfp(r, n);
        const files = { map: join(dir, 'm.world'), a: join(dir, 'a.ant'), b: join(dir, 'b.ant') };
        writeFileSync(files.map, mapText); writeFileSync(files.a, a); writeFileSync(files.b, b);
        const py = spawnSync('python3', [oracle, '--map', files.map, '--ant', files.a, '--ant', files.b,
          '--rounds', '1500', '--seed', String(seed), '--every', '100'], { encoding: 'utf8' });
        assert.equal(py.status, 0, py.stderr);
        const sim = createSim({ map: parseMap(mapText), programs: [parseIcfp(a, CLASSIC), parseIcfp(b, CLASSIC)], seed });
        for (const line of py.stdout.trim().split('\n')) {
          const e = JSON.parse(line) as { round: number; hash: number };
          sim.run(e.round - sim.cycle);
          assert.equal(sim.hash(), e.hash, `seed ${seed} (${border ? 'bordered' : 'torus'}), round ${e.round}`);
        }
        deaths += sim.ants - sim.alive(0) - sim.alive(1);
        if (!border) torus++;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(deaths > 0 && torus > 0, 'the cross-check must cover combat and wrap-around');
    console.log(`cross-check coverage: ${deaths} deaths over 40 matches (${torus} on borderless tori)`);
  });

test('Python oracle agrees on the official tiny world and a full contest world (starter ant)', { skip: !hasPython && 'python3 not found' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'xcheck-'));
  try {
    const tiny = readFileSync(new URL('./fixtures/tiny.world', import.meta.url), 'utf8');
    for (const [name, mapText, rounds] of [['tiny.world', tiny, 10000], ['contest world 3', formatMap(generateWorld(3)), 2000]] as [string, string, number][]) {
      const map = join(dir, 'm.world'), ant = join(dir, 'a.ant');
      writeFileSync(map, mapText); writeFileSync(ant, STARTER);
      const py = spawnSync('python3', [oracle, '--map', map, '--ant', ant, '--rounds', String(rounds), '--every', '500'], { encoding: 'utf8' });
      assert.equal(py.status, 0, py.stderr);
      const P = parseIcfp(STARTER, CLASSIC), sim = createSim({ map: parseMap(mapText), programs: [P, P] });
      for (const line of py.stdout.trim().split('\n')) {
        const e = JSON.parse(line) as { round: number; hash: number };
        sim.run(e.round - sim.cycle);
        assert.equal(sim.hash(), e.hash, `${name}, round ${e.round}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
