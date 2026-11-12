// World files: ICFP format (W, H, then H rows of space-separated cells) and a-z hills.
// '#' rock, '.' clear, '+' / '-' hills 0 / 1, 'a'..'z' hill 0..25, '1'..'9' food.
export function parseMap(text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const W = Number(rows[0]), H = Number(rows[1]);
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 3 || H < 3 || W * H > 40000) {
    throw new Error('bad world size');
  }
  if (rows.length - 2 !== H) throw new Error(`expected ${H} rows, got ${rows.length - 2}`);
  const N = W * H;
  const map = { W, H, rock: new Uint8Array(N), food: new Uint16Array(N), hill: new Int8Array(N).fill(-1) };
  rows.slice(2).forEach((row, y) => {
    const cells = row.replace(/\s+/g, '');
    if (cells.length !== W) throw new Error(`row ${y}: expected ${W} cells`);
    [...cells].forEach((c, x) => {
      const p = y * W + x;
      if (c === '#') map.rock[p] = 1;
      else if (c === '+') map.hill[p] = 0;
      else if (c === '-') map.hill[p] = 1;
      else if (/[a-z]/.test(c)) map.hill[p] = c.charCodeAt(0) - 97;
      else if (/[1-9]/.test(c)) map.food[p] = +c;
      else if (c !== '.') throw new Error(`row ${y}: bad cell "${c}"`);
    });
  });
  return map;
}
