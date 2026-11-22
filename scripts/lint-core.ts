// Core must be integer-only and deterministic (Web app tab): no '/', float literals, clocks, Math.random, or any Math function
// that returns a fraction (only the integer ones below are allowed), and no parseFloat.
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** The Math members that cannot produce a fraction from integers. */
const INTEGER_MATH: ReadonlySet<string> = new Set(['imul', 'min', 'max', 'abs', 'clz32', 'sign']);

/** Violations in one source text, as "file:line: message". */
export function lintSource(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  const report = (node: ts.Node, msg: string): void => {
    out.push(`${name}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${msg}`);
  };
  const visit = (node: ts.Node): void => {
    const k = node.kind;
    if (ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.SlashToken || node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken)) {
      report(node, "division '/' is not allowed in core/");
    }
    if (k === ts.SyntaxKind.NumericLiteral) {
      const t = node.getText();
      if (!/^0[xXbBoO]/.test(t) && /[.eE]/.test(t)) report(node, `float literal ${t} is not allowed in core/`);
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'Math') {
      if (node.name.text === 'random') report(node, 'Math.random is not allowed in core/');
      else if (!INTEGER_MATH.has(node.name.text)) report(node, `Math.${node.name.text} may return a fraction: not allowed in core/`);
    }
    if (ts.isIdentifier(node) && node.text === 'parseFloat') report(node, 'parseFloat is not allowed in core/');
    if (ts.isIdentifier(node) && (node.text === 'Date' || node.text === 'performance')) {
      report(node, `${node.text} (a clock) is not allowed in core/`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = new URL('../src/core/', import.meta.url);
  const bad = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    .flatMap((f) => lintSource(`src/core/${f}`, readFileSync(new URL(f, dir), 'utf8')));
  bad.forEach((m) => console.error(m));
  if (bad.length) process.exit(1);
  console.log('lint-core: ok');
}
