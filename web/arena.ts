// The Arena page: compare the project's brains on many worlds (head to head, league, sweep, fairness) and watch any game of a result.
// The brains, the seed, the Rules and the map are the workshop's saved project (web/project.ts); the tools are web/evaluate.ts.
import { watchMatch } from '../src/watch.ts';
import { MATCH_ROUNDS } from '../src/core/match.ts';
import { mountEvaluate } from './evaluate.ts';
import { mountGameView } from './gameview.ts';
import { mountNav } from './nav.ts';
import { brainSummary, onProjectChange, readProject, worldLabel } from './project.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

mountNav($('nav'), 'arena');
let project = readProject();
const view = mountGameView($('viewhost'));
const projectBox = $('project');

function drawProject(): void {
  const list = document.createElement('div'), meta = document.createElement('div');
  list.className = 'brains'; meta.className = 'note';
  project.texts.forEach((t, c) => {
    const row = document.createElement('div'), b = document.createElement('b');
    b.textContent = project.names[c]; row.append(b, document.createTextNode(brainSummary(t)));
    list.append(row);
  });
  meta.textContent = `World: ${worldLabel(project)}. Seed ${project.seed}. Rules ${project.rules}.`;
  projectBox.replaceChildren(list, meta);
}
const watchProject = (): void => view.load(watchMatch({ texts: project.texts, names: project.names, mapText: project.world.mapText, seed: project.seed, rules: project.rules, rounds: MATCH_ROUNDS }));

const tools = mountEvaluate($('evalhost'), {
  brains: () => ({ names: project.names, texts: project.texts }),
  rules: () => project.rules,
  world: () => ({ kind: project.world.kind, mapText: project.world.mapText, seed: project.seed }),
  watch: (spec) => view.load(spec),
});
function reload(): void { project = readProject(); drawProject(); tools.refresh(); }
$('reload').onclick = () => { reload(); watchProject(); };
$('match').onclick = watchProject;
onProjectChange(reload);
drawProject();
watchProject(); // the map and the match are visible at once, paused at round 0
