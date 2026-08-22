// ============================================================
// Tests — v1.19.8 a loading flag must clear on EVERY path
//
// REPORTED: the Super Admin console's Restaurants tab spun forever. The header
// counters showed the correct numbers, so the data had loaded — but the tab
// body never rendered and nothing could be clicked.
//
// CAUSE: setLoading(false) sat AFTER the try block, on the normal fall-through
// path. The Supabase branch returns early, so that line was never reached.
// `loading` stayed true forever.
//
// This is the second "spinner forever" bug in two builds. Both looked like a
// slow network and were waited on rather than reported. A stranded flag is
// worse than an error: an error tells you something is wrong.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

/**
 * A function that sets a loading flag, then returns early, but clears the flag
 * only once and outside a `finally`, can strand the spinner.
 */
function strandedLoadingBlocks(src: string): number {
  let count = 0;
  const re = /setLoading\(true\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Look at the enclosing function body, bounded by the next top-level close.
    const rest = src.slice(m.index);
    const end = rest.search(/\n {2}\}(;|\))/);
    const block = end > 0 ? rest.slice(0, end) : rest;
    // `return;` may sit on its own line OR inline inside a guard clause —
    // the real bug used the inline form, which an anchored regex missed.
    const hasEarlyReturn = /\breturn;/.test(block);
    const hasFinally = /\}\s*finally\s*\{/.test(block);
    const clears = (block.match(/setLoading\(false\)/g) || []).length;
    if (hasEarlyReturn && !hasFinally && clears < 2) count++;
  }
  return count;
}

describe('no loading flag can be stranded by an early return', () => {
  for (const f of sourceFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    if (!src.includes('setLoading(true)')) continue;
    const rel = path.relative(root, f);
    it(`${rel} clears its loading flag on every path`, () => {
      expect(strandedLoadingBlocks(src)).toBe(0);
    });
  }
});

describe('the detector actually detects', () => {
  it('flags the exact shape of the bug', () => {
    const buggy = `
  const load = async () => {
    setLoading(true);
    try {
      if (onSupabase()) { await loadFromSupabase(); return; }
      await loadFromFirebase();
    } catch (e) { toast.error(e); }
    setLoading(false);
  };`;
    expect(strandedLoadingBlocks(buggy)).toBe(1);
  });

  it('accepts the finally form', () => {
    const fixed = `
  const load = async () => {
    setLoading(true);
    try {
      if (onSupabase()) { await loadFromSupabase(); return; }
      await loadFromFirebase();
    } catch (e) { toast.error(e); } finally { setLoading(false); }
  };`;
    expect(strandedLoadingBlocks(fixed)).toBe(0);
  });
});
