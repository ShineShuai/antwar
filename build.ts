// Static build for GitHub Pages: one tsc emit writes unbundled ES modules to dist/ (.ts specifiers rewritten to .js);
// dist/index.html is the workshop, dist/reference.html the spec. All URLs are relative, so a project site
// (https://USER.github.io/REPO/) works as well as a root site.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
const page = readFileSync('web/workshop.html', 'utf8')
  .replace('src="workshop.js"', 'src="web/workshop.js"')
  .replace('href="../reference.html"', 'href="reference.html"');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', page);
copyFileSync('reference.html', 'dist/reference.html');
