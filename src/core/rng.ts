// ICFP 2004 generator: s' = s * 22695477 + 1 (mod 2^30); x_i = s_(i+4) >> 16 (14 bit).
export function createRng(seed = 12345) {
  let s = seed & 0x3fffffff, draws = 0;
  const advance = () => (s = (Math.imul(s, 22695477) + 1) & 0x3fffffff);
  for (let i = 0; i < 4; i++) advance();
  return {
    /** Next 14-bit value, 0..16383. */
    next(): number {
      const x = s >>> 16;
      advance();
      draws++;
      return x;
    },
    /** randomint(n) from the task spec: x mod n. */
    int(n: number): number {
      return this.next() % n;
    },
    get state(): number {
      return s;
    },
    /** Number of values drawn so far. */
    get draws(): number {
      return draws;
    },
    /** Restore (state, draw count), e.g. from a checkpoint. */
    load(state: number, count: number): void {
      s = state;
      draws = count;
    },
  };
}
