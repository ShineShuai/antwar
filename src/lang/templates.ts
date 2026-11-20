// Level 0 of the reference's Easy authoring: pick a personality. A template plus three sliders and an optional role mix
// generate a rules program (src/lang/parse.ts). Sliders are one-way generators: the text carries a header that lets an editor
// restore the controls, but only while the text is still exactly what the generator wrote (parsePersonality).
export type Template = 'forager' | 'trail' | 'keeper' | 'guard' | 'raider';
/** Percent of newly born ants in each role (any non-negative weights; the compiler reduces them). */
export interface RoleMix { worker: number; scout: number; guard: number }
export interface Personality { template: Template; curiosity: number; boldness: number; sociability: number; mix?: RoleMix }

export const TEMPLATES: readonly Template[] = ['forager', 'trail', 'keeper', 'guard', 'raider'];
export const TEMPLATE_NAMES: Record<Template, string> = { forager: 'Forager', trail: 'Trail-layer', keeper: 'Keeper', guard: 'Guard', raider: 'Raider' };
export const TEMPLATE_HELP: Record<Template, string> = {
  forager: 'finds food and carries it home by luck; no trails',
  trail: 'finds food, lays a trail home and a food trail others follow',
  keeper: 'like the trail-layer, but after its first two deliveries a carrier settles on its pile 1 time in 15, so nobody can take it (docs/STEALING.md)',
  guard: 'sits on the food stash at the nest so nobody can steal it',
  raider: 'like the trail-layer, and heads for foe nests to take their food',
};
/** Slider labels, lowest first. Curiosity is the share of random wandering (1 step in 16, 8, 4, 2). */
export const LEVELS = {
  curiosity: ['focused', 'steady', 'curious', 'restless', 'wild'],
  boldness: ['timid', 'indifferent', 'bold', 'fierce'],
  sociability: ['loner', 'follower', 'devoted'],
} as const;
const CHANCE = [0, 16, 8, 4, 2];

export const DEFAULTS: Record<Template, Personality> = {
  forager: { template: 'forager', curiosity: 1, boldness: 1, sociability: 0 },
  trail: { template: 'trail', curiosity: 0, boldness: 1, sociability: 1 }, // = ants/trail.rules; see docs/RULES.md
  keeper: { template: 'keeper', curiosity: 0, boldness: 1, sociability: 1 },
  guard: { template: 'guard', curiosity: 0, boldness: 1, sociability: 0 },
  raider: { template: 'raider', curiosity: 0, boldness: 2, sociability: 1 },
};
export const usesSociability = (t: Template): boolean => t === 'trail' || t === 'raider' || t === 'keeper';
export const usesMix = (t: Template): boolean => t === 'trail' || t === 'raider';
/** A keeper's carrier, after its first KEEP_AFTER deliveries, settles on its pile after each delivery with chance 1 in KEEP and
 * stays there for good (measured: docs/STEALING.md). */
export const KEEP = 15;
export const KEEP_AFTER = 2;

const foeRules = (boldness: number, carrier: boolean): string[] => {
  const nc = carrier ? ' and not carrying' : ''; // ants that carry food avoid fights
  if (boldness === 0) return ['when foe ahead -> turn around, step'];
  if (boldness === 1) return [];
  const rules = [`when foe ahead${nc} -> step`];
  if (boldness === 3) rules.push(`when foe left ahead${nc} -> turn left, step`, `when foe right ahead${nc} -> turn right, step`);
  return rules;
};
const wanderRule = (curiosity: number): string[] => (curiosity ? [`when 1 in ${CHANCE[curiosity]} -> wander`] : []);

interface TrailOpts { curiosity: number; boldness: number; follow: number; lay: boolean; raid: boolean; keep?: number }
/** The search and return moods of the trail-layer. With `keep` the ant counts its deliveries in its state: moods search0/return0,
 * search1/return1, ... one pair per free delivery (KEEP_AFTER), and after the last pair each delivery ends in `settle`, where it
 * stays on its pile for good with chance 1 in `keep` (docs/STEALING.md). Without `keep` there is one pair, as in ants/trail.rules. */
function trailMoods(prefix: string, o: TrailOpts): string[] {
  const phases = o.keep ? KEEP_AFTER + 1 : 1;
  const S = (i: number): string => (phases > 1 ? `${prefix}search${i}` : `${prefix}search`), R = (i: number): string => (phases > 1 ? `${prefix}return${i}` : `${prefix}return`);
  const out = [`mood ${prefix}start`, `  always -> turn random, switch ${S(0)}`];
  for (let i = 0; i < phases; i++) {
    out.push(
      `mood ${S(i)}`,
      ...(o.follow === 2 ? ['  always -> follow trail'] : []),
      ...foeRules(o.boldness, true).map((r) => `  ${r}`),
      ...(o.raid ? ['  when foe home ahead -> step', '  when foe home left ahead -> turn left, step', '  when foe home right ahead -> turn right, step'] : []),
      `  when food here and not home here -> pickup, ${o.lay ? 'lay trail, ' : ''}turn around, switch ${R(i)}`,
      '  when food ahead and not home ahead -> step',
      '  when food left ahead and not home left ahead -> turn left, step',
      '  when food right ahead and not home right ahead -> turn right, step',
      ...(o.follow === 1 ? ['  always -> follow trail'] : []),
      ...wanderRule(o.curiosity).map((r) => `  ${r}`),
      '  otherwise explore',
      `mood ${R(i)}`,
      !o.keep ? `  when home here -> drop, turn random, switch ${S(0)}`
        : i < phases - 1 ? `  when home here -> drop, turn random, switch ${S(i + 1)}` : `  when home here -> drop, switch ${prefix}settle`,
      '  always -> return home',
      '  when home ahead -> move',
      '  when home left ahead -> turn left, move',
      '  when home right ahead -> turn right, move',
      '  otherwise roam',
    );
  }
  if (o.keep) out.push(`mood ${prefix}settle`, `  when 1 in ${o.keep} -> switch ${prefix}sit`, `  always -> turn random, switch ${S(phases - 1)}`, `mood ${prefix}sit`, '  always -> wait');
  return out;
}
/** The guard sits on the stash: food can only be picked up by an ant standing on its cell, so an ant that stays on a nest cell
 * holding food makes that food unstealable. Until it finds one it walks around inside the nest (it only ever moves onto nest
 * cells). Boldness decides whether it leaves its post for foes in view. Curiosity: how often it turns at random. */
const guardMood = (curiosity: number, boldness: number): string[] => [
  'mood guard',
  '  when food here and home here -> wait',
  ...foeRules(boldness, false).map((r) => `  ${r}`),
  '  when food ahead and home ahead -> move',
  '  when food left ahead and home left ahead -> turn left, move',
  '  when food right ahead and home right ahead -> turn right, move',
  ...(curiosity ? [`  when 1 in ${CHANCE[curiosity]} -> turn random`] : []),
  '  when home ahead -> move',
  '  otherwise turn random',
];

const header = (p: Personality): string =>
  `# personality: template=${p.template} curiosity=${p.curiosity} boldness=${p.boldness} sociability=${p.sociability}` +
  (p.mix ? ` mix=${p.mix.worker}/${p.mix.scout}/${p.mix.guard}` : '');

/** The rules text for a personality. Throws RangeError for values the controls cannot produce. */
export function personality(p: Personality): string {
  if (!TEMPLATES.includes(p.template)) throw new RangeError(`unknown template "${p.template}"`);
  const range = (name: keyof typeof LEVELS, v: number): void => {
    if (!Number.isInteger(v) || v < 0 || v >= LEVELS[name].length) throw new RangeError(`${name} must be 0..${LEVELS[name].length - 1}`);
  };
  range('curiosity', p.curiosity); range('boldness', p.boldness); range('sociability', p.sociability);
  const out = [header(p), '# Generated: edit it freely, the sliders then grey out until you reset to the template.'];
  const social = usesSociability(p.template) ? p.sociability : 0;
  if (p.mix) {
    if (!usesMix(p.template)) throw new RangeError(`the ${p.template} template has no role mix`);
    const m = p.mix, ws = [m.worker, m.scout, m.guard];
    if (ws.some((w) => !Number.isInteger(w) || w < 0 || w > 100) || ws.reduce((a, b) => a + b, 0) === 0) throw new RangeError('role weights are whole percentages and must not all be 0');
    const food = social >= 1 || m.scout > 0;
    out.push('kit trail', ...(food ? ['kit foodtrail'] : []));
    out.push(`mix ${[m.worker ? `worker_start ${m.worker}` : '', m.scout ? `scout_start ${m.scout}` : '', m.guard ? `guard ${m.guard}` : ''].filter(Boolean).join(', ')}`);
    if (m.worker) out.push(...trailMoods('worker_', { curiosity: p.curiosity, boldness: p.boldness, follow: social, lay: food, raid: p.template === 'raider' }));
    if (m.scout) out.push(...trailMoods('scout_', { curiosity: 3, boldness: 1, follow: 0, lay: true, raid: false }));
    if (m.guard) out.push(...guardMood(0, 1));
  } else if (p.template === 'forager') {
    out.push(
      'mood search', ...foeRules(p.boldness, false).map((r) => `  ${r}`),
      '  when food ahead and not home ahead -> move', '  when food here and not home here -> pickup, switch home',
      ...wanderRule(p.curiosity).map((r) => `  ${r}`), '  otherwise explore',
      'mood home', '  when home here -> drop, switch search', '  when home ahead -> move', '  otherwise wander',
    );
  } else if (p.template === 'guard') {
    out.push(...guardMood(p.curiosity, p.boldness));
  } else {
    out.push('kit trail', ...(social ? ['kit foodtrail'] : []));
    out.push(...trailMoods('', { curiosity: p.curiosity, boldness: p.boldness, follow: social, lay: social >= 1, raid: p.template === 'raider', keep: p.template === 'keeper' ? KEEP : 0 }));
  }
  return `${out.join('\n')}\n`;
}

/** The controls behind a text, or null once the text is not exactly what the generator writes (hand edited). */
export function parsePersonality(text: string): Personality | null {
  const m = /^# personality: template=(\w+) curiosity=(\d+) boldness=(\d+) sociability=(\d+)(?: mix=(\d+)\/(\d+)\/(\d+))?\n/.exec(text);
  if (!m) return null;
  const p: Personality = { template: m[1] as Template, curiosity: Number(m[2]), boldness: Number(m[3]), sociability: Number(m[4]) };
  if (m[5] !== undefined) p.mix = { worker: Number(m[5]), scout: Number(m[6]), guard: Number(m[7]) };
  try { return personality(p) === text ? p : null; } catch { return null; }
}
