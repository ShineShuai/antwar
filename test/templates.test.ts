import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';
import { DEFAULTS, LEVELS, TEMPLATES, parsePersonality, personality, usesMix, usesSociability } from '../src/lang/templates.ts';
import type { Personality, RoleMix } from '../src/lang/templates.ts';

const NONFORAGING = /never picks up food|never drops food/;
const MIXES: RoleMix[] = [
  { worker: 100, scout: 0, guard: 0 }, { worker: 70, scout: 20, guard: 10 }, { worker: 50, scout: 50, guard: 0 },
  { worker: 0, scout: 0, guard: 100 }, { worker: 34, scout: 33, guard: 33 }, { worker: 20, scout: 30, guard: 50 }, { worker: 0, scout: 60, guard: 40 },
];

test('every template with every slider position compiles; only a guard-only program warns (it never forages)', () => {
  let n = 0;
  for (const template of TEMPLATES) {
    for (let curiosity = 0; curiosity < LEVELS.curiosity.length; curiosity++) {
      for (let boldness = 0; boldness < LEVELS.boldness.length; boldness++) {
        for (let sociability = 0; sociability < LEVELS.sociability.length; sociability++) {
          const p: Personality = { template, curiosity, boldness, sociability };
          const c = compileRules(personality(p));
          const expected = template === 'guard' ? 2 : 0;
          assert.equal(c.warnings.length, expected, `${JSON.stringify(p)}: ${c.warnings.join(' | ')}`);
          if (template === 'guard') c.warnings.forEach((w) => assert.match(w, NONFORAGING));
          assert.ok(c.instructions < 2000);
          n++;
        }
      }
    }
  }
  assert.equal(n, 4 * 5 * 4 * 3);
});

test('role mixes compile for the templates that have them; weights are reduced and bounded', () => {
  for (const template of ['trail', 'raider'] as const) {
    for (const mix of MIXES) {
      for (let sociability = 0; sociability < 3; sociability++) {
        const p: Personality = { ...DEFAULTS[template], sociability, mix };
        const c = compileRules(personality(p));
        const foraging = mix.worker + mix.scout > 0;
        assert.deepEqual(c.warnings.filter((w) => !NONFORAGING.test(w)), [], `${template} ${JSON.stringify(mix)} s${sociability}`);
        assert.equal(c.warnings.some((w) => NONFORAGING.test(w)), !foraging, `${template} ${JSON.stringify(mix)}`);
        assert.ok(c.instructions < 2000, `${c.instructions} instructions`);
      }
    }
  }
  assert.throws(() => personality({ ...DEFAULTS.guard, mix: MIXES[1] }), /no role mix/);
  assert.throws(() => personality({ ...DEFAULTS.forager, mix: MIXES[1] }), /no role mix/);
  assert.throws(() => personality({ ...DEFAULTS.trail, mix: { worker: 0, scout: 0, guard: 0 } }), /must not all be 0/);
  assert.throws(() => personality({ ...DEFAULTS.trail, mix: { worker: 101, scout: 0, guard: 0 } }), /whole percentages/);
  assert.throws(() => personality({ ...DEFAULTS.trail, curiosity: 5 }), /curiosity must be 0\.\.4/);
  assert.throws(() => personality({ ...DEFAULTS.trail, boldness: -1 }), /boldness must be 0\.\.3/);
  assert.throws(() => personality({ ...DEFAULTS.trail, template: 'wizard' as 'trail' }), /unknown template/);
});

test('sociability and the role mix only exist where the template has a trail', () => {
  assert.deepEqual(TEMPLATES.filter(usesSociability), ['trail', 'raider']);
  assert.deepEqual(TEMPLATES.filter(usesMix), ['trail', 'raider']);
  // the forager and guard text does not depend on a sociability value
  for (const t of ['forager', 'guard'] as const) {
    assert.equal(personality({ ...DEFAULTS[t], sociability: 2 }).split('\n').slice(2).join('\n'), personality({ ...DEFAULTS[t], sociability: 0 }).split('\n').slice(2).join('\n'));
  }
});

test('the controls come back from the text only while it is exactly what the generator wrote', () => {
  for (const template of TEMPLATES) {
    for (const mix of [undefined, MIXES[1]]) {
      if (mix && !usesMix(template)) continue;
      const p: Personality = { ...DEFAULTS[template], curiosity: 3, boldness: 2, sociability: usesSociability(template) ? 2 : 0 };
      if (mix) p.mix = mix;
      const text = personality(p);
      assert.deepEqual(parsePersonality(text), p);
      assert.equal(parsePersonality(`${text}# one more comment\n`), null, 'hand edited');
      assert.equal(parsePersonality(text.replace('otherwise', 'always')), null, 'hand edited');
      assert.equal(parsePersonality(text.replace(/\n$/, '')), null);
    }
  }
  assert.equal(parsePersonality('when food ahead -> move'), null);
  assert.equal(parsePersonality('# personality: template=trail curiosity=9 boldness=1 sociability=1\n'), null);
});

test('curiosity is the share of random wandering: one rule "1 in N" with N = 16, 8, 4, 2', () => {
  const rule = (c: number): string | undefined => personality({ ...DEFAULTS.trail, curiosity: c }).split('\n').find((l) => /when 1 in/.test(l));
  assert.equal(rule(0), undefined);
  assert.deepEqual([1, 2, 3, 4].map((c) => /1 in (\d+)/.exec(rule(c) ?? '')?.[1]), ['16', '8', '4', '2']);
});

test('boldness: timid flees, indifferent ignores, bold approaches a foe ahead, fierce also the sides; carriers never fight', () => {
  const foes = (b: number): string[] => personality({ ...DEFAULTS.trail, boldness: b }).split('\n').filter((l) => /when foe (ahead|left ahead|right ahead)/.test(l));
  assert.deepEqual(foes(0), ['  when foe ahead -> turn around, step']);
  assert.deepEqual(foes(1), []);
  assert.equal(foes(2).length, 1);
  assert.equal(foes(3).length, 3);
  assert.ok(foes(2).concat(foes(3)).every((l) => /and not carrying/.test(l)));
});

test('a guard colony stands still and delivers nothing; a trail-layer forages from a cold start', () => {
  const guard = compileRules(personality({ ...DEFAULTS.guard, curiosity: 0 })).program, idle = compileRules('always -> wait').program;
  const g = createSim({ map: generateWorld(2), programs: [guard, idle], seed: 2 });
  const start = Array.from({ length: g.ants }, (_, i) => g.ant(i).pos);
  g.run(3000);
  assert.deepEqual(Array.from({ length: g.ants }, (_, i) => g.ant(i).pos), start);
  assert.equal(g.score()[0], 0);
  const trail = compileRules(personality(DEFAULTS.trail)).program;
  const t = createSim({ map: generateWorld(2), programs: [trail, idle], seed: 2 });
  t.run(30000);
  assert.ok(t.score()[0] >= 100, `only ${t.score()[0]} food`);
});

test('the default trail-layer is ants/trail.rules (so its measurements in docs/RULES.md apply)', () => {
  const body = (t: string): string => t.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
  assert.equal(body(personality(DEFAULTS.trail)), body(readFileSync(new URL('../ants/trail.rules', import.meta.url), 'utf8')));
});
