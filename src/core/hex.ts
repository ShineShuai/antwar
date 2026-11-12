// Hex geometry of the task spec: odd rows are shifted right; directions 0..5 clockwise from east.
export const DE = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]]; // even rows
export const DO = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]]; // odd rows

/** adjacent_cell(p, d) from the spec. */
export function step(x: number, y: number, d: number): [number, number] {
  const t = y & 1 ? DO : DE;
  return [x + t[d][0], y + t[d][1]];
}

/** All cells within hex distance r of (cx, cy), as [x, y] (unbounded; callers clip). */
export function disk(cx: number, cy: number, r: number): [number, number][] {
  const dist = new Map<string, number>([[`${cx},${cy}`, 0]]);
  const cells: [number, number][] = [[cx, cy]];
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i], k = dist.get(`${x},${y}`) as number;
    if (k === r) continue;
    for (let d = 0; d < 6; d++) {
      const [nx, ny] = step(x, y, d), key = `${nx},${ny}`;
      if (!dist.has(key)) { dist.set(key, k + 1); cells.push([nx, ny]); }
    }
  }
  return cells;
}
