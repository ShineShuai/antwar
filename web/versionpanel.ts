// The "Versions" box under an editor: save a version, see the saved ones with how they differ from the text now, diff against one (or against
// another editor), restore one. Saving happens by itself when you stop typing for a while and when the match is started; the history and the
// diff are web/versions.ts.
import { MAX_LABEL, diffStats, hunks, lineDiff, readVersions, removeVersion, snapshot } from './versions.ts';
import type { DiffOp, Version } from './versions.ts';

export interface VersionPanelOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** The editor slot ('A', 'B', ...): the history belongs to it. */
  slot: string;
  /** The other editors, for "compare with another brain". */
  others(): { name: string; text: string }[];
  /** A version was put back into the editor (the editor's own input handlers have run). */
  onRestore(): void;
  /** Texts that are not worth a version (the starter ant, untouched). */
  ignore?(text: string): boolean;
  /** Milliseconds of no typing before a version is saved by itself. */
  idleMs?: number;
}
export interface VersionPanel {
  /** Save the text as a version now (not when it is the newest already, or ignored); returns whether it was saved. */
  snapshot(label?: string): boolean;
  refresh(): void;
  destroy(): void;
}

export function mountVersions(host: HTMLElement, ta: HTMLTextAreaElement, o: VersionPanelOptions): VersionPanel {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e;
  };
  const details = el('details', '', 'versions'), summary = el('summary', 'Versions'), body = el('div');
  const label = el('input'), save = el('button', 'Save version'), cmp = el('select'), list = el('div', '', 'vlist'), diffBox = el('pre', '', 'diff'), msg = el('div', '', 'note');
  label.placeholder = 'label (optional)'; label.maxLength = MAX_LABEL; cmp.setAttribute('aria-label', 'Compare with another brain');
  const row = el('div', '', 'row'); row.append(label, save, cmp);
  body.append(row, list, diffBox, msg); details.append(summary, body); host.append(details);
  diffBox.hidden = true;

  const when = (t: number): string => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const take = (text: string, lbl: string): boolean => (o.ignore?.(text) ? false : snapshot(o.storage, o.slot, text, lbl));

  function showDiff(title: string, ops: DiffOp[], oldName: string, newName: string): void {
    const { added, removed } = diffStats(ops);
    diffBox.replaceChildren(el('div', `${title}: ${removed} line${removed === 1 ? '' : 's'} only in ${oldName} (-), ${added} only in ${newName} (+)`, 'note'));
    if (added + removed === 0) diffBox.append(el('div', 'No difference.'));
    for (const h of hunks(ops, 2)) {
      if (h.skipped) diffBox.append(el('div', `\u2026 ${h.skipped} unchanged line${h.skipped === 1 ? '' : 's'} \u2026`, 'd-gap'));
      for (const op of h.ops) diffBox.append(el('div', `${op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '} ${op.text}`, `d-${op.type}`));
    }
    diffBox.hidden = false;
  }

  function refresh(): void {
    const versions = readVersions(o.storage, o.slot).slice().reverse();
    summary.textContent = `Versions (${versions.length})`;
    list.replaceChildren();
    for (const v of versions) {
      const { added, removed } = diffStats(lineDiff(v.text, ta.value)), r = el('div', '', 'row');
      const same = added + removed === 0, diff = el('button', 'Diff'), restore = el('button', 'Restore'), del = el('button', '\u00d7');
      diff.title = 'what changed since this version'; restore.title = 'put this version back (the text now is saved first)'; del.title = 'delete this version'; del.setAttribute('aria-label', 'Delete this version');
      diff.onclick = () => showDiff(`${when(v.t)} \u2192 now`, lineDiff(v.text, ta.value), 'the version', 'the editor');
      restore.onclick = () => put(v);
      del.onclick = () => { removeVersion(o.storage, o.slot, v.t); refresh(); };
      r.append(el('span', `${when(v.t)}${v.label ? ` \u2014 ${v.label}` : ''}`, 'note'), el('span', same ? '(the text now)' : `+${added} -${removed}`, 'note'), diff, restore, del);
      list.append(r);
    }
    if (versions.length === 0) list.append(el('div', 'No versions yet. One is saved when you start a match with a changed brain, or a while after you stop typing.', 'note'));
    const choice = cmp.value;
    cmp.length = 0; cmp.add(new Option('compare with\u2026', ''));
    for (const other of o.others()) cmp.add(new Option(`brain ${other.name}`, other.name));
    cmp.value = [...cmp.options].some((x) => x.value === choice) ? choice : '';
  }
  function put(v: Version): void {
    take(ta.value, `before restoring ${when(v.t)}`);
    ta.value = v.text; ta.dispatchEvent(new Event('input', { bubbles: true }));
    msg.textContent = `Restored the version of ${when(v.t)}.`; refresh(); o.onRestore();
  }
  save.onclick = () => {
    const saved = snapshot(o.storage, o.slot, ta.value, label.value.trim());
    msg.textContent = saved ? 'Version saved.' : 'This text is already the newest version (or empty).';
    if (saved) label.value = '';
    refresh();
  };
  cmp.onchange = () => {
    const other = o.others().find((x) => x.name === cmp.value);
    if (!other) { diffBox.hidden = true; return; }
    showDiff(`brain ${o.slot} \u2192 brain ${other.name}`, lineDiff(ta.value, other.text), `brain ${o.slot}`, `brain ${other.name}`);
  };
  details.ontoggle = () => { if (details.open) refresh(); };

  let timer: ReturnType<typeof setTimeout> | undefined, soon: ReturnType<typeof setTimeout> | undefined;
  const idle = (): void => {
    clearTimeout(timer); timer = setTimeout(() => { if (take(ta.value, 'auto')) refresh(); }, o.idleMs ?? 10_000);
    clearTimeout(soon); soon = setTimeout(() => { if (details.open) refresh(); }, 300); // (the "+a -r" of each version follows the text)
  };
  ta.addEventListener('input', idle);
  refresh();
  return {
    snapshot(lbl = '') { const saved = take(ta.value, lbl); if (saved) refresh(); return saved; },
    refresh,
    destroy() { clearTimeout(timer); clearTimeout(soon); ta.removeEventListener('input', idle); details.remove(); },
  };
}
