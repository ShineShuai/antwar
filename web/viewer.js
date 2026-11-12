// Canvas hex renderer. Pure drawing: takes a 2D context, a world and frames; no DOM access.
const SQRT3 = Math.sqrt(3);

/** Pixel layout for pointy-top hexes, odd rows shifted right (as in the task spec). */
export function layout(W, H, w) {
  const h = (2 * w) / SQRT3;
  return { w, h, width: Math.ceil((W + 0.5) * w), height: Math.ceil((H * 0.75 + 0.25) * h) };
}
export const center = (L, x, y) => [(x + 0.5 + (y & 1 ? 0.5 : 0)) * L.w, (y * 0.75 + 0.5) * L.h];

export const LIGHT = { bg: '#fafaf9', rock: '#78716c', hill: ['#fecaca', '#bfdbfe'], food: '#16a34a',
  ant: ['#dc2626', '#2563eb'], carry: '#ffffff' };
export const DARK = { bg: '#1c1917', rock: '#57534e', hill: ['#7f1d1d', '#1e3a8a'], food: '#4ade80',
  ant: ['#f87171', '#60a5fa'], carry: '#ffffff' };

export function createViewer(ctx, { W, H, rock, hill }, L, colors) {
  const fixed = []; // [cx, cy, colour] for rocks and hills
  for (let p = 0; p < W * H; p++) {
    const [cx, cy] = center(L, p % W, (p / W) | 0);
    if (rock[p]) fixed.push([cx, cy, colors.rock]);
    else if (hill[p] >= 0) fixed.push([cx, cy, colors.hill[hill[p]] ?? colors.hill[0]]);
  }
  const hex = (cx, cy) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 180) * (60 * k - 30), x = cx + (L.h / 2) * Math.cos(a), y = cy + (L.h / 2) * Math.sin(a);
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  const disc = (cx, cy, r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill(); };
  return {
    draw({ food, ants }) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, L.width, L.height);
      for (const [cx, cy, c] of fixed) { ctx.fillStyle = c; hex(cx, cy); }
      ctx.fillStyle = colors.food;
      for (let p = 0; p < food.length; p++) {
        if (!food[p] || rock[p]) continue;
        const [cx, cy] = center(L, p % W, (p / W) | 0), s = L.w * (0.3 + 0.5 * Math.min(food[p], 20) / 20);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
      for (let i = 0; i < ants.length; i += 4) {
        const [cx, cy] = center(L, ants[i] % W, (ants[i] / W) | 0);
        ctx.fillStyle = colors.ant[ants[i + 1]] ?? colors.ant[0];
        disc(cx, cy, L.w * 0.36);
        if (ants[i + 3]) { ctx.fillStyle = colors.carry; disc(cx, cy, L.w * 0.14); }
      }
    },
  };
}
