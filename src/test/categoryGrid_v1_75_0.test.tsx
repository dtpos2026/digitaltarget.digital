// ============================================================
// v1.75.0 — the "All Categories" grid picker, brought back from the offline POS (v1.21.0).
//
// What is pinned:
//   • the grid shows "All items" and every category as a box with its full name,
//     icon / picture and item count; the current one is marked;
//   • picking a box selects that category and closes the picker;
//   • the POS puts the 4-box button next to "All" in the top ribbon and in the
//     side panel, keeps the ribbon scrolling sideways, and never truncates a
//     side-panel category name.
// ============================================================
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import CategoryGridDialog from '@/components/pos/CategoryGridDialog';
import { mount, q, click } from './_dom';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const CATS = [
  { id: 'burgers', name: 'Burgers', icon: '🍔', sortOrder: 1 },
  { id: 'drinks', name: 'Cold Drinks, Shakes and Juices', icon: '🥤', sortOrder: 2 },
  { id: 'bbq', name: 'BBQ & Grill', icon: '', image: 'data:image/png;base64,AAAA', sortOrder: 3 },
] as any[];
const counts = { all: 9, byCat: new Map([['burgers', 4], ['drinks', 1]]) };

function Harness({ start = 'all' }: { start?: string }) {
  const [open, setOpen] = useState(true);
  const [sel, setSel] = useState(start);
  return (
    <>
      <span data-testid="selected">{sel}</span>
      <span data-testid="open">{String(open)}</span>
      <CategoryGridDialog open={open} onOpenChange={setOpen} categories={CATS} counts={counts} selected={sel} onSelect={setSel} />
    </>
  );
}
let m: ReturnType<typeof mount> | null = null;
afterEach(() => { m?.unmount(); m = null; });
const boxes = () => Array.from(document.body.querySelectorAll('[role="listbox"] [role="option"]')) as HTMLElement[];
const text = (e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim();

describe('the All Categories picker', () => {
  it('shows All items and every category with its full name and count', () => {
    m = mount(<Harness />);
    expect(q('[role="listbox"]')!.getAttribute('aria-label')).toBe('Categories');
    expect(boxes().map(text)).toEqual([
      '📋All items9 items', '🍔Burgers4 items', '🥤Cold Drinks, Shakes and Juices1 item', 'BBQ & Grill0 items',
    ]);
    expect(boxes()[3].querySelector('img')).toBeTruthy();
    expect(boxes()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('picking a category selects it and closes the picker', () => {
    m = mount(<Harness />);
    click(boxes().find(b => text(b).includes('Cold Drinks'))!);
    expect(q('[data-testid="selected"]')!.textContent).toBe('drinks');
    expect(q('[data-testid="open"]')!.textContent).toBe('false');
  });

  it('marks the category already in use', () => {
    m = mount(<Harness start="burgers" />);
    expect(boxes().find(b => text(b).includes('Burgers'))!.getAttribute('aria-selected')).toBe('true');
    expect(boxes().find(b => text(b).includes('All items'))!.getAttribute('aria-selected')).toBe('false');
  });
});

describe('the POS category controls', () => {
  const pos = read('pages/POSScreen.tsx');
  const css = read('index.css');
  it('has the 4-box button next to All in the ribbon and in the side panel', () => {
    expect(pos.match(/data-pos-cat-grid/g)).toHaveLength(2);
    expect(pos).toMatch(/aria-label="All categories"/);
    expect(pos).toMatch(/<CategoryGridDialog[\s\S]*onSelect=\{id => setSelectedCat\(id\)\}/);
  });
  it('counts only active items, per category and in total', () => {
    expect(pos).toMatch(/const catCounts = useMemo[\s\S]*if \(!it\.isActive\) continue;[\s\S]*byCat\.set\(it\.categoryId/);
  });
  it('keeps the top ribbon scrolling sideways', () => {
    expect(pos).toMatch(/cat-ribbon flex gap-2 overflow-x-auto/);
  });
  it('never truncates a side-panel category name', () => {
    expect(pos).toMatch(/<span data-cat-name className="min-w-0 text-left leading-snug break-words">\{cat\.name\}<\/span>/);
    expect(pos).not.toMatch(/<span className="truncate text-left">\{cat\.name\}<\/span>/);
    expect(css).toMatch(/\.cat-pill\.cat-pill-side \{\s*white-space: normal;/);
    expect(css).toMatch(/\.cat-pill\.cat-grid-btn \{/);
  });
});
