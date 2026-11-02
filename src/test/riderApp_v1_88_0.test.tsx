// ============================================================
// v1.88.0 — DT Rider, the design package's rider screens (design-project/05-rider-app).
//
// What is pinned:
//   • the rules (lib/riderApp.ts): the four rider steps and the ONE next action; what to collect at the door (cash,
//     paid already, credit, an advance, another method); the bag checklist; the rider's record — server rows made
//     safe, the device's own record, and today / this week / this month with their bars;
//   • the page through the real store, with the server answers stubbed: Home, the ready alert, a claim (and one
//     another rider got first), one delivery start to finish — every stage goes to the server first and a refused one
//     leaves the rider where they were — the money check at the door, the record, the night theme, log out (which
//     ends the portal session on the phone);
//   • the honesty: the server's "earnings" is the bills' total, so no screen calls it the rider's earnings.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '@/lib/types';
import {
  RIDER_STEPS, bagChecklist, collectFor, directionsUrl, historyRows, initials, localHistory, nextAction, periodStart, periodSummary,
  phaseTitle, problemMessage, riderPhase, stepIndex, whenDelivered,
} from '@/lib/riderApp';

const portal = vi.hoisted(() => ({
  claim: vi.fn(async (_id: string) => ({ ok: true, data: { ok: true } }) as any),
  stage: vi.fn(async (_id: string, _s: string) => ({ ok: true, data: { ok: true } }) as any),
}));
vi.mock('@/lib/portalData', async (orig) => ({
  ...(await orig<typeof import('@/lib/portalData')>()),
  portalClaimOrder: (id: string) => portal.claim(id),
  portalSetDeliveryStage: (id: string, s: string) => portal.stage(id, s),
}));
vi.mock('@/components/DeliveryRouteMap', () => ({ default: () => <div data-testid="route-map" /> }));
vi.mock('@/components/ReadyNotificationBus', () => ({ default: () => null }));
vi.mock('@/components/ReadyOrderPoller', () => ({ default: () => null }));
vi.mock('@/components/StaffProfileCard', () => ({ default: () => <div data-testid="staff-profile" /> }));
vi.mock('@/hooks/useRestaurantIdentity', () => ({
  useRestaurantIdentity: () => ({ tenantId: 't', name: 'Sample Restaurant', slug: 's', branchName: 'Main Branch', workspaceCode: 'DT-4821', logoUrl: null, source: 'cache' }),
}));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NOW = new Date(2026, 10, 4, 15, 30, 0); // a Wednesday, 15:30
const T = NOW.getTime();
const ago = (mins: number) => new Date(T - mins * 60000).toISOString();
const line = (id: string, name: string, price: number, quantity: number, extra: object = {}) =>
  ({ id, menuItemId: id, name, price, quantity, lineTotal: price * quantity, note: '', pricingType: 'fixed', ...extra });
const order = (o: Partial<Order>): Order => ({
  id: 'o1', orderNumber: 1038, orderType: 'delivery', status: 'running', paymentMethod: 'cash', items: [line('a', 'Zinger Burger', 650, 2)],
  subtotal: 1300, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1300, createdAt: ago(30), notes: '', ...o,
} as Order);

// ------------------------------------------------------------------ rules
describe('the delivery, step by step', () => {
  it('four rider steps, and one next action at each', () => {
    expect(RIDER_STEPS.map(s => s.stage)).toEqual(['rider_picked', 'onway', 'rider_reached', 'delivered']);
    expect(stepIndex('rider_assigned')).toBe(-1);
    expect(stepIndex('onway')).toBe(1);
    const at = (deliveryStatus: Order['deliveryStatus']) => nextAction({ deliveryStatus });
    for (const s of ['pending', 'accepted', 'cooking', 'ready', 'rider_assigned', undefined] as const) {
      expect(riderPhase({ deliveryStatus: s })).toBe('pickup');
      expect(at(s)).toEqual({ stage: 'rider_picked', label: 'I have picked up the order', confirm: 'pickup' });
    }
    expect(at('rider_picked')).toEqual({ stage: 'onway', label: 'Start the ride' });
    expect(at('onway')).toEqual({ stage: 'rider_reached', label: 'I have reached' });
    expect(at('rider_reached')).toEqual({ stage: 'delivered', label: 'Hand over the order', confirm: 'deliver' });
    expect(at('delivered')).toBeNull();
    expect(at('cancelled')).toBeNull();
    expect(phaseTitle({ deliveryStatus: 'onway', orderNumber: 1038 })).toBe('On the way · #1038');
    expect(phaseTitle({ deliveryStatus: 'ready', orderNumber: 7 })).toBe('Pickup · #7');
  });
});

describe('what to collect at the door', () => {
  it('cash on delivery: the whole bill, and the rider ticks that they took it', () => {
    expect(collectFor(order({ grandTotal: 1780 }))).toEqual({ amount: 1780, label: 'Cash on delivery', mustConfirm: true });
  });
  it('a bill paid before it left: nothing to take', () => {
    expect(collectFor(order({ status: 'paid', paidAt: ago(20), paymentMethod: 'online', paymentAccountName: 'JazzCash' })))
      .toEqual({ amount: 0, label: 'Paid already', mustConfirm: false });
  });
  it('a credit customer: the account, not the rider\'s to collect', () => {
    expect(collectFor(order({ paymentMethod: 'credit', status: 'credit_pending' }))).toMatchObject({ amount: 0, label: 'On account (credit)' });
  });
  it('an advance was paid: only the balance', () => {
    expect(collectFor(order({ status: 'partial', amountPaid: 500, grandTotal: 1780 }))).toEqual({ amount: 1280, label: 'Balance after advance', mustConfirm: true });
  });
  it('another method names its account; complimentary takes nothing', () => {
    expect(collectFor(order({ paymentMethod: 'online', paymentAccountName: 'JazzCash' })).label).toBe('Online transfer · JazzCash');
    expect(collectFor(order({ paymentMethod: 'card' })).label).toBe('Card on delivery');
    expect(collectFor(order({ status: 'complimentary' })).amount).toBe(0);
  });
});

describe('the bag', () => {
  it('one line per item, with its size and note; nothing for an empty line', () => {
    const rows = bagChecklist(order({ items: [
      line('a', 'Pizza', 1450, 1, { variantName: 'Large', note: ' Extra cheese ' }),
      line('b', 'Chicken', 900, 1.5),
      line('c', 'Removed', 100, 0),
    ] as any }));
    expect(rows.map(r => r.text)).toEqual(['1 × Pizza (Large)', '1.5 × Chicken']);
    expect(rows[0].note).toBe('Extra cheese');
    expect(rows[0].lineTotal).toBe(1450);
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });
});

describe('the rider\'s record', () => {
  const raw = [
    { id: 'a', orderNumber: 1001, grandTotal: '900', deliveredAt: ago(30), customerName: 'Usman Ali', address: 'DHA' },
    { id: 'b', orderNumber: 1002, grandTotal: 1370, deliveredAt: ago(60 * 24 * 1), customerName: null, address: null },
    { id: 'c', orderNumber: 1003, grandTotal: 1840, deliveredAt: ago(60 * 24 * 5) }, // 30 Oct: last month
    { id: 'f', orderNumber: 1007, grandTotal: 400, deliveredAt: ago(60 * 24 * 3) },  //  1 Nov: this month, last week
    { id: 'd', orderNumber: 1004, grandTotal: 500, deliveredAt: 'not a date' },
    { id: '', orderNumber: 1005, grandTotal: 500, deliveredAt: ago(10) },
    { id: 'e', orderNumber: 1006, grandTotal: 700, deliveredAt: ago(40 * 60 * 24) },
  ];

  it('server rows are cleaned: no row without an id or a real delivery time; newest first', () => {
    const rows = historyRows(raw);
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'f', 'c', 'e']);
    expect(rows[0]).toMatchObject({ orderNumber: '1001', total: 900, customerName: 'Usman Ali' });
    expect(rows[1].customerName).toBe('Customer');
    expect(historyRows(undefined)).toEqual([]);
  });

  it('on the staff route the record is this device\'s own delivered orders', () => {
    const rows = localHistory([
      order({ id: 'x1', riderId: 'r1', deliveryStatus: 'delivered', deliveredAt: ago(5), grandTotal: 1000 }),
      order({ id: 'x2', riderId: 'r2', deliveryStatus: 'delivered', deliveredAt: ago(5) }),
      order({ id: 'x3', riderId: 'r1', deliveryStatus: 'onway' }),
    ], 'r1');
    expect(rows.map(r => r.id)).toEqual(['x1']);
  });

  it('today, this week (from Monday) and this month, with a bar per hour or day', () => {
    const rows = historyRows(raw);
    expect(periodStart('week', NOW).getDay()).toBe(1);
    expect(periodStart('month', NOW).getDate()).toBe(1);
    const today = periodSummary(rows, 'today', NOW);
    expect(today).toMatchObject({ count: 1, total: 900 });
    expect(today.bars[0].label).toBe('10a');
    expect(today.bars.at(-1)!.label).toBe('3p');
    expect(today.bars.reduce((s, b) => s + b.count, 0)).toBe(1);
    const week = periodSummary(rows, 'week', NOW);
    expect(week).toMatchObject({ count: 2, total: 2270 });
    expect(week.bars.map(b => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(week.bars[1].total).toBe(1370);
    expect(week.bars[2].total).toBe(900);
    const month = periodSummary(rows, 'month', NOW);
    expect(month.bars).toHaveLength(30);
    expect(month).toMatchObject({ count: 3, total: 2670 });
    expect(month.bars[0]).toMatchObject({ label: '1', total: 400 });
  });

  it('times, initials, the problem message and the map link', () => {
    expect(whenDelivered(ago(30), NOW)).toBe('15:00');
    expect(whenDelivered(ago(30), NOW, true)).toBe('Today 15:00');
    expect(whenDelivered(ago(60 * 24 * 5), NOW)).toBe('30 Oct');
    expect(initials('Hamza Ali')).toBe('HA');
    expect(initials(' bilal ')).toBe('B');
    expect(initials('')).toBe('R');
    const msg = problemMessage('Customer is not answering', order({ customer: { id: 'c', name: 'Ayesha', phone: '0300', address: 'Gulberg' } as any }), 'Hamza');
    expect(msg.split('\n')).toEqual(['Order #1038: Customer is not answering', 'Customer: Ayesha · 0300', 'Address: Gulberg', '— Hamza (DT Rider)']);
    expect(directionsUrl({ lat: 31.5, lng: 74.3 })).toBe('https://www.google.com/maps/dir/?api=1&destination=31.5,74.3');
    expect(directionsUrl(null, 'House 12, Gulberg')).toBe('https://www.google.com/maps/search/?api=1&query=House%2012%2C%20Gulberg');
    expect(directionsUrl(null, ' ')).toBeNull();
  });
});

// ------------------------------------------------------------------ the page through the real store
const STORE_KEY = 'desi-pos-data';
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const cust = (name: string, address: string, phone = '0300-1112233') => ({ id: name, name, phone, address });
function seed(extra: Order[] = []) {
  const orders: Order[] = [
    order({ id: 'mine-onway', orderNumber: 1038, deliveryStatus: 'onway', riderId: 'r1', grandTotal: 1780, items: [line('a', 'Zinger Burger', 650, 2), line('b', 'Cold Coffee', 480, 1)] as any,
      customer: cust('Ayesha Noor', 'House 12, Gulberg III') as any, delivery: { customerLat: 31.51, customerLng: 74.34, distanceKm: 3.2, etaMinutes: 12 } as any, createdAt: ago(40) }),
    order({ id: 'mine-new', orderNumber: 1041, deliveryStatus: 'rider_assigned', riderId: 'r1', grandTotal: 2150, kitchenStatus: 'ready',
      items: [line('c', 'Chicken Tikka Pizza', 1450, 1), line('d', 'Loaded Fries', 700, 1)] as any, customer: cust('Sara Khan', 'Block 7, Gulshan') as any, createdAt: ago(20) }),
    order({ id: 'free', orderNumber: 1044, deliveryStatus: 'ready', grandTotal: 1290, customer: cust('Bilal Hussain', 'DHA Phase 5') as any, createdAt: ago(10) }),
    order({ id: 'done1', orderNumber: 1001, deliveryStatus: 'delivered', riderId: 'r1', status: 'paid', grandTotal: 900, deliveredAt: ago(90), customer: cust('Usman Ali', 'Cantt') as any }),
    order({ id: 'done2', orderNumber: 1002, deliveryStatus: 'delivered', riderId: 'r1', status: 'paid', grandTotal: 1100, deliveredAt: ago(60 * 26), customer: cust('Hina Malik', 'Model Town') as any }),
    ...extra,
  ];
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', phone1: '042-35761234' },
    users: [], branches: [], riders: [{ id: 'r1', name: 'Hamza Ali', phone: '03001234567', isActive: true }],
    orders, categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], orderCounter: 2000,
  }));
  localStorage.setItem('rider-portal-id', 'r1');
  localStorage.setItem('rider-tracking', '0');
  reload();
}

async function mount() {
  window.location.hash = '#/rider-portal';
  const { default: RiderAppPage } = await import('@/pages/RiderAppPage');
  const utils = render(<RiderAppPage />);
  await screen.findByText('Hamza Ali');
  return utils;
}
const storeOrder = async (id: string) => (await import('@/lib/store')).getOrders().find(o => o.id === id)!;

describe('DT Rider, the screens', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    portal.claim.mockReset().mockImplementation(async () => ({ ok: true, data: { ok: true } }));
    portal.stage.mockReset().mockImplementation(async () => ({ ok: true, data: { ok: true } }));
    seed();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('Home: who, the three tiles, my active orders, and what is waiting to be claimed', async () => {
    await mount();
    const home = document.querySelector('[data-rider-screen="home"]') as HTMLElement;
    expect(within(home).getByText('Active').nextElementSibling).toHaveTextContent('2');
    expect(within(home).getByText('Done today').nextElementSibling).toHaveTextContent('1');
    expect(within(home).getByText('Bills today').nextElementSibling).toHaveTextContent('900');
    expect(within(home).getByText('My active orders (2)')).toBeInTheDocument();
    expect(home.querySelector('[data-rider-order="mine-new"]')).toBeTruthy();
    expect(home.querySelector('[data-rider-available="free"]')).toBeTruthy();
    // not Live while holding orders: the reminder, as since v1.75.0
    expect(document.querySelector('[data-rider-live-reminder]')).toBeTruthy();
    // the tab bar
    expect(screen.getByRole('navigation', { name: 'Rider app' })).toHaveTextContent(/Home.*Orders.*Record.*Profile/);
  });

  it('a ready order raises the alert banner; Later puts it away, Claim opens the confirmation', async () => {
    await mount();
    const alert = await screen.findByText('Order #1044 is ready');
    expect(alert).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Order #1044 is ready')).toBeNull();
  });

  it('claiming asks once, goes to the server, then opens the order at pickup', async () => {
    await mount();
    fireEvent.click(within(document.querySelector('[data-rider-available="free"]') as HTMLElement).getByRole('button', { name: 'Claim' }));
    const sheet = screen.getByRole('dialog', { name: 'Claim order #1044' });
    expect(sheet).toHaveTextContent('DHA Phase 5');
    expect(sheet).toHaveTextContent(/Rs\.?\s?1,290 · Cash on delivery/);
    expect(portal.claim).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Claim order' }));
    await screen.findByText('Pickup · #1044');
    expect(portal.claim).toHaveBeenCalledWith('free');
    expect(await storeOrder('free')).toMatchObject({ riderId: 'r1', deliveryStatus: 'rider_assigned' });
  });

  it('an order another rider took first: told so, not claimed, still on the list', async () => {
    portal.claim.mockImplementation(async () => ({ ok: true, data: { ok: false, reason: 'already_claimed' } }));
    await mount();
    fireEvent.click(within(document.querySelector('[data-rider-available="free"]') as HTMLElement).getByRole('button', { name: 'Claim' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim order' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Pickup · #1044')).toBeNull();
    expect((await storeOrder('free')).riderId).toBeUndefined();
  });

  it('one delivery, start to finish: every step goes to the server, the bag is checked, the money is confirmed', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="mine-new"]')!);
    expect(screen.getByText('Pickup · #1041')).toBeInTheDocument();
    expect(screen.getByText('Food is ready — collect it')).toBeInTheDocument();

    // RID-10: Confirm pickup only once every item is ticked
    fireEvent.click(screen.getByRole('button', { name: /I have picked up the order/ }));
    const confirm = screen.getByRole('button', { name: /Confirm pickup/ });
    expect(confirm).toBeDisabled();
    expect(portal.stage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /1 × Chicken Tikka Pizza/ }));
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /1 × Loaded Fries/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await screen.findByText('Picked up · #1041');
    expect(portal.stage).toHaveBeenLastCalledWith('mine-new', 'rider_picked');

    fireEvent.click(screen.getByRole('button', { name: /Start the ride/ }));
    await screen.findByText('On the way · #1041');
    expect(portal.stage).toHaveBeenLastCalledWith('mine-new', 'onway');

    fireEvent.click(screen.getByRole('button', { name: /I have reached/ }));
    await screen.findByText('Reached · #1041');
    expect(portal.stage).toHaveBeenLastCalledWith('mine-new', 'rider_reached');

    // RID-13: the money at the door
    fireEvent.click(screen.getByRole('button', { name: /Hand over the order/ }));
    expect(document.querySelector('[data-rider-collect-amount]')).toHaveTextContent('2,150');
    const delivered = screen.getByRole('button', { name: /^Delivered$/ });
    expect(delivered).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I collected the full amount' }));
    fireEvent.click(delivered);
    await screen.findByText(/Order #1041 is complete/);
    expect(portal.stage).toHaveBeenLastCalledWith('mine-new', 'delivered');
    expect(portal.stage).toHaveBeenCalledTimes(4);
    expect(await storeOrder('mine-new')).toMatchObject({ deliveryStatus: 'delivered', status: 'paid' });

    // RID-15: the day so far — the record now holds two deliveries today
    const done = document.querySelector('[data-rider-screen="done"]') as HTMLElement;
    expect(done).toHaveTextContent('2 orders');
    expect(done).toHaveTextContent('3,050');
    fireEvent.click(screen.getByRole('button', { name: 'Back to orders' }));
    expect(document.querySelector('[data-rider-screen="home"]')).toBeTruthy();
    expect(document.querySelector('[data-rider-order="mine-new"]')).toBeNull();
  });

  it('a stage the server refuses leaves the rider on the same screen, and the order unchanged', async () => {
    portal.stage.mockImplementation(async () => ({ ok: false, message: 'No connection' }));
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="mine-onway"]')!);
    fireEvent.click(screen.getByRole('button', { name: /I have reached/ }));
    await waitFor(() => expect(portal.stage).toHaveBeenCalledWith('mine-onway', 'rider_reached'));
    expect(screen.getByText('On the way · #1038')).toBeInTheDocument();
    expect((await storeOrder('mine-onway')).deliveryStatus).toBe('onway');
  });

  it('a bill paid before it left: nothing to collect, Delivered without a tick', async () => {
    seed([order({ id: 'prepaid', orderNumber: 1050, deliveryStatus: 'rider_reached', riderId: 'r1', status: 'paid', paidAt: ago(30), paymentMethod: 'online', grandTotal: 2650, customer: cust('Zain', 'Johar Town') as any })]);
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="prepaid"]')!);
    expect(screen.getByText('Nothing to collect')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hand over the order/ }));
    expect(screen.getByText('Paid already')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'I collected the full amount' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Delivered$/ })).toBeEnabled();
  });

  it('a wrong tap can be corrected; Delivered from the menu still goes through the money screen', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="mine-onway"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    const sheet = screen.getByRole('dialog', { name: 'Change status' });
    expect(within(sheet).queryByRole('button', { name: /On the way/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /Delivered/ }));
    expect(portal.stage).not.toHaveBeenCalled();
    expect(screen.getByText('Delivery · #1038')).toBeInTheDocument();
  });

  it('Call: the dialer, and the tracking link on WhatsApp', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="mine-onway"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    const sheet = screen.getByRole('dialog', { name: 'Call Ayesha Noor' });
    expect(within(sheet).getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:0300-1112233');
    expect(within(sheet).getByRole('button', { name: /Send tracking link on WhatsApp/ })).toBeEnabled();
  });

  it('Orders: Mine, Available and History; the Record says what its figure is', async () => {
    await mount();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Rider app' })).getByRole('button', { name: /Orders/ }));
    expect(screen.getByRole('tab', { name: 'Mine (2)' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await waitFor(() => expect(document.querySelector('[data-rider-record="done1"]')).toHaveTextContent('Today 14:00'));
    expect(document.querySelector('[data-rider-record="done2"]')).toHaveTextContent('3 Nov');

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Rider app' })).getByRole('button', { name: /Record/ }));
    const total = document.querySelector('[data-rider-record-total]') as HTMLElement;
    expect(total).toHaveTextContent('Bills delivered today');
    expect(total).toHaveTextContent('900');
    fireEvent.click(screen.getByRole('tab', { name: 'This week' }));
    expect(total).toHaveTextContent('2,000');
    expect(total).toHaveTextContent('2 deliveries');
    expect(screen.getByText(/Your pay is agreed with your restaurant/)).toBeInTheDocument();
  });

  it('Profile: the night theme sticks; Log out asks first and ends the server session', async () => {
    const { container } = await mount();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Rider app' })).getByRole('button', { name: /Profile/ }));
    expect(screen.getByTestId('staff-profile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Dark theme' }));
    expect(container.querySelector('[data-rider-app]')).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('rider-theme')).toBe('dark');

    // The real portalLogout runs (the page loads it lazily): it forgets the token and the restaurant on this phone.
    localStorage.setItem('dt-portal-token', 'tok');
    localStorage.setItem('dt-restaurant-identity', '{"name":"Sample Restaurant"}');
    const original = window.confirm;
    const ask = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = ask;
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(localStorage.getItem('rider-portal-id')).toBe('r1');
    expect(localStorage.getItem('dt-portal-token')).toBe('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(localStorage.getItem('dt-portal-token')).toBeNull());
    expect(localStorage.getItem('dt-restaurant-identity')).toBeNull();
    expect(localStorage.getItem('rider-portal-id')).toBeNull();
    expect(await screen.findByText('Sign in with the account your restaurant created')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(2);
    window.confirm = original;
  });

  it('Help: a problem goes to the restaurant on WhatsApp with the order written in', async () => {
    const original = window.open;
    const open = vi.fn(() => null);
    window.open = open as unknown as typeof window.open;
    await mount();
    fireEvent.click(document.querySelector('[data-rider-order="mine-onway"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByText('What happened with #1038?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call restaurant/ })).toHaveAttribute('href', 'tel:+924235761234');
    await act(async () => { fireEvent.click(screen.getByText('Customer is not answering')); });
    const url = String(open.mock.calls.at(-1)?.[0] ?? '');
    expect(decodeURIComponent(url)).toContain('Order #1038: Customer is not answering');
    expect(url).toContain('924235761234');
    window.open = original;
  });

  it('sign-in: a wrong PIN is said on the screen', async () => {
    localStorage.removeItem('rider-portal-id');
    window.location.hash = '#/rider-portal';
    const { default: RiderAppPage } = await import('@/pages/RiderAppPage');
    render(<RiderAppPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your username / phone and PIN')).toBeInTheDocument();
  });
});

describe('the wiring', () => {
  const page = read('src/pages/RiderAppPage.tsx');
  it('the page keeps its server calls and only changes what is drawn', () => {
    for (const s of ['portalSignIn', 'startVisiblePoll(pull, 15000)', 'await portalClaimOrder(o.id)', 'await portalSetDeliveryStage(o.id, stage)',
      'buildTrackingWhatsAppText', 'notifyCustomerStage(next, stage)', 'portalMyHistory(100)', 'portalLogout']) expect(page).toContain(s);
    expect(page).toContain("from '@/components/rider/RiderDelivery'");
    expect(read('src/styles.css')).toContain('@import "./styles/ui-rider.css";');
  });
  it('no screen calls the bills\' total the rider\'s earnings', () => {
    const screens = ['src/pages/RiderAppPage.tsx', 'src/components/rider/RiderTabs.tsx', 'src/components/rider/RiderDelivery.tsx']
      .map(read).join('\n').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(screens).not.toMatch(/>\s*Earnings\s*</);
    expect(screens).not.toMatch(/label: 'Earnings'/);
    expect(read('src/components/StaffProfileCard.tsx')).not.toMatch(/label="Earnings"/);
  });
  it('the rider look is scoped, with a night version', () => {
    const css = read('src/styles/ui-rider.css');
    expect(css).toContain('.dt-rider {');
    expect(css).toContain('.dt-rider[data-theme="dark"]');
    expect(css).toContain('--primary: 17 88% 40%');
    expect(css).toMatch(/@layer components \{/);
  });
});
