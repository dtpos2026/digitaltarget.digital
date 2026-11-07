// ============================================================================
// Phrase layer (v1.112.0) — Urdu for the three phone apps without rewriting every screen.
//
// The apps carry their words as plain English in the screens. Rewriting ~10,000 strings into t('key') calls is weeks of work and
// breaks every test that reads the words, so this layer does what a translator would do by hand: it looks at the words that are
// ON SCREEN, and where a piece of text is exactly a phrase it knows, shows the translation instead. Everything else stays English
// (so a screen can never go blank), and switching back to English puts the original words back.
//
//   • Only whole pieces of text are matched (after collapsing white space) — never part of a word, never a number or a name the
//     restaurant typed. React draws "Available orders (", "3", ")" as three pieces; each piece is translated on its own.
//   • Text nodes and the words in placeholder / aria-label / title / alt are translated. Input values, scripts, styles and anything
//     marked translate="no" are left alone.
//   • A MutationObserver keeps it up to date as the screen changes. Our own writes are recognised and skipped, so there is no loop,
//     and when React puts new English into a piece we translated, that piece is translated again.
//   • Nothing here knows about the till: the caller starts it only inside the Owner, Rider and Order Taker apps.
// ============================================================================

export type PhraseDictionary = Record<string, string>;

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'NOSCRIPT', 'CODE', 'PRE', 'SVG']);

/** What a piece of text is compared by: white space collapsed, ends trimmed. */
export const normalizePhrase = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * A key with a placeholder in it is a template: "Order {n}" matches "Order #1042" and its value says where the piece goes ("آرڈر {n}").
 * `{n}` stands for a number-like value (1042, #1042, ~12, 3.5, 12:40) and `{}` for any text (a name). Whole pieces only, as
 * everywhere else; a key without a placeholder is always tried first, and the longer template wins. Counts use `{n}` on purpose:
 * "{n} orders" must never turn "My orders" into half Urdu.
 */
interface Template { re: RegExp; out: string; weight: number }
const templateCache = new WeakMap<PhraseDictionary, Template[]>();
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function templatesOf(dict: PhraseDictionary): Template[] {
  let t = templateCache.get(dict);
  if (!t) {
    t = Object.keys(dict).filter(k => /\{n?\}/.test(k)).map(k => ({
      re: new RegExp('^' + k.split(/(\{n\}|\{\})/).map(part => (part === '{n}' ? '([#~]?\\d[\\d.,:]*)' : part === '{}' ? '(.+?)' : escapeRe(part))).join('') + '$'),
      out: dict[k], weight: k.replace(/\{n?\}/g, '').length,
    })).sort((a, b) => b.weight - a.weight);
    templateCache.set(dict, t);
  }
  return t;
}

/** The translation of one piece of text, keeping the white space around it; null when the phrase is not known. */
export function translatePhrase(raw: string, dict: PhraseDictionary): string | null {
  if (!raw) return null;
  const key = normalizePhrase(raw);
  if (!key) return null;
  let hit: string | undefined = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : undefined;
  if (hit === undefined) {
    for (const t of templatesOf(dict)) {
      const m = t.re.exec(key);
      if (m) { let i = 0; hit = t.out.replace(/\{n?\}/g, () => m[++i] ?? ''); break; }
    }
  }
  if (hit === undefined) return null;
  const lead = /^\s*/.exec(raw)![0];
  const trail = /\s*$/.exec(raw)![0];
  return lead + hit + trail;
}

// ---- state --------------------------------------------------------------
let dict: PhraseDictionary | null = null;
let observer: MutationObserver | null = null;
let root: Node | null = null;
/** The text node's original English and what we wrote over it. */
const textOriginal = new WeakMap<Node, string>();
const textWritten = new WeakMap<Node, string>();
/** Per element and attribute: the original English and what we wrote. */
const attrState = new WeakMap<Element, Map<string, { original: string; written: string }>>();
let translatedCount = 0;

/** `withTags`: text inside <script>, <style>, <textarea>… is never touched, but an <input>'s own placeholder is. */
const skipped = (el: Element | null, withTags: boolean): boolean => {
  for (let e = el; e; e = e.parentElement) {
    if (withTags && SKIP_TAGS.has(e.tagName.toUpperCase())) return true;
    if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-translate') || e.getAttribute('contenteditable') === 'true') return true;
  }
  return false;
};

function doText(n: Text): void {
  if (!dict) return;
  const cur = n.nodeValue ?? '';
  if (textWritten.get(n) === cur) return;                 // our own write coming back through the observer
  if (skipped(n.parentElement, true)) return;
  const next = translatePhrase(cur, dict);
  if (next === null || next === cur) { textOriginal.delete(n); textWritten.delete(n); return; }
  textOriginal.set(n, cur);
  textWritten.set(n, next);
  n.nodeValue = next;
  translatedCount++;
}

function doAttr(el: Element, name: string): void {
  if (!dict) return;
  const cur = el.getAttribute(name);
  if (cur === null) return;
  const st = attrState.get(el)?.get(name);
  if (st && st.written === cur) return;
  if (skipped(el, false)) return;
  const next = translatePhrase(cur, dict);
  if (next === null || next === cur) { attrState.get(el)?.delete(name); return; }
  let m = attrState.get(el);
  if (!m) { m = new Map(); attrState.set(el, m); }
  m.set(name, { original: cur, written: next });
  el.setAttribute(name, next);
  translatedCount++;
}

function walk(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) { doText(node as Text); return; }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.getAttribute('translate') === 'no' || el.hasAttribute('data-no-translate')) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;       // its words are not ours to change
  for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
}

function restore(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const orig = textOriginal.get(node);
    if (orig !== undefined && node.nodeValue === textWritten.get(node)) node.nodeValue = orig;
    textOriginal.delete(node); textWritten.delete(node);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const m = attrState.get(el);
  if (m) {
    for (const [name, st] of m) if (el.getAttribute(name) === st.written) el.setAttribute(name, st.original);
    attrState.delete(el);
  }
  for (let c = el.firstChild; c; c = c.nextSibling) restore(c);
}

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    if (r.type === 'characterData') { if (r.target.nodeType === Node.TEXT_NODE) doText(r.target as Text); }
    else if (r.type === 'attributes') { if (r.attributeName && (ATTRS as readonly string[]).includes(r.attributeName)) doAttr(r.target as Element, r.attributeName); }
    else r.addedNodes.forEach(walk);
  }
}

// ---- public -------------------------------------------------------------

/** Start translating everything under `scope` (the whole document by default) with this dictionary. Safe to call again with a new one. */
export function enablePhraseLayer(dictionary: PhraseDictionary, scope?: Node): void {
  if (typeof document === 'undefined') return;
  if (dict && observer) disablePhraseLayer();
  dict = dictionary;
  root = scope ?? document.body;
  translatedCount = 0;
  walk(root);
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(onMutations);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }
}

/** Stop, and put the original English back everywhere it was replaced. */
export function disablePhraseLayer(): void {
  observer?.disconnect();
  observer = null;
  if (root) restore(root);
  root = null;
  dict = null;
}

export const isPhraseLayerOn = (): boolean => dict !== null;

/** How many pieces the layer has translated on screen since it started (for tests and the coverage note). */
export const phraseLayerCount = (): number => translatedCount;
