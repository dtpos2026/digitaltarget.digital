// v1.132.0 — the Tables screen in DT Refined is the design's Floor plan (SW-10): its own header (title, floor tabs, Edit layout, ⋯),
// the legend above the plan, and the selected table's panel — Open table · Request bill · Move / merge. Every function of the Live floor
// is still reachable; every other look is unchanged (the older Tables tests pin that).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { Toaster } from 'sonner';
import TablesPage from '@/pages/TablesPage';
import { deleteFloor, deleteOrder, deleteTable, getFloors, getOrders, getTables, saveFloor, saveOrder, saveTable } from '@/lib/store';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import type { DiningTable, Order } from '@/lib/types';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const mins = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const tbl = (o: Partial<DiningTable>): DiningTable => ({ id: 't', name: 'Table', seats: 4, status: 'free', shape: 'square', ...o });
const bill = (o: Partial<Order>): Order => ({
  id: 'o', orderNumber: 1, orderType: 'dining', status: 'running', items: [{ id: 'i1', name: 'Karahi', quantity: 1, lineTotal: 1500 } as any],
  subtotal: 1500, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1500, createdAt: mins(20), kotPrinted: true, ...o,
} as Order);

function seed() {
  saveFloor({ id: 'f1', name: 'Ground', sortOrder: 0 });
  saveFloor({ id: 'f2', name: 'Rooftop', sortOrder: 1 });
  saveTable(tbl({ id: 'a', name: 'T-01', floorId: 'f1', x: 20, y: 20 }));
  saveTable(tbl({ id: 'b', name: 'T-02', floorId: 'f1', x: 200, y: 20, status: 'running', seatedAt: mins(25), seatedGuests: 3, currentOrderId: 'ob' }));
  saveTable(tbl({ id: 'd', name: 'Roof 1', floorId: 'f2', x: 20, y: 20 }));
  saveOrder(bill({ id: 'ob', orderNumber: 1042, tableId: 'b', grandTotal: 3280 }));
}
const mount = () => render(<HashRouter><Toaster /><TablesPage /></HashRouter>);
const tile = (name: string) => screen.getAllByTestId('floor-tile').find(t => t.getAttribute('aria-label')?.startsWith(`${name},`))!;

beforeEach(() => {
  cleanup();
  getTables().forEach(t => deleteTable(t.id)); getFloors().forEach(f => deleteFloor(f.id)); getOrders().forEach(o => deleteOrder(o.id));
  localStorage.clear(); localStorage.setItem('pos-user-role', 'admin');
  setUiStyle('modern'); setTheme(REFINED_THEME_ID);
  window.confirm = vi.fn(() => true);
});
afterEach(cleanup);

describe('the Floor plan in DT Refined', () => {
  it('is titled Floor plan, opens on the first floor, and says what is on it', () => {
    seed(); mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Floor plan');
    expect(screen.getByText('Ground · 2 tables · 1 free')).toBeInTheDocument();
    expect(screen.queryByTestId('floor-overview')).toBeNull();                              // no Overview first: the design opens on a plan
    expect(screen.getAllByTestId('floor-tile')).toHaveLength(2);
    expect(screen.queryByText('Dining Tables')).toBeNull();                                // the old header card is gone
  });

  it('floor tabs are a segmented control; a tab shows only that floor', () => {
    seed(); mount();
    const tabs = within(screen.getByRole('tablist', { name: 'Floors' })).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Ground', 'Rooftop']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1]);
    expect(screen.getAllByTestId('floor-tile')).toHaveLength(1);
    expect(screen.getByText('Rooftop · 1 table · 1 free')).toBeInTheDocument();
  });

  it('the legend sits above the plan, and the old toolbar, Overview tab and bottom bar are not drawn', () => {
    seed(); mount();
    const legend = screen.getByTestId('floor-statusbar');
    const plan = screen.getByTestId('advanced-floor-canvas');
    expect(legend.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('floor-statusbar')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: /Overview/ })).toBeNull();
  });

  it('a free table: the panel names it and offers Seat guests; Request bill and Move / merge wait for a bill', () => {
    seed(); mount();
    fireEvent.click(tile('T-01'));
    const panel = screen.getByTestId('floor-selected');
    expect(within(panel).getByRole('heading', { name: 'T-01' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Seat guests' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Request bill/ })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: /Move \/ merge/ })).toBeDisabled();
  });

  it('a table with a bill: guests, minutes and bill number, the current bill, and the three actions', () => {
    seed(); mount();
    fireEvent.click(tile('T-02'));
    const panel = screen.getByTestId('floor-selected');
    expect(panel.textContent).toMatch(/3 guests · seated 25m · Bill #1042/);
    expect(panel.textContent).toMatch(/Current bill/);
    expect(panel.textContent).toMatch(/3,280/);
    expect(within(panel).getByRole('button', { name: 'Open table' })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: /Request bill/ })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: /Move \/ merge/ })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: /Take payment/ })).toBeEnabled();
  });

  it('Request bill marks the table as waiting for payment', () => {
    seed(); mount();
    fireEvent.click(tile('T-02'));
    fireEvent.click(within(screen.getByTestId('floor-selected')).getByRole('button', { name: /Request bill/ }));
    expect(getTables().find(t => t.id === 'b')!.status).toBe('pending-payment');
  });

  it('Move / merge offers Move table, Merge table and Split checks, which open the page\'s own dialogs', () => {
    seed(); mount();
    fireEvent.click(tile('T-02'));
    fireEvent.click(within(screen.getByTestId('floor-selected')).getByRole('button', { name: /Move \/ merge/ }));
    expect([...document.querySelectorAll('[data-floor-bill-action]')].map(b => b.getAttribute('data-floor-bill-action'))).toEqual(['transfer', 'merge', 'split']);
    fireEvent.click(document.querySelector('[data-floor-bill-action="transfer"]')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();                                 // the transfer dialog of the page
  });

  it('Table QR and Dine history are still one tap from the panel', () => {
    seed(); mount();
    fireEvent.click(tile('T-02'));
    const panel = screen.getByTestId('floor-selected');
    expect(within(panel).getByRole('button', { name: /Table QR/ })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: /Dine history/ }));
    expect(screen.getByText(/T-02 — Dine History/)).toBeInTheDocument();
  });

  it('the ⋯ menu holds what the old toolbar did: Overview, Customize, take away / delivery, zoom, the other views and the QR codes', () => {
    seed(); mount();
    fireEvent.click(screen.getByTestId('floor-more'));
    const menu = document.querySelector('[data-floor-more-menu]') as HTMLElement;
    const text = menu.textContent || '';
    for (const w of ['All floors overview', 'Customize the floor', 'New take away order', 'New delivery order', 'Zoom', 'Grid', 'Floor map', 'All table QR codes', 'Take away QR', 'Delivery QR']) expect(text).toContain(w);
    fireEvent.click(within(menu).getByText('All floors overview'));
    expect(screen.getByTestId('floor-overview')).toBeInTheDocument();                       // the Overview is one tap away
  });

  it('Edit layout toggles the tools (Add table, counters) and Done returns to the live plan', () => {
    seed(); mount();
    fireEvent.click(screen.getByTestId('floor-edit-toggle'));
    expect(screen.getByRole('button', { name: /Add table/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Fixture type')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('floor-edit-toggle'));
    expect(screen.queryByRole('button', { name: /Add table/ })).toBeNull();
  });

  it('Grid and Floor map are reachable from the ⋯ menu, and the Floor map\'s own header brings the Live floor back', () => {
    seed(); mount();
    fireEvent.click(screen.getByTestId('floor-more'));
    fireEvent.click(document.querySelector('[data-tables-view="layout"]')!);
    expect(screen.getByText(/Drag tables to arrange your floor map/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tables-view-advanced'));
    expect(screen.getByTestId('advanced-floor')).toBeInTheDocument();
  });
});
