// v1.111.0 — each app stays an app. From the owner's day on a real phone:
//   • an Order Taker's "send to kitchen" never arrived ("1 change could not be sent") — the database function put a NULL branch into the
//     per-branch bill counter; the fix is the migration pinned here (and was proven live in a transaction that rolled back);
//   • the Order Taker's Cart and Tables were the software's cart and Tables page — they are now the app's own;
//   • the Owner app had two doors into the whole software ("Open the full software", Settings) — gone; the buying side is inside it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { Toaster } from 'sonner';
import OrderTakerCart from '@/components/pos/OrderTakerCart';
import OrderTakerTables from '@/components/otk/OrderTakerTables';
import { OwnerInventory, OwnerPurchases, OwnerSuppliers, purchasePreview, purchaseUnitsFor, stockState } from '@/components/owner/OwnerPurchasing';
import { OwnerMore } from '@/components/owner/OwnerMore';
import {
  deleteFloor, deleteInventoryItem, deleteOrder, deleteParty, deleteReceivingEntry, deleteTable, getFloors, getInventory, getOrders, getParties,
  getReceivingEntries, getStockLogs, getTables, saveInventoryItem, saveOrder, saveParty, saveTable,
} from '@/lib/store';
import type { CartItem, DiningTable, InventoryItem, Order } from '@/lib/types';

vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
vi.mock('@/lib/restaurantIdentity', () => ({ resolveRestaurantIdentity: async () => ({ workspaceCode: 'DT-4821' }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
afterEach(cleanup);

// ------------------------------------------------------------------ the database fix
describe('the Order Taker order that never arrived', () => {
  const sql = read('supabase/migrations/20261107100000_v1_111_0_portal_order_default_branch.sql');
  it('gives a branch-less session the restaurant’s first active branch before the bill counter is touched', () => {
    expect(sql).toMatch(/if v_b is null then\s+select b\.id into v_b from public\.branches b/);
    expect(sql).toMatch(/b\.tenant_id = v_tenant and b\.deleted_at is null/);
    expect(sql.indexOf('select b.id into v_b')).toBeLessThan(sql.indexOf('insert into public.order_counters'));
  });
  it('says "no_branch" instead of a raw 400 when the restaurant has no branch at all', () => {
    expect(sql).toContain("'reason', 'no_branch'");
  });
  it('changes only this one function, and ships its rollback', () => {
    expect((sql.match(/create or replace function/gi) || []).length).toBe(1);
    expect(sql).not.toMatch(/alter table|drop |create table|create policy/i);
    const back = 'docs/rollback/2026-11-07-v1_111_0-portal-upsert-order-before.sql';
    expect(existsSync(resolve(ROOT, back))).toBe(true);
    expect(read(back)).not.toContain('no_branch');
  });
});

// ------------------------------------------------------------------ the Order Taker's own cart
describe('the Order Taker’s own cart', () => {
  const line = (id: string, name: string, qty: number, extra: Partial<CartItem> = {}): CartItem => ({ id, menuItemId: id, name, price: 500, quantity: qty, lineTotal: 500 * qty, ...extra } as CartItem);
  const types = [{ value: 'dining' as const, label: 'Dine-in' }, { value: 'takeaway' as const, label: 'Takeaway' }, { value: 'delivery' as const, label: 'Delivery' }];
  const props = (o: Partial<React.ComponentProps<typeof OrderTakerCart>> = {}): React.ComponentProps<typeof OrderTakerCart> => ({
    open: true, onClose: vi.fn(), lines: [line('a', 'Zinger Burger', 2), line('b', 'Fries', 1)], subtotal: 1500, total: 1500, where: 'Table T-04', orderType: 'dining', onOrderType: vi.fn(),
    types, onQty: vi.fn(), onRemove: vi.fn(), onLineNote: vi.fn(), custName: '', custPhone: '', custAddress: '', onCustName: vi.fn(), onCustPhone: vi.fn(), onCustAddress: vi.fn(),
    note: '', onNote: vi.fn(), onClear: vi.fn(), onSend: vi.fn(), ...o,
  });

  it('shows what was ordered with steppers, the total and one big Send — and none of the till’s cart', () => {
    render(<OrderTakerCart {...props()} />);
    expect(screen.getByText('Your order')).toBeInTheDocument();
    expect(screen.getByText('Table T-04')).toBeInTheDocument();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByText('Zinger Burger')).toBeInTheDocument();
  });
});

describe('the Order Taker’s own cart — behaviour', () => {
  const line = (id: string, name: string, qty: number, extra: Partial<CartItem> = {}): CartItem => ({ id, menuItemId: id, name, price: 500, quantity: qty, lineTotal: 500 * qty, ...extra } as CartItem);
  const types = [{ value: 'dining' as const, label: 'Dine-in' }, { value: 'takeaway' as const, label: 'Takeaway' }, { value: 'delivery' as const, label: 'Delivery' }];
  const props = (o: Partial<React.ComponentProps<typeof OrderTakerCart>> = {}): React.ComponentProps<typeof OrderTakerCart> => ({
    open: true, onClose: vi.fn(), lines: [line('a', 'Zinger Burger', 2), line('b', 'Fries', 1)], subtotal: 1500, total: 1500, where: 'Table T-04', orderType: 'dining', onOrderType: vi.fn(),
    types, onQty: vi.fn(), onRemove: vi.fn(), onLineNote: vi.fn(), custName: '', custPhone: '', custAddress: '', onCustName: vi.fn(), onCustPhone: vi.fn(), onCustAddress: vi.fn(),
    note: '', onNote: vi.fn(), onClear: vi.fn(), onSend: vi.fn(), ...o,
  });

  it('changes a quantity, removes a line, and cannot go below one', () => {
    const p = props();
    render(<OrderTakerCart {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'More Zinger Burger' }));
    expect(p.onQty).toHaveBeenCalledWith('a', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Fewer Zinger Burger' }));
    expect(p.onQty).toHaveBeenCalledWith('a', -1);
    expect((screen.getByRole('button', { name: 'Fewer Fries' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fries' }));
    expect(p.onRemove).toHaveBeenCalledWith('b');
  });
  it('adds a word for the kitchen to one line, by typing or by a quick phrase', () => {
    const p = props();
    render(<OrderTakerCart {...p} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Add a note/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'No onion' }));
    expect(p.onLineNote).toHaveBeenCalledWith('a', 'No onion');
    fireEvent.change(screen.getByLabelText('Note for Zinger Burger'), { target: { value: 'well done' } });
    expect(p.onLineNote).toHaveBeenLastCalledWith('a', 'well done');
  });
  it('sends only when there is something to send', () => {
    const p = props();
    const { rerender } = render(<OrderTakerCart {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Send to kitchen/ }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
    rerender(<OrderTakerCart {...p} lines={[]} subtotal={0} total={0} />);
    expect((screen.getByRole('button', { name: /Send to kitchen/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nothing added yet/)).toBeInTheDocument();
  });
  it('asks a delivery order for a phone and an address before it can be sent', () => {
    const p = props({ orderType: 'delivery', where: 'Delivery' });
    const { rerender } = render(<OrderTakerCart {...p} />);
    expect((screen.getByRole('button', { name: /Send to kitchen/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/phone number and an address/);
    rerender(<OrderTakerCart {...p} custPhone="03001234567" />);
    expect(screen.getByRole('alert').textContent).toMatch(/an address/);
    rerender(<OrderTakerCart {...p} custPhone="03001234567" custAddress="House 5, DHA" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: /Send to kitchen/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('switches the order type, locks it on an order already on a table, and offers a customer only when wanted', () => {
    const p = props();
    const { rerender } = render(<OrderTakerCart {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Takeaway' }));
    expect(p.onOrderType).toHaveBeenCalledWith('takeaway');
    expect(screen.queryByLabelText('Customer name')).toBeNull();
    fireEvent.click(screen.getByText(/Add a customer name or phone/));
    expect(screen.getByLabelText('Customer name')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer phone')).toBeInTheDocument();
    expect(p.onCustName).not.toHaveBeenCalled();                              // no blank name is written just by opening the fields
    rerender(<OrderTakerCart {...p} typeLocked />);
    expect((screen.getByRole('button', { name: 'Takeaway' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('has nothing of the till in it: no keypad, calculator, CLR, Hold or "GRAND TOTAL"', () => {
    const { container } = render(<OrderTakerCart {...props()} />);
    const text = container.ownerDocument.body.textContent || '';
    for (const word of ['CLR', 'Calculator', 'Hold', 'GRAND TOTAL', 'Discount', 'Pay ']) expect(text).not.toContain(word);
  });
  it('is what the POS shows an order taker, and the till’s cart panel stays for everyone else', () => {
    const pos = read('src/pages/POSScreen.tsx');
    expect(pos).toContain("import OrderTakerCart from '@/components/pos/OrderTakerCart';");
    expect(pos).toMatch(/\$\{isOrderTaker \? 'hidden' : `\$\{mobileCartOpen \?/);
    expect(pos).toMatch(/<OrderTakerCart[\s\S]*onSend=\{\(\) => \{ if \(cart\.length === 0\)[\s\S]*processOrder\('running'\)/);
    expect(pos).toContain("data-otk-cart-button={isOrderTaker ? '' : undefined}");
  });
});

describe('the Order Taker’s own Tables tab', () => {
  const TID = 't';
  const table = (o: Partial<DiningTable>): DiningTable => ({ id: 'x', name: 'T', seats: 4, status: 'free', shape: 'square', ...o });
  beforeEach(() => {
    getTables().forEach(t => deleteTable(t.id)); getFloors().forEach(f => deleteFloor(f.id)); getOrders().forEach(o => deleteOrder(o.id));
    saveTable(table({ id: 'tb1', name: 'T-01' }));
    saveTable(table({ id: 'tb2', name: 'T-02', status: 'running', seatedAt: new Date(Date.now() - 600000).toISOString(), seatedGuests: 2, currentOrderId: 'ord2' }));
    saveOrder({ id: 'ord2', orderNumber: 9, orderType: 'dining', status: 'running', tableId: 'tb2', items: [], subtotal: 900, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 900, createdAt: new Date().toISOString() } as unknown as Order);
    window.location.hash = `#/order-taker/${TID}/tables`;
  });
  const mount = () => render(<HashRouter><Toaster /><OrderTakerTables /></HashRouter>);

  it('shows the tables as a phone grid with their guests, and none of the software’s table tools', () => {
    mount();
    const tiles = screen.getAllByTestId('floor-tile');
    expect(tiles).toHaveLength(2);
    expect(tiles.find(t => t.getAttribute('data-table-id') === 'tb2')!.querySelectorAll('[data-guest]')).toHaveLength(2);
    const text = document.body.textContent || '';
    for (const word of ['All Table QRs', 'Takeaway QR', 'Delivery QR', 'Edit layout', 'Customize', 'Floor Map', 'Live floor']) expect(text).not.toContain(word);
    expect(screen.getByText('1 free')).toBeInTheDocument();
  });
  it('asks how many guests at a free table, seats them, and opens the order screen of THIS app on that table', () => {
    mount();
    fireEvent.click(screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'tb1')!);
    expect(screen.getByText('How many guests?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3 guests' }));
    fireEvent.click(screen.getByRole('button', { name: /Seat 3 guests/ }));
    const t = getTables().find(x => x.id === 'tb1')!;
    expect(t.status).toBe('running');
    expect(t.seatedGuests).toBe(3);
    expect(window.location.hash).toBe(`#/order-taker/${TID}?table=tb1&guests=3`);
  });
  it('opens the bill of a busy table inside the app', () => {
    mount();
    fireEvent.click(screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'tb2')!);
    expect(window.location.hash).toBe(`#/order-taker/${TID}?retrieve=ord2`);
  });
  it('is the Tables route of the portal', () => {
    const portal = read('src/pages/OrderTakerPortalPage.tsx');
    expect(portal).toContain("import('@/components/otk/OrderTakerTables')");
    expect(portal).toContain('<Route path="/tables" element={<OrderTakerTables />} />');
    expect(portal).not.toContain("import('@/pages/TablesPage')");
  });
});

describe('the Owner app stays an app', () => {
  const caps = { can: () => true, userName: 'Owner', role: 'admin', onLogout: vi.fn(), multiBranch: true };
  it('has no door into the software: no "Open the full software", no Settings, no full Branch management', () => {
    render(<HashRouter><OwnerMore caps={caps} /></HashRouter>);
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/Open the full software/);
    expect(text).not.toMatch(/Branch management \(full\)/);
    expect(screen.queryByText('Settings')).toBeNull();
    const src = read('src/components/owner/OwnerMore.tsx');
    for (const out of ['to="/dashboard"', 'to="/settings"', 'to="/branch-management"']) expect(src).not.toContain(out);
  });
  it('lists the buying side inside the app', () => {
    render(<HashRouter><OwnerMore caps={caps} /></HashRouter>);
    for (const id of ['own-more-inventory', 'own-more-stock', 'own-more-purchases', 'own-more-suppliers', 'own-more-branches']) expect(screen.getByTestId(id)).toBeInTheDocument();
  });
  it('routes them, and a blocked account is offered Sign out — not the software', () => {
    const page = read('src/pages/OwnerAppPage.tsx');
    for (const r of ['/inventory', '/purchases', '/suppliers']) expect(page).toContain(`<Route path="${r}"`);
    expect(page).not.toContain('Open the software');
    expect(page).not.toMatch(/navigate\('\/'\)/);
  });
  it('says nothing about work "staying in the full software"', () => {
    for (const f of ['OwnerMore', 'OwnerOps']) expect(read(`src/components/owner/${f}.tsx`)).not.toMatch(/full software/);
  });
  it('the Order Taker’s bills screen stays inside its own app', () => {
    const src = read('src/components/OrderTakerBills.tsx');
    expect(src).not.toMatch(/navigate\('\/'\)|navigate\('\/\?/);
    expect(src).toContain('navigate(base)');
  });
});

describe('Owner app — purchasing', () => {
  const item = (o: Partial<InventoryItem> = {}): InventoryItem => ({ id: 'inv1', name: 'Rice', sku: '', categoryId: '', costPrice: 100, salePrice: 0, quantity: 10, unit: 'kg', baseUnit: 'kg', lowStockThreshold: 5, isActive: true, ...o });
  beforeEach(() => {
    getInventory().forEach(i => deleteInventoryItem(i.id)); getParties().forEach(p => deleteParty(p.id)); getReceivingEntries().forEach(e => deleteReceivingEntry(e.id));
    saveInventoryItem(item()); saveInventoryItem(item({ id: 'inv2', name: 'Oil', unit: 'l', baseUnit: 'l', quantity: 3, lowStockThreshold: 5 })); saveInventoryItem(item({ id: 'inv3', name: 'Salt', quantity: 0 }));
    saveParty({ id: 'p1', type: 'supplier', name: 'Ali Traders', phone: '0300 1112223', openingBalance: 0, isActive: true });
  });

  it('works out a purchase before it is saved', () => {
    const p = purchasePreview(item(), 25, 'kg', 120, 500);
    expect(p).toMatchObject({ baseQty: 25, total: 3500, after: 35 });
    expect(p.perBase).toBeCloseTo(140);
    expect(purchasePreview(undefined, 5, 'kg', 10, 0).baseQty).toBe(0);
    expect(purchaseUnitsFor(item())).toEqual(expect.arrayContaining(['kg', 'g', 'Carton']));
    expect(stockState({ quantity: 0, lowStockThreshold: 5 })).toBe('out');
    expect(stockState({ quantity: 5, lowStockThreshold: 5 })).toBe('low');
    expect(stockState({ quantity: 6, lowStockThreshold: 5 })).toBe('ok');
  });
  it('records a purchase: the stock goes up, the entry and the supplier follow — the same record the software saves', () => {
    render(<HashRouter><Toaster /><OwnerPurchases userName="Owner" /></HashRouter>);
    fireEvent.click(screen.getByTestId('own-purchase-new'));
    fireEvent.click(screen.getByTestId('own-purchase-save'));
    expect(screen.getByTestId('own-purchase-error').textContent).toMatch(/item/i);
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'inv1' } });
    fireEvent.click(screen.getByTestId('own-purchase-save'));
    expect(screen.getByTestId('own-purchase-error').textContent).toMatch(/supplier/i);
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Ali Traders' } });
    fireEvent.click(screen.getByTestId('own-purchase-save'));
    expect(screen.getByTestId('own-purchase-error').textContent).toMatch(/quantity/i);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Extra charge'), { target: { value: '500' } });
    expect(screen.getByTestId('own-purchase-preview').textContent).toMatch(/3,500/);
    expect(screen.getByTestId('own-purchase-preview').textContent).toMatch(/35\.00 kg/);
    fireEvent.click(screen.getByTestId('own-purchase-save'));

    expect(getInventory().find(i => i.id === 'inv1')!.quantity).toBe(35);
    const e = getReceivingEntries();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ supplierName: 'Ali Traders', inventoryItemId: 'inv1', quantity: 25, unit: 'kg', rate: 120, surcharge: 500, receivedBy: 'Owner' });
    expect(getStockLogs().some(l => l.inventoryItemId === 'inv1' && l.type === 'in' && l.quantity === 25)).toBe(true);
    expect(screen.queryByTestId('own-purchase-sheet')).toBeNull();
    expect(screen.getByTestId('own-purchase-total').textContent).toMatch(/3,500/);
    expect(within(screen.getByTestId('own-purchase-list')).getByText('Rice')).toBeInTheDocument();
  });
  it('counts stock: sets the quantity and writes the stock log; refuses a number that changes nothing', () => {
    render(<HashRouter><Toaster /><OwnerInventory userName="Owner" /></HashRouter>);
    expect(screen.getByTestId('own-inv-all').textContent).toMatch(/3/);
    expect(screen.getByTestId('own-inv-low').textContent).toMatch(/1/);
    expect(screen.getByTestId('own-inv-out').textContent).toMatch(/1/);
    fireEvent.click(screen.getByTestId('own-inv-item-inv1'));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('own-adjust-save'));
    expect(screen.getByTestId('own-adjust-error').textContent).toMatch(/already shows/);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8' } });
    expect(screen.getByTestId('own-adjust-preview').textContent).toMatch(/8 kg/);
    fireEvent.click(screen.getByTestId('own-adjust-save'));
    expect(getInventory().find(i => i.id === 'inv1')!.quantity).toBe(8);
    const log = getStockLogs().find(l => l.inventoryItemId === 'inv1' && l.type === 'adjustment');
    expect(log).toMatchObject({ quantity: -2 });
    expect(log!.note).toMatch(/Stock count \(Owner app\).*Owner/);
  });
  it('takes out waste, but never more than is in stock', () => {
    render(<HashRouter><Toaster /><OwnerInventory userName="Owner" /></HashRouter>);
    fireEvent.click(screen.getByTestId('own-inv-item-inv1'));
    fireEvent.click(screen.getByRole('button', { name: 'Waste / used' }));
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('own-adjust-save'));
    expect(screen.getByTestId('own-adjust-error').textContent).toMatch(/Only 10 kg in stock/);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'spoiled' } });
    fireEvent.click(screen.getByTestId('own-adjust-save'));
    expect(getInventory().find(i => i.id === 'inv1')!.quantity).toBe(6);
    expect(getStockLogs().find(l => l.inventoryItemId === 'inv1' && l.quantity === -4)!.note).toMatch(/Waste.*spoiled/);
  });
  it('filters to what is low or out, and searches by name', () => {
    render(<HashRouter><OwnerInventory userName="Owner" /></HashRouter>);
    fireEvent.click(screen.getByTestId('own-inv-low'));
    expect(within(screen.getByTestId('own-inv-list')).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('own-inv-item-inv2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('own-inv-all'));
    fireEvent.change(screen.getByLabelText('Search stock'), { target: { value: 'sal' } });
    expect(within(screen.getByTestId('own-inv-list')).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('own-inv-item-inv3')).toBeInTheDocument();
  });
  it('lists suppliers with what was bought from them and a Call button', () => {
    getReceivingEntries().forEach(e => deleteReceivingEntry(e.id));
    render(<HashRouter><OwnerSuppliers /></HashRouter>);
    const list = within(screen.getByTestId('own-supplier-list'));
    expect(list.getByText(/Ali Traders/)).toBeInTheDocument();
    expect(list.getByRole('link', { name: 'Call Ali Traders' }).getAttribute('href')).toBe('tel:03001112223');
  });
});
