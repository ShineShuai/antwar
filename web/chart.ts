// A small line chart as SVG: the model (scales, ticks, paths) is plain arithmetic and tested; drawChart only turns it into elements.

export interface ChartLine { label: string; color: string; y: number[] }
export interface ChartData { x: number[]; lines: ChartLine[] }
export interface Tick { at: number; label: string }
export interface ChartModel {
  w: number; h: number;
  /** The plot area in svg units. */
  plot: { x0: number; y0: number; x1: number; y1: number };
  /** One path per line, in the order of `lines`. */
  paths: string[];
  xTicks: Tick[]; yTicks: Tick[];
}

/** A step of 1, 2 or 5 times a power of ten, and the top of the axis (a multiple of the step) at or above `max`, for about `want` steps. */
export function niceScale(max: number, want = 4): { step: number; top: number } {
  if (!(max > 0)) return { step: 1, top: want };
  const raw = max / want, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  return { step, top: Math.ceil(max / step - 1e-9) * step };
}

const fmt = (v: number): string => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

export function chartModel(d: ChartData, w = 320, h = 170): ChartModel {
  const plot = { x0: 34, y0: 8, x1: w - 8, y1: h - 20 };
  const xMax = Math.max(1, ...d.x), { step, top } = niceScale(Math.max(0, ...d.lines.flatMap((l) => l.y)));
  const px = (v: number): number => plot.x0 + (v / xMax) * (plot.x1 - plot.x0), py = (v: number): number => plot.y1 - (v / top) * (plot.y1 - plot.y0);
  const paths = d.lines.map((l) => l.y.map((v, k) => `${k === 0 ? 'M' : 'L'}${px(d.x[k]).toFixed(1)} ${py(v).toFixed(1)}`).join(' '));
  const yTicks: Tick[] = [], xTicks: Tick[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) yTicks.push({ at: py(v), label: fmt(v) });
  const xs = niceScale(xMax, 4);
  for (let v = 0; v <= xMax + 1e-9; v += xs.step) xTicks.push({ at: px(v), label: fmt(v) });
  return { w, h, plot, paths, xTicks, yTicks };
}

const NS = 'http://www.w3.org/2000/svg';
export function drawChart(d: ChartData, m: ChartModel = chartModel(d)): SVGSVGElement {
  const el = (tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${m.w} ${m.h}`, width: '100%', role: 'img' }) as SVGSVGElement;
  const { x0, y0, x1, y1 } = m.plot;
  for (const t of m.yTicks) {
    svg.append(el('line', { x1: x0, x2: x1, y1: t.at, y2: t.at, stroke: 'var(--line)', 'stroke-width': 0.5 }));
    svg.append(el('text', { x: x0 - 4, y: t.at + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--mut)' }, t.label));
  }
  for (const t of m.xTicks) svg.append(el('text', { x: t.at, y: y1 + 12, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--mut)' }, t.label));
  svg.append(el('line', { x1: x0, x2: x0, y1: y0, y2: y1, stroke: 'var(--line)' }), el('line', { x1: x0, x2: x1, y1, y2: y1, stroke: 'var(--line)' }));
  d.lines.forEach((l, k) => svg.append(el('path', { d: m.paths[k], fill: 'none', stroke: l.color, 'stroke-width': 1.5, 'stroke-linejoin': 'round' })));
  return svg;
}
