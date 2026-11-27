// Level 0 controls under a brain editor: template, three sliders, role mix. They are one-way generators: moving a control
// rewrites the editor's text; once the text is edited by hand (it no longer equals what the generator writes) the controls
// grey out until "Reset to template".
import { DEFAULTS, LEVELS, SETTLE, SETTLE_DEFAULT, SETTLE_MANY, TEMPLATES, TEMPLATE_HELP, TEMPLATE_NAMES, parsePersonality, personality, usesMix, usesSociability } from '../src/lang/templates.ts';
import type { Personality, RoleMix } from '../src/lang/templates.ts';

export interface PersonalityPanel { /** Re-read the editor's text (call after the text was changed from outside). */ sync(): void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

type Slider = 'curiosity' | 'boldness' | 'sociability' | 'settling';
const level = (p: Personality, name: Slider): number => (name === 'settling' ? p.settling ?? SETTLE_DEFAULT : p[name]);

/** `colonies` is the number of colonies of the map (the number of editors): a keeper's settling dose is chosen for it (docs/STEALING.md). */
export function mountPersonality(host: HTMLElement, box: HTMLTextAreaElement, onChange: (restart: boolean) => void, colonies: () => number = () => 2): PersonalityPanel {
  let p: Personality = { ...DEFAULTS.trail };
  let generated = false;
  const root = el('details', 'pers');
  const tpl = el('select', 'tpl');
  tpl.add(new Option('pick a template…', ''));
  TEMPLATES.forEach((t) => tpl.add(new Option(TEMPLATE_NAMES[t], t)));
  const reset = el('button', '', 'Reset to template');
  const hint = el('div', 'hint');
  const tip = el('div', 'tip'), tipText = el('span'), tipBtn = el('button');
  tip.append(tipText, document.createTextNode(' '), tipBtn); tip.hidden = true;
  const sliders = (['curiosity', 'boldness', 'sociability', 'settling'] as const).map((name) => {
    const row = el('label', 'slide', name[0].toUpperCase() + name.slice(1));
    const range = el('input'), value = el('span', 'val');
    range.type = 'range'; range.min = '0'; range.max = String(LEVELS[name].length - 1); range.step = '1';
    row.append(range, value);
    return { name, range, value, row };
  });
  const mixOn = el('input'), mixRow = el('div', 'row mix');
  mixOn.type = 'checkbox';
  const weights = (['worker', 'scout', 'guard'] as const).map((role) => {
    const inp = el('input'), lab = el('label', 'w', role);
    inp.type = 'number'; inp.min = '0'; inp.max = '100';
    lab.append(inp);
    return { role, inp, lab };
  });
  const mixLabel = el('label', 'row');
  mixLabel.append(mixOn, document.createTextNode(' role mix (% of new ants)'));
  mixRow.append(...weights.map((w) => w.lab));
  root.append(el('summary', '', 'Personality'), tpl, hint, tip, ...sliders.map((s) => s.row), mixLabel, mixRow, reset);
  host.append(root);

  const refresh = (): void => {
    const social = usesSociability(p.template), mixable = usesMix(p.template);
    tpl.value = generated ? p.template : '';
    for (const s of sliders) {
      const v = level(p, s.name);
      s.range.value = String(v);
      s.value.textContent = s.name === 'settling' && p.colonies !== undefined ? `${p.colonies}+ colonies: 1 in ${SETTLE_MANY}` : LEVELS[s.name][v] + (s.name === 'settling' ? ` (1 in ${SETTLE[v]})` : '');
      s.range.disabled = !generated || (s.name === 'sociability' && !social) || (s.name === 'settling' && p.template !== 'keeper');
      s.row.classList.toggle('off', s.range.disabled);
    }
    mixOn.checked = !!p.mix; mixOn.disabled = !generated || !mixable;
    for (const w of weights) { w.inp.value = String(p.mix?.[w.role] ?? (p.mix ? 0 : DEFAULT_MIX[w.role])); w.inp.disabled = !generated || !mixable || !p.mix; }
    mixRow.classList.toggle('off', !p.mix || !generated);
    reset.disabled = tpl.value === '' && !text(box.value);
    if (!generated) hint.textContent = text(box.value) ? 'Edited by hand (or not generated): the controls are off. "Reset to template" rewrites the text.' : 'Pick a template to generate rules.';
    else hint.textContent = `${TEMPLATE_HELP[p.template]}${!social ? '; no trails, so no sociability' : ''}`;
    // a keeper's settling dose depends on the number of colonies: 1 in 10 is for two, 1 in 40 for three or more (docs/STEALING.md)
    const n = colonies();
    tip.hidden = true;
    if (generated && p.template === 'keeper' && p.settling === undefined) {
      if (p.colonies === undefined && n >= 3) {
        tipText.textContent = `${n} colonies on this map: a Keeper settling 1 in ${SETTLE[SETTLE_DEFAULT]} (the two-colony dose) comes last against trail ants in 3-colony play; 1 in ${SETTLE_MANY} comes first.`;
        tipBtn.textContent = `Use 1 in ${SETTLE_MANY}`; tipBtn.onclick = () => { p = { ...p, colonies: n }; apply(true); }; tip.hidden = false;
      } else if (p.colonies !== undefined && n < 3) {
        tipText.textContent = `This Keeper is set for ${p.colonies}+ colonies (1 in ${SETTLE_MANY}); with two colonies 1 in ${SETTLE[SETTLE_DEFAULT]} wins.`;
        tipBtn.textContent = `Use 1 in ${SETTLE[SETTLE_DEFAULT]}`; tipBtn.onclick = () => { const { colonies: _c, ...rest } = p; p = rest; apply(true); }; tip.hidden = false;
      }
    }
  };
  // nearly all workers: every share given to scouts or guards measured as a loss (docs/STEALING.md)
  const DEFAULT_MIX: RoleMix = { worker: 90, scout: 10, guard: 0 };
  const text = (s: string): boolean => s.trim().length > 0;
  const apply = (restart: boolean): void => {
    try {
      box.value = personality(p);
      generated = true;
      refresh();
      onChange(restart);
    } catch (e) {
      hint.textContent = e instanceof Error ? e.message : String(e);
    }
  };

  tpl.onchange = () => {
    if (!tpl.value) return;
    p = { ...DEFAULTS[tpl.value as Personality['template']] };
    if (p.template === 'keeper' && colonies() >= 3) p = { ...p, colonies: colonies() }; // a new Keeper gets the dose for this map
    apply(true);
  };
  for (const s of sliders) {
    s.range.oninput = () => { const { colonies: _c, ...rest } = p; p = { ...(s.name === 'settling' ? rest : p), [s.name]: Number(s.range.value) }; apply(false); }; // (a chosen level decides: the colonies dose goes)
    s.range.onchange = () => onChange(true);
  }
  mixOn.onchange = () => { const { mix: _old, ...rest } = p; p = mixOn.checked ? { ...rest, mix: { ...DEFAULT_MIX } } : rest; apply(true); };
  for (const w of weights) {
    w.inp.oninput = () => { if (p.mix) { p = { ...p, mix: { ...p.mix, [w.role]: Math.max(0, Math.min(100, Math.round(Number(w.inp.value) || 0))) } }; apply(false); } };
    w.inp.onchange = () => onChange(true);
  }
  reset.onclick = () => { if (!generated && !tpl.value && !text(box.value)) return; apply(true); };
  return {
    sync(): void {
      const parsed = parsePersonality(box.value);
      if (parsed) { p = parsed; generated = true; } else generated = false;
      refresh();
    },
  };
}
