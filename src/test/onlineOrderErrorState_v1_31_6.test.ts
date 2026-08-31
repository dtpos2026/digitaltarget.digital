// ============================================================================
// v1.31.6 — a network failure is not an empty menu.
//
// FOUND BY RUNNING THE APP in a real browser with the backend unreachable.
// The public ordering page settled into:
//     "My Restaurant — Online Ordering · Delivery — All (0) — No items found."
// and stayed there for as long as it was watched. No error, no retry.
// A customer reads that as "this restaurant has no food".
//
// Two silent failures stacked:
//   1. `.catch(() => setReady(true))` reported success for a load that failed.
//   2. initStore() does not reject on this route at all — with no reachable
//      backend it falls through to the local path and resolves, so an empty
//      menu is indistinguishable from a good load.
//
// VERIFIED IN THE BROWSER AFTER THE FIX:
//   "We could not reach My Restaurant. Check your internet connection and try
//    again. Your cart is safe. [Try again]"   — retry present, 0 exceptions.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE = readFileSync(resolve(process.cwd(), 'src/pages/OnlineOrderPage.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('the public ordering page tells a failure from an empty menu', () => {
  it('no longer swallows the load failure into a success', () => {
    expect(PAGE).not.toContain('initStore().then(() => setReady(true)).catch(() => setReady(true))');
    expect(PAGE).toContain('const [loadFailed, setLoadFailed] = useState(false)');
  });

  it('asks the server directly, because initStore resolves either way', () => {
    const at = PAGE.indexOf('const loadStore = useCallback');
    expect(at).toBeGreaterThan(-1);
    const fn = PAGE.slice(at, PAGE.indexOf('useEffect(() => { void loadStore(); }', at));
    expect(fn).toContain("from('menu_items')");
    expect(fn).toContain("count: 'exact', head: true");
    expect(fn).toContain('setLoadFailed(failed)');
  });

  it('races the probe against a deadline, so a hung network cannot spin forever', () => {
    const at = PAGE.indexOf('const loadStore = useCallback');
    const fn = PAGE.slice(at, PAGE.indexOf('useEffect(() => { void loadStore(); }', at));
    expect(fn).toContain('Promise.race');
    expect(fn).toMatch(/setTimeout\(\(\) => res\(timedOut\), \d+\)/);
    // and it always finishes: ready is set on every path
    expect(fn).toContain('setReady(true)');
  });

  it('shows an error with a retry, not "No items found"', () => {
    const at = PAGE.indexOf('visibleItems.length === 0 && loadFailed');
    expect(at).toBeGreaterThan(-1);
    const block = PAGE.slice(at, at + 900);
    expect(block).toContain('We could not reach');
    expect(block).toContain('Try again');
    expect(block).toContain('void loadStore()');
    // the failure branch is checked BEFORE the plain empty branch
    expect(at).toBeLessThan(PAGE.indexOf('No items found'));
  });

  it('still says "No items found" when the restaurant genuinely has none', () => {
    // A real empty menu must not be dressed up as a network error.
    expect(PAGE).toContain('No items found.');
    expect(PAGE).toContain('visibleItems.length === 0 ? (');
  });
});
