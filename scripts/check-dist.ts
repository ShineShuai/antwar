// Fails if the static site would 404: every relative reference in dist/ must resolve and no .ts specifier may survive.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('dist'), problems: string[] = [];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const need = (from: string, spec: string): void => {
  const target = resolve(dirname(from), spec);
  if (spec.endsWith('.ts')) problems.push(`${relative(root, from)}: .ts specifier ${spec}`);
  else if (!existsSync(target)) problems.push(`${relative(root, from)}: missing ${spec}`);
};

for (const must of ['index.html', 'reference.html', 'web/sim-worker.js', 'web/workshop.js']) {
  if (!existsSync(join(root, must))) problems.push(`dist/${must} is missing`);
}
const files = existsSync(root) ? walk(root) : [];
for (const f of files) {
  const text = f.endsWith('.js') || f.endsWith('.html') ? readFileSync(f, 'utf8') : '';
  if (f.endsWith('.js')) {
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) need(f, m[1]);
    for (const m of text.matchAll(/new URL\(\s*["'](\.{1,2}\/[^"']+)["']/g)) need(f, m[1]);
  } else if (f.endsWith('index.html')) {
    for (const m of text.matchAll(/(?:src|href)="([^"#:]+)"/g)) need(f, m[1]);
  }
}
problems.forEach((p) => console.error(p));
if (problems.length) process.exit(1);
console.log(`check-dist: ok (${files.length} files)`);
