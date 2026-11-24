// The bar at the top of every page: the pages of the site (each a plain HTML file, dist/ root) and the reference.
export type Page = 'workshop' | 'arena';
const PAGES: { id: Page; href: string; label: string; help: string }[] = [
  { id: 'workshop', href: 'index.html', label: 'Workshop', help: 'write brains and watch a match' },
  { id: 'arena', href: 'arena.html', label: 'Arena', help: 'compare brains on many worlds: head to head, league, sweep' },
];

export function mountNav(host: HTMLElement, current: Page): void {
  host.className = 'nav';
  for (const p of PAGES) {
    const a = document.createElement('a');
    a.href = p.href; a.textContent = p.label; a.title = p.help;
    if (p.id === current) { a.className = 'here'; a.setAttribute('aria-current', 'page'); }
    host.append(a);
  }
  const ref = document.createElement('a');
  ref.href = 'reference.html'; ref.textContent = 'Reference'; ref.title = 'the full specification';
  host.append(ref);
}
