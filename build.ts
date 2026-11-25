// Static build for GitHub Pages: one tsc emit writes unbundled ES modules to dist/ (.ts specifiers rewritten to .js);
// dist/index.html is the workshop, dist/reference.html the spec. All URLs are relative, so a project site
// (https://USER.github.io/REPO/) works as well as a root site.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
mkdirSync('dist', { recursive: true });
// Each page is a plain HTML file importing the shared modules: the workshop is the home page (index.html), the others keep their names.
for (const [from, to, script] of [['web/workshop.html', 'index.html', 'workshop'], ['web/arena.html', 'arena.html', 'arena'], ['web/maps.html', 'maps.html', 'maps']] as const) {
  const page = readFileSync(from, 'utf8').replace(`src="${script}.js"`, `src="web/${script}.js"`).replace('href="../reference.html"', 'href="reference.html"');
  writeFileSync(`dist/${to}`, page);
}
copyFileSync('reference.html', 'dist/reference.html');
