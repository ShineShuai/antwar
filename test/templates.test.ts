import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/core/gen.ts';
import { parseMap } from '../src/core/map.ts';
import { createSim } from '../src/core/sim.ts';
import { compileRules } from '../src/lang/index.ts';
import { DEFAULTS, LEVELS, SETTLE, SETTLE_DEFAULT, TEMPLATES, parsePersonality, personality, usesMix, usesSociability } from '../src/lang/templates.ts';
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
  assert.equal(n, 5 * 5 * 4 * 3);
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
  assert.deepEqual(TEMPLATES.filter(usesSociability), ['trail', 'keeper', 'raider']);
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

test('keeper settling: four levels give 1 in 20, 15, 10 and 7; the default changes nothing; the other templates have none', () => {
  const chance = (settling: number): string | undefined => /when 1 in (\d+) -> switch sit/.exec(personality({ ...DEFAULTS.keeper, settling }))?.[1];
  assert.deepEqual(LEVELS.settling.map((_, s) => chance(s)), ['20', '15', '10', '7']);
  assert.deepEqual(LEVELS.settling.map((_, s) => chance(s)), SETTLE.map(String));
  assert.equal(personality({ ...DEFAULTS.keeper, settling: SETTLE_DEFAULT }), personality(DEFAULTS.keeper));
  assert.match(personality(DEFAULTS.keeper), /^# personality: template=keeper curiosity=0 boldness=1 sociability=1\n/, 'older texts stay valid');
  for (let settling = 0; settling < LEVELS.settling.length; settling++) {
    const c = compileRules(personality({ ...DEFAULTS.keeper, settling }));
    assert.deepEqual([c.warnings, c.instructions], [[], 1111], `settling ${settling}`);
  }
  assert.throws(() => personality({ ...DEFAULTS.keeper, settling: 4 }), /settling must be 0\.\.3/);
  assert.throws(() => personality({ ...DEFAULTS.keeper, settling: -1 }), /settling must be 0\.\.3/);
  for (const t of ['forager', 'trail', 'guard', 'raider'] as const) assert.throws(() => personality({ ...DEFAULTS[t], settling: 1 }), /no settling/, t);
});

test('settling comes back from the text: the default is not written, any other level is', () => {
  for (let settling = 0; settling < LEVELS.settling.length; settling++) {
    const text = personality({ ...DEFAULTS.keeper, curiosity: 2, settling });
    assert.equal(text.split('\n')[0].includes('settling='), settling !== SETTLE_DEFAULT, `settling ${settling}`);
    const parsed = parsePersonality(text);
    assert.equal(parsed?.settling ?? SETTLE_DEFAULT, settling);
    assert.equal(parsePersonality(`${text}# one more comment\n`), null, 'hand edited');
  }
  const head = '# personality: template=keeper curiosity=0 boldness=1 sociability=1';
  assert.equal(parsePersonality(`${head} settling=2\n`), null, 'the default is never written, so this is not generator text');
  assert.equal(parsePersonality(`${head} settling=9\n`), null);
  assert.equal(parsePersonality(personality({ ...DEFAULTS.keeper, settling: 1 }).replace('template=keeper', 'template=trail')), null);
});

test('boldness: timid flees, indifferent ignores, bold approaches a foe ahead, fierce also the sides; carriers never fight', () => {
  const foes = (b: number): string[] => personality({ ...DEFAULTS.trail, boldness: b }).split('\n').filter((l) => /when foe (ahead|left ahead|right ahead)/.test(l));
  assert.deepEqual(foes(0), ['  when foe ahead -> turn around, step']);
  assert.deepEqual(foes(1), []);
  assert.equal(foes(2).length, 1);
  assert.equal(foes(3).length, 3);
  assert.ok(foes(2).concat(foes(3)).every((l) => /and not carrying/.test(l)));
});

test('a guard colony never leaves its nest and delivers nothing; a trail-layer forages from a cold start', () => {
  const map = generateWorld(2);
  const guard = compileRules(personality({ ...DEFAULTS.guard, curiosity: 0 })).program, idle = compileRules('always -> wait').program;
  const g = createSim({ map, programs: [guard, idle], seed: 2 });
  g.run(3000);
  for (let i = 0; i < g.ants; i++) if (g.ant(i).col === 0) assert.equal(map.hill[g.ant(i).pos], 0, 'a guard stepped off the nest');
  assert.equal(g.score()[0], 0);
  const trail = compileRules(personality(DEFAULTS.trail)).program;
  const t = createSim({ map, programs: [trail, idle], seed: 2 });
  t.run(30000);
  assert.ok(t.score()[0] >= 100, `only ${t.score()[0]} food`);
});

test('a guard sitting on food does not move: nobody else can stand there to take it', () => {
  const W = 8, wall = '# '.repeat(W).trim();
  const map = parseMap(`${W}\n4\n${wall}\n# + . . . . . #\n${wall}\n${wall}\n`);
  const s = createSim({ map, programs: [compileRules(personality({ ...DEFAULTS.guard, curiosity: 2 })).program], seed: 1, wrap: false });
  const snap = s.snapshot();
  snap[12 + (1 * W + 1) * 5] = 4; // food on the nest cell the lone guard stands on (u16 little endian)
  s.restore(snap);
  s.run(1000);
  assert.equal(s.ant(0).pos, 1 * W + 1);
  assert.equal(s.food[1 * W + 1], 4);
});

// ---- the keeper's dose follows the colonies
import { SETTLE_MANY, keeperDose } from '../src/lang/templates.ts';

test('colonies dose: a keeper made for 3+ colonies settles 1 in 40; the two-colony text does not change by a byte', () => {
  const two = personality(DEFAULTS.keeper), many = personality({ ...DEFAULTS.keeper, colonies: 3 });
  assert.match(two.split('\n')[0], /^# personality: template=keeper curiosity=0 boldness=1 sociability=1$/); assert.ok(two.includes('when 1 in 10 -> switch sit'));
  assert.match(many.split('\n')[0], /^# personality: template=keeper curiosity=0 boldness=1 sociability=1 colonies=3$/); assert.ok(many.includes(`when 1 in ${SETTLE_MANY} -> switch sit`));
  assert.equal(SETTLE_MANY, 40);
  assert.equal(many.replace(' colonies=3', '').replace('1 in 40 -> switch sit', '1 in 10 -> switch sit'), two, 'nothing else differs');
  assert.equal(personality({ ...DEFAULTS.keeper, colonies: 26 }).replace(' colonies=26', ''), many.replace(' colonies=3', ''), 'every colony count from 3 gives the same dose');
  assert.deepEqual([keeperDose(DEFAULTS.keeper), keeperDose({ ...DEFAULTS.keeper, colonies: 5 }), keeperDose({ ...DEFAULTS.keeper, settling: 0 })], [10, 40, 20]);
});

test('colonies dose: it comes back from the text; a hand edit, a level, another template and bad counts are refused', () => {
  const p = { ...DEFAULTS.keeper, colonies: 4 }, text = personality(p);
  assert.deepEqual(parsePersonality(text), p);
  assert.equal(parsePersonality(text.replace('1 in 40', '1 in 39')), null, 'edited by hand');
  assert.equal(parsePersonality(text.replace('colonies=4', 'colonies=2')), null, 'two colonies is the default: it is left out');
  assert.equal(parsePersonality(text.replace('colonies=4', 'colonies=4 settling=1')), null);
  const withMix = personality({ ...DEFAULTS.keeper, colonies: 3 });
  assert.deepEqual(parsePersonality(withMix), { ...DEFAULTS.keeper, colonies: 3 });
  assert.throws(() => personality({ ...DEFAULTS.keeper, colonies: 3, settling: 1 }), /do not go together/);
  for (const bad of [2, 27, 3.5, 0, -1, Number.NaN]) assert.throws(() => personality({ ...DEFAULTS.keeper, colonies: bad }), RangeError, String(bad));
  for (const t of ['forager', 'guard', 'trail', 'raider'] as const) assert.throws(() => personality({ ...DEFAULTS[t], colonies: 3 }), /no colonies dose/, t);
});

test('colonies dose: the text compiles without warnings, for 3 and 26 colonies and with the other sliders moved', () => {
  for (const colonies of [3, 26]) for (const curiosity of [0, 4]) for (const boldness of [0, 3]) {
    const c = compileRules(personality({ ...DEFAULTS.keeper, curiosity, boldness, colonies }));
    assert.equal(c.warnings.length, 0, `${colonies} colonies, curiosity ${curiosity}, boldness ${boldness}: ${c.warnings.join(' | ')}`); assert.ok(c.instructions < 2000);
  }
});
