// Random official-syntax programs, rewritten as flat assembly with gotos (the form the reference demo and the assembler read).
/** Official-syntax program -> flat assembly: one label per state, `goto` after every instruction (omitted when the
 * successor is the next line), optionally a leading goto. Behaviour must not change, because goto costs nothing. */
export function desugar(ant: string, leadingGoto: boolean): string {
  const lines = ant.split('\n'), out = leadingGoto ? ['goto s0'] : [];
  lines.forEach((raw, i) => {
    const k = raw.toLowerCase().split(/\s+/), lab = (n: string): string => `s${n}`;
    let body: string, next: string | null = null, fail: string | null = null;
    switch (k[0]) {
      case 'sense': {
        const cond = k[4] === 'marker' ? `marker ${k[5]}` : k[4];
        body = `sense ${k[1]} ${cond}`; next = k[2]; fail = k[3]; break;
      }
      case 'mark': case 'unmark': body = `${k[0]} ${k[1]}`; next = k[2]; break;
      case 'pickup': case 'move': body = k[0]; next = k[1]; fail = k[2]; break;
      case 'drop': body = 'drop'; next = k[1]; break;
      case 'turn': body = `turn ${k[1]}`; next = k[2]; break;
      default: body = `flipzero ${k[1]}`; next = k[2]; fail = k[3]; // flip
    }
    out.push(`${lab(String(i))}: ${body}${fail === null ? '' : ` else ${lab(fail)}`}`);
    if (Number(next) !== i + 1 || i === lines.length - 1) out.push(`  goto ${lab(next)}`);
  });
  return out.join('\n');
}
