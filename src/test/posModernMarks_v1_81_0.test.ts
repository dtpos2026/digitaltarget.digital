// v1.81.0 — the cloud POS carries the structure the Modern / DT Retail POS stylesheet (ui-pos.css) styles.
// Before this release the cloud order screen had three of those marks, so choosing Espresso Orange (or any modern
// theme) changed the shell but left the order screen looking like the old simple one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = read('src/styles/ui-pos.css');
const pos = read('src/pages/POSScreen.tsx');

describe('the order screen carries every mark the Modern POS stylesheet styles', () => {
  const marks = [...new Set(css.match(/data-pos-[a-z-]+/g) || [])];
  // The keyboard-shortcut strip is an offline-POS feature the cloud order screen does not have.
  const NOT_IN_CLOUD = ['data-pos-hints'];

  it('finds the marks in the stylesheet', () => { expect(marks.length).toBeGreaterThan(30); });

  for (const m of marks.filter(x => !NOT_IN_CLOUD.includes(x))) {
    it(`${m}`, () => { expect(pos).toContain(m); });
  }
});

describe('the Classic look is left alone', () => {
  it('every Modern-only structure is behind the modern flag', () => {
    // card add-circle shown only in Modern, the ADD bar only in Classic
    // (v1.104.0: the phone Order Taker also shows the Add pill and never the classic bar — photoLook)
    expect(pos).toMatch(/\{\(modern \|\| photoLook\) && \(\s*<div data-pos-card-add/);
    expect(pos).toMatch(/\{!modern && !photoLook && \(\s*<div className="dt-menu-add-btn/);
    // Classic keeps its own grid classes and cart width
    expect(pos).toContain("{ className: legacyGridClass }");
    expect(pos).toContain("modern ? '' : 'md:w-[clamp(280px,26vw,460px)]'");
    // the keypad keeps its solid brand keys in Classic
    expect(pos).toContain("modern ? 'bg-card border border-border text-foreground hover:bg-accent active:bg-accent' : 'dt-keypad-btn'");
  });

  it('the stylesheet only applies to the Modern style', () => {
    const rules = css.split('\n').filter(l => /^\s*(html|\[data-pos)/.test(l) && /data-pos-/.test(l));
    expect(rules.length).toBeGreaterThan(30);
    expect(rules.every(l => /html\[data-ui="modern"\]/.test(l))).toBe(true);
  });
});

describe('the layout engine is the offline POS\'s', () => {
  it('exposes the hook the order screen uses', () => {
    expect(read('src/hooks/usePosLayout.ts')).toContain('export function usePosLayout');
    expect(pos).toContain("usePosLayout(posRootRef");
  });
  it('the root carries the mode, density and touch marks the stylesheet reads', () => {
    expect(pos).toContain('data-pos-mode={layout.mode}');
    expect(pos).toContain('data-pos-density={layout.density}');
    expect(pos).toContain("data-pos-touch={layout.touch ? 'true' : 'false'}");
  });
});
