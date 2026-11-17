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
