// v1.109.0 — right-to-left polish, pinned at the source: the three sidebars open from the reading-start edge (not always
// the left), and the clock keeps its digits in one direction so "06 Nov 2026" is never shown as "Nov 2026 06".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('RTL — the menu drawer', () => {
  for (const file of ['src/components/shell/RefinedSidebar.tsx', 'src/components/shell/ModernSidebar.tsx', 'src/components/AppLayout.tsx']) {
    it(`${file} sits at the start edge and slides out the same way`, () => {
      const s = src(file);
      expect(s).toMatch(/fixed inset-y-0 start-0/);
      expect(s).not.toMatch(/fixed inset-y-0 left-0/);
      expect(s).toContain('-translate-x-full rtl:translate-x-full');
      expect(s).toContain('lg:rtl:translate-x-0');            // on a wide screen it is part of the page, not off-canvas
    });
  }
  it('uses the end border so the divider faces the page in both directions', () => {
    expect(src('src/components/shell/RefinedSidebar.tsx')).toContain('border-e border-sidebar-border');
    expect(src('src/components/shell/ModernSidebar.tsx')).toContain('border-e border-sidebar-border');
  });
});

describe('RTL — numbers that must not reorder', () => {
  it('every clock and date in the header is its own left-to-right run', () => {
    const s = src('src/components/shell/HeaderClock.tsx');
    expect((s.match(/dir="ltr"/g) || []).length).toBe(6);
  });
});
