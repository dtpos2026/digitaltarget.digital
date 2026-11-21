// v1.115.0 — the design package's master-detail layout (SW-19 Customers): list beside panel on a wide window, dialog below it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MasterDetail from '@/components/layout/MasterDetail';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const media = (width: number) => {
  window.matchMedia = ((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
    return { matches: width >= min, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};
afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

const mount = (open: boolean, onClose = () => {}) => render(
  <MasterDetail title="Customer panel" open={open} onClose={onClose} emptyText="Select a customer." list={<ul><li>Ahmed</li><li>Sara</li></ul>} detail={<p>Ahmed Raza — 24 orders</p>} />,
);

describe('MasterDetail', () => {
  it('1366 px: the list and the panel are on screen together; no row selected shows the hint', () => {
    media(1366);
    mount(false);
    expect(document.querySelector('[data-master-detail="wide"]')).not.toBeNull();
    expect(screen.getByText('Ahmed')).toBeInTheDocument();
    expect(document.querySelector('[data-detail-empty]')?.textContent).toBe('Select a customer.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('1366 px: a selected row fills the panel beside the list — no dialog — and the X clears it', () => {
    media(1366);
    const close = vi.fn();
    mount(true, close);
    expect(screen.getByText('Ahmed Raza — 24 orders')).toBeInTheDocument();
    expect(screen.getByText('Ahmed')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(document.querySelector('[data-detail-close]')!);
    expect(close).toHaveBeenCalled();
  });
  it('768 px and 360 px: the same panel comes up as a dialog over the list, as before', () => {
    for (const w of [768, 360]) {
      media(w);
      const { unmount } = mount(true);
      expect(document.querySelector('[data-master-detail="stacked"]')).not.toBeNull();
      expect(screen.getByRole('dialog')).toHaveTextContent('Ahmed Raza — 24 orders');
      expect(screen.getByRole('dialog')).toHaveTextContent('Customer panel');
      unmount();
    }
  });
  it('with no matchMedia at all the dialog layout is used (the safe one)', () => {
    mount(false);
    expect(document.querySelector('[data-master-detail="stacked"]')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Customers (SW-19)', () => {
  const page = read('src/pages/CustomersPage.tsx');
  it('uses it: the customer panel is the Customer Intelligence card, the chosen card is outlined, the old always-a-dialog is gone', () => {
    expect(page).toContain('<MasterDetail');
    expect(page).toContain('detail={viewing ? <CustomerIntelligenceCard customer={viewing} /> : null}');
    expect(page).toContain("viewing?.id === c.id ? 'ring-2 ring-primary' : ''");
    expect(page).not.toContain('<DialogTitle>Customer Intelligence</DialogTitle>');
  });
});

describe('Orders (SW-06) and Parties (SW-18) use it too', () => {
  it('Running / Hold bills and Bill Reprint open the selected bill in the panel beside the list, with the old dialog gone', () => {
    for (const f of ['src/pages/RunningBillsPage.tsx', 'src/pages/BillReprintPage.tsx']) {
      const src = read(f);
      expect(src, f).toContain('<MasterDetail');
      expect(src, f).toContain('data-bill-panel=');
    }
    expect(read('src/pages/BillReprintPage.tsx')).toContain("ring-2 ring-primary");
    // v1.131.0 — the Orders screen is the design's table: the selected ROW is marked (aria-selected + the accent tint), not a ringed card
    expect(read('src/pages/RunningBillsPage.tsx')).toContain('data-bill-row=');
    expect(read('src/pages/RunningBillsPage.tsx')).toContain('aria-selected={sel}');
    expect(read('src/pages/RunningBillsPage.tsx')).not.toContain('<Dialog open={!!viewOrder}');
    expect(read('src/pages/BillReprintPage.tsx')).not.toContain('<Dialog open={!!view} onOpenChange');
    // the panel carries the actions the design shows — Reprint and Pay — and Edit, Kitchen, Hold, Cancel behind its ⋯ menu
    expect(read('src/pages/RunningBillsPage.tsx')).toMatch(/data-bill-panel[\s\S]*Reprint[\s\S]*Pay[\s\S]*Edit in POS/);
    expect(read('src/pages/BillReprintPage.tsx')).toMatch(/data-bill-panel[\s\S]*Reprint Customer Receipt/);
  });
  it('Party Master: a row selects the party; its panel shows what is owed, the counts and the latest ledger lines; the row buttons do not also select', () => {
    const src = read('src/pages/PartyMasterPage.tsx');
    expect(src).toContain('<MasterDetail');
    expect(src).toContain('data-party-panel=');
    expect(src).toContain('data-party-balance');
    expect(src).toContain('onClick={() => setSelectedId(p.id)}');
    expect(src).toContain('e.stopPropagation(); setForm(p); setOpen(true);');
    expect(src).toContain('e.stopPropagation(); onDelete(p);');
    // the secondary columns step aside only while the panel is on screen (1280–1699 px)
    expect(src.match(/min-\[1280px\]:max-\[1699px\]:hidden/g)?.length).toBe(8);
  });
});
