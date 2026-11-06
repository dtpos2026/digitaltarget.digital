// v1.80.0 — the Advanced floor view on the Tables page, driven through the real page and the real store.
// What is pinned: the Grid and Floor Map are still there and still the default; the new view shows floors,
// colours every table by what is happening on it, counts each table once, lets a manager arrange and edit
// tables, and hands every bill action back to the page's own dialogs.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { Toaster } from 'sonner';
import TablesPage from '@/pages/TablesPage';
import {
  deleteFloor, deleteOrder, deleteTable, getFloors, getOrders, getTables, saveFloor, saveOrder, saveTable,
} from '@/lib/store';
import { FLOOR_SETTINGS_KEY } from '@/lib/floorAdvanced';
import type { DiningTable, Order } from '@/lib/types';

const mins = (m: number) => new Date(Date.now() - m * 60000).toISOString();

function reset() {
  getTables().forEach(t => deleteTable(t.id));
  getFloors().forEach(f => deleteFloor(f.id));
  getOrders().forEach(o => deleteOrder(o.id));
  localStorage.clear();
  localStorage.setItem('pos-user-role', 'admin');
}

const tbl = (o: Partial<DiningTable>): DiningTable => ({ id: 't', name: 'Table', seats: 4, status: 'free', shape: 'square', ...o });
const bill = (o: Partial<Order>): Order => ({
  id: 'o', orderNumber: 1, orderType: 'dining', status: 'running', items: [{ id: 'i1', name: 'Karahi', quantity: 1, lineTotal: 1500 } as any],
  subtotal: 1500, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1500, createdAt: mins(20), kotPrinted: true, ...o,
} as Order);

function seedRestaurant() {
  saveFloor({ id: 'f1', name: 'Ground', sortOrder: 0 });
  saveFloor({ id: 'f2', name: 'Rooftop', sortOrder: 1 });
  saveTable(tbl({ id: 'a', name: 'Table 1', floorId: 'f1', x: 20, y: 20 }));                                  // available
  saveTable(tbl({ id: 'b', name: 'Table 2', floorId: 'f1', x: 200, y: 20, status: 'running', seatedAt: mins(25), seatedGuests: 3, currentOrderId: 'ob' })); // ordered
  saveTable(tbl({ id: 'c', name: 'Table 3', floorId: 'f1', x: 380, y: 20, status: 'running', seatedAt: mins(140), seatedGuests: 4, currentOrderId: 'oc' })); // over time
  saveTable(tbl({ id: 'd', name: 'Roof 1', floorId: 'f2', shape: 'round', x: 20, y: 20, status: 'pending-payment', seatedAt: mins(50), seatedGuests: 2, currentOrderId: 'od' }));
  saveTable(tbl({ id: 'e', name: 'Roof 2', floorId: 'f2', x: 200, y: 20 }));
  saveOrder(bill({ id: 'ob', orderNumber: 11, tableId: 'b', grandTotal: 2400 }));
  saveOrder(bill({ id: 'oc', orderNumber: 12, tableId: 'c', grandTotal: 6100 }));
  saveOrder(bill({ id: 'od', orderNumber: 13, tableId: 'd', grandTotal: 1800 }));
}

function mount() {
  return render(<HashRouter><Toaster /><TablesPage /></HashRouter>);
}
const openAdvanced = () => fireEvent.click(screen.getByTestId('tables-view-advanced'));
const tile = (name: string) => screen.getAllByTestId('floor-tile').find(t => t.getAttribute('aria-label')?.startsWith(`${name},`))!;

beforeEach(() => {
  cleanup();
  reset();
  window.confirm = vi.fn(() => true);
  window.prompt = vi.fn(() => 'Terrace');
});

describe('the existing views are untouched', () => {
  it('v1.110.0: opens on the Live floor; the Grid and the Floor Map are still one tap away and unchanged', () => {
    seedRestaurant();
    mount();
    expect(screen.getByRole('button', { name: /^Grid$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Floor Map/ })).toBeInTheDocument();
    expect(screen.getByTestId('tables-view-advanced').textContent).toMatch(/Live floor/);
    expect(screen.getByTestId('advanced-floor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Grid$/ }));
    expect(screen.queryByTestId('advanced-floor')).toBeNull();
    // the Grid's own cards are rendered
    expect(screen.getAllByText(/chairs|persons/).length).toBeGreaterThan(0);
  });

  it('the Floor Map still renders its draggable tables', () => {
    seedRestaurant();
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Floor Map/ }));
    expect(screen.getByText(/Drag tables to arrange your floor map/)).toBeInTheDocument();
  });

  it('remembers the last view on this device (the default for a new device is the Live floor)', () => {
    seedRestaurant();
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: /^Grid$/ }));
    expect(localStorage.getItem('dtpos-tables-view')).toBe('grid');
    first.unmount();
    mount();
    expect(screen.queryByTestId('advanced-floor')).toBeNull();
    openAdvanced();
    expect(localStorage.getItem('dtpos-tables-view')).toBe('advanced');
  });
});

describe('floors', () => {
  it('opens on an overview of every floor, with its own table count and occupancy', () => {
    seedRestaurant();
    mount();
    openAdvanced();
    const ov = screen.getByTestId('floor-overview');
    expect(within(ov).getByText('Ground')).toBeInTheDocument();
    expect(within(ov).getByText('Rooftop')).toBeInTheDocument();
    expect(within(ov).getByText(/3 tables/)).toBeInTheDocument();
    expect(within(ov).getByText(/2 tables/)).toBeInTheDocument();
    // Ground: 2 of 3 tables in use
    expect(within(ov).getByText('67%')).toBeInTheDocument();
  });

  it('a floor tab shows only that floor\'s tables', () => {
    seedRestaurant();
    mount();
    openAdvanced();
    fireEvent.click(screen.getByRole('tab', { name: /Ground/ }));
    const names = screen.getAllByTestId('floor-tile').map(t => t.getAttribute('aria-label')!.split(',')[0]);
    expect(names.sort()).toEqual(['Table 1', 'Table 2', 'Table 3']);
    fireEvent.click(screen.getByRole('tab', { name: /Rooftop/ }));
    expect(screen.getAllByTestId('floor-tile')).toHaveLength(2);
  });

  it('a restaurant with no floors sees every table on one canvas, with no Overview tab', () => {
    saveTable(tbl({ id: 'x1', name: 'Table 1' }));
    saveTable(tbl({ id: 'x2', name: 'Table 2' }));
    mount();
    openAdvanced();
    expect(screen.queryByRole('tab', { name: /Overview/ })).toBeNull();
    expect(screen.getAllByTestId('floor-tile')).toHaveLength(2);
  });

  it('tables that belong to no floor get an Unassigned tab', () => {
    seedRestaurant();
    saveTable(tbl({ id: 'u', name: 'Bar 1' }));
    mount();
    openAdvanced();
    fireEvent.click(screen.getByRole('tab', { name: /Unassigned/ }));
    expect(screen.getAllByTestId('floor-tile')).toHaveLength(1);
  });
});

describe('colours and counts', () => {
  const open = () => { seedRestaurant(); mount(); openAdvanced(); fireEvent.click(screen.getByRole('tab', { name: /Ground/ })); };

  it('each table carries the state it is really in', () => {
    open();
    expect(tile('Table 1').getAttribute('data-state')).toBe('available');
    expect(tile('Table 2').getAttribute('data-state')).toBe('ordered');
    expect(tile('Table 3').getAttribute('data-state')).toBe('overtime');
  });

  it('the status bar counts every table exactly once', () => {
    open();
    const bar = screen.getByTestId('floor-statusbar');
    const chips = within(bar).getAllByRole('button');
    const total = chips.reduce((n, c) => n + Number(c.querySelector('span')?.textContent || 0), 0);
    expect(total).toBe(3);
    expect(within(bar).getByText('Over time').closest('button')!.textContent).toMatch(/^1/);
  });

  it('tapping a status dims the tables that are not in it, and tapping again restores them', () => {
    open();
    const chip = within(screen.getByTestId('floor-statusbar')).getByText('Over time').closest('button')!;
    fireEvent.click(chip);
    expect(tile('Table 1').className).toMatch(/opacity-25/);
    expect(tile('Table 3').className).not.toMatch(/opacity-25/);
    fireEvent.click(chip);
    expect(tile('Table 1').className).not.toMatch(/opacity-25/);
  });

  it('shows the time seated and the open amount on a table', () => {
    open();
    expect(within(tile('Table 2')).getByText('25m')).toBeInTheDocument();
    expect(within(tile('Table 2')).getByText(/#11 · Rs 2,400/)).toBeInTheDocument();
  });

  it('the total in the status bar is the sum of the open bills of the floor', () => {
    open();
    expect(within(screen.getByTestId('floor-statusbar')).getByText(/Rs 8,500/)).toBeInTheDocument();
  });
});

describe('acting on a table (Live mode)', () => {
  const open = () => { seedRestaurant(); mount(); openAdvanced(); fireEvent.click(screen.getByRole('tab', { name: /Ground/ })); };
  const panel = () => screen.getByTestId('floor-actions');

  it('with nothing selected the bill actions are off', () => {
    open();
    expect(within(panel()).getByRole('button', { name: /Move table/ })).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: /Dine-in/ })).toBeDisabled();
  });

  it('an occupied table can be moved, merged or split; Dine-in stays off', () => {
    open();
    fireEvent.click(tile('Table 2'));
    expect(within(panel()).getByTestId('floor-selected')).toHaveTextContent('Table 2');
    for (const n of [/Move table/, /Merge table/, /Split checks/]) expect(within(panel()).getByRole('button', { name: n })).toBeEnabled();
    expect(within(panel()).getByRole('button', { name: /Dine-in/ })).toBeDisabled();
  });

  it('an available table can be seated; it has no bill to move', () => {
    open();
    fireEvent.click(tile('Table 1'));
    expect(within(panel()).getByRole('button', { name: /Dine-in/ })).toBeEnabled();
    expect(within(panel()).getByRole('button', { name: /Move table/ })).toBeDisabled();
  });

  it('"Move table" opens the page\'s own transfer dialog for that table', () => {
    open();
    fireEvent.click(tile('Table 2'));
    fireEvent.click(within(panel()).getByRole('button', { name: /Move table/ }));
    expect(screen.getByText(/Transfer Bill from Table 2/)).toBeInTheDocument();
  });

  it('double-tapping a table opens the page\'s table dialog', () => {
    open();
    fireEvent.doubleClick(tile('Table 2'));
    expect(screen.getByText(/Edit \/ Add Items/)).toBeInTheDocument();
  });

  it('does not offer a Reservation button, because there is no reservation module', () => {
    open();
    expect(screen.queryByText(/reservation/i)).toBeNull();
  });
});

describe('Edit layout', () => {
  const open = () => { seedRestaurant(); mount(); openAdvanced(); fireEvent.click(screen.getByRole('tab', { name: /Ground/ })); fireEvent.click(screen.getByRole('button', { name: /Edit layout/ })); };

  it('is offered to an admin or manager only', () => {
    localStorage.setItem('pos-user-role', 'cashier');
    seedRestaurant();
    mount();
    openAdvanced();
    expect(screen.queryByRole('button', { name: /Edit layout/ })).toBeNull();
  });

  it('adds a table to the current floor, named after the highest number, with a place on the canvas', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Add table/ }));
    const added = getTables().find(t => t.name === 'Table 4')!;
    expect(added).toBeDefined();
    expect(added.floorId).toBe('f1');
    expect(Number.isFinite(added.x)).toBe(true);
    expect(Number.isFinite(added.y)).toBe(true);
    expect(getTables()).toHaveLength(6);
  });

  it('changes a table\'s name, chairs and shape', () => {
    open();
    fireEvent.click(tile('Table 1'));
    const props = screen.getByTestId('floor-properties');
    fireEvent.change(within(props).getByLabelText('Name'), { target: { value: 'Window 1' } });
    fireEvent.change(within(props).getByLabelText('Chairs'), { target: { value: '6' } });
    fireEvent.click(within(props).getByRole('button', { name: 'Round' }));
    fireEvent.click(within(props).getByRole('button', { name: /Save changes/ }));
    const t = getTables().find(x => x.id === 'a')!;
    expect(t).toMatchObject({ name: 'Window 1', seats: 6, shape: 'round' });
  });

  it('refuses a name another table already has, and a chair count out of range', () => {
    open();
    fireEvent.click(tile('Table 1'));
    const props = screen.getByTestId('floor-properties');
    fireEvent.change(within(props).getByLabelText('Name'), { target: { value: 'table 2' } });
    fireEvent.click(within(props).getByRole('button', { name: /Save changes/ }));
    expect(getTables().find(x => x.id === 'a')!.name).toBe('Table 1');
    fireEvent.change(within(props).getByLabelText('Name'), { target: { value: 'Table 1' } });
    fireEvent.change(within(props).getByLabelText('Chairs'), { target: { value: '99' } });
    fireEvent.click(within(props).getByRole('button', { name: /Save changes/ }));
    expect(getTables().find(x => x.id === 'a')!.seats).toBe(4);
  });

  it('moves a table to another floor', () => {
    open();
    fireEvent.click(tile('Table 1'));
    const props = screen.getByTestId('floor-properties');
    fireEvent.change(within(props).getByLabelText('Floor'), { target: { value: 'f2' } });
    fireEvent.click(within(props).getByRole('button', { name: /Save changes/ }));
    expect(getTables().find(x => x.id === 'a')!.floorId).toBe('f2');
  });

  it('deletes a free table, but not one that is in use', () => {
    open();
    fireEvent.click(tile('Table 2'));
    fireEvent.click(within(screen.getByTestId('floor-properties')).getByRole('button', { name: /Delete Table 2/ }));
    expect(getTables().some(t => t.id === 'b')).toBe(true);
    fireEvent.click(tile('Table 1'));
    fireEvent.click(within(screen.getByTestId('floor-properties')).getByRole('button', { name: /Delete Table 1/ }));
    expect(getTables().some(t => t.id === 'a')).toBe(false);
  });

  it('"Tidy up" gives every table of the floor its own cell', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Tidy up/ }));
    const ground = getTables().filter(t => t.floorId === 'f1');
    expect(new Set(ground.map(t => `${t.x}:${t.y}`)).size).toBe(3);
    // the other floor is not touched
    expect(getTables().find(t => t.id === 'e')).toMatchObject({ x: 200, y: 20 });
  });

  it('arrow keys move the selected table one grid step and save it', () => {
    open();
    const t = tile('Table 1');
    fireEvent.keyDown(t, { key: 'ArrowRight' });
    expect(getTables().find(x => x.id === 'a')!.x).toBe(40);
  });

  it('adds a floor', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /Floor$/ }));
    expect(getFloors().map(f => f.name)).toContain('Terrace');
  });
});

describe('Customize', () => {
  it('opens a panel with a live preview, and keeps the choices on this device', () => {
    seedRestaurant();
    mount();
    openAdvanced();
    fireEvent.click(screen.getByTestId('floor-customize'));
    const sheet = screen.getByTestId('floor-settings');
    expect(within(sheet).getAllByTestId('floor-tile')).toHaveLength(4);
    fireEvent.click(within(sheet).getByRole('radio', { name: /Colour-blind safe/ }));
    const saved = JSON.parse(localStorage.getItem(FLOOR_SETTINGS_KEY)!);
    expect(saved.palette).toBe('accessible');
  });

  it('a custom colour changes the tile, and Reset puts the palette colour back', () => {
    seedRestaurant();
    mount();
    openAdvanced();
    fireEvent.click(screen.getByTestId('floor-customize'));
    const sheet = screen.getByTestId('floor-settings');
    fireEvent.change(within(sheet).getByLabelText('Colour for Available'), { target: { value: '#123456' } });
    expect(JSON.parse(localStorage.getItem(FLOOR_SETTINGS_KEY)!).colors.available).toBe('#123456');
    fireEvent.click(within(sheet).getByRole('button', { name: /Reset Available colour/ }));
    expect(JSON.parse(localStorage.getItem(FLOOR_SETTINGS_KEY)!).colors.available).toBeUndefined();
  });

  it('turning "Time seated" off removes the time pills', () => {
    seedRestaurant();
    mount();
    openAdvanced();
    fireEvent.click(screen.getByRole('tab', { name: /Ground/ }));
    expect(within(tile('Table 2')).queryByText('25m')).not.toBeNull();
    fireEvent.click(screen.getByTestId('floor-customize'));
    fireEvent.click(within(screen.getByTestId('floor-settings')).getByRole('switch', { name: 'Time seated' }));
    expect(within(tile('Table 2')).queryByText('25m')).toBeNull();
  });
});
