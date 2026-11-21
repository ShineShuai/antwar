// Syntax highlighting under a brain editor. The textarea stays the editor (caret, selection, undo, IME all native); its text is
// made transparent and a <pre> behind it, with the same font and box, paints the same text in colours (src/lang/highlight.ts).
// The pre is repainted on input and on every script assignment to `.value` (examples, share links, the personality panel), and
// follows the textarea's scroll position. Chrome is the tested browser; nothing here is Chrome-only, but nothing else was run.
import { segments } from '../src/lang/highlight.ts';

/** Beyond this many characters the text is shown plain: a 10,000-state .ant would be a span per word on every key press. */
export const HIGHLIGHT_MAX = 150_000;
const PAD = 6; // px, as in `.hl pre, .hl textarea` of workshop.html

export function mountHighlight(ta: HTMLTextAreaElement): void {
  if (ta.parentElement?.classList.contains('hl')) return;
  const wrap = document.createElement('div'), pre = document.createElement('pre');
  wrap.className = 'hl'; pre.className = 'hl-pre'; pre.setAttribute('aria-hidden', 'true');
  ta.replaceWith(wrap);
  wrap.append(pre, ta);
  ta.classList.add('hl-ta'); ta.wrap = 'off';

  let shown: string | null = null;
  const follow = (): void => {
    // room for the textarea's scroll bars, so that both can scroll to the same end
    pre.style.paddingBottom = `${PAD + Math.max(0, ta.offsetHeight - ta.clientHeight - 2 * ta.clientTop)}px`;
    pre.style.paddingRight = `${PAD + Math.max(0, ta.offsetWidth - ta.clientWidth - 2 * ta.clientLeft)}px`;
    pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft;
  };
  const paint = (): void => {
    const text = ta.value;
    if (text !== shown) {
      shown = text;
      const frag = document.createDocumentFragment();
      if (text.length > HIGHLIGHT_MAX) frag.append(text);
      else {
        for (const s of segments(text)) {
          if (!s.kind) { frag.append(s.text); continue; }
          const e = document.createElement('span');
          e.className = `t-${s.kind}`; e.textContent = s.text;
          frag.append(e);
        }
      }
      frag.append(' '); // a last empty line of the textarea needs a line here too
      pre.replaceChildren(frag);
    }
    follow();
  };

  const own = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (own?.get && own.set) {
    const { get, set } = own;
    Object.defineProperty(ta, 'value', { configurable: true, get: () => get.call(ta) as string, set: (v: string) => { set.call(ta, v); paint(); } });
  }
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', follow);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(follow).observe(ta);
  paint();
}
