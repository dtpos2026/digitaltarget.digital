// ============================================================
// v1.138.0 — the Delivery board as the design draws it (SW-08): "7 active · 2 riders online", a Board | Map switch and Rider list, the rider
// strip ("Ali · 1 order", "Kamran · offline"), five lanes — Pending · Cooking · Ready · Rider assigned · On the way — of cards with ONE button
// (Advance, or Assign rider once it is ready); Delivered and Cancelled behind a toggle.
// Also pinned: every delivery status lands in a lane (the old board lost an order a rider had been given, one only accepted, and one picked up).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders } from '@/lib/store';
import {
  ACTIVE_COLUMNS, advanceFor, boardSubtitle, columnStatus, deliveryColumn, DELIVERY_COLUMNS, isActiveDelivery, placeLabel, riderStrip, shortName,
} from '@/lib/deliveryBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/AutoKotPrinter', () => ({ triggerAutoKot: vi.fn(), default: () => null }));
vi.mock('@/lib/printQueue', async (orig) => ({ ...(await orig<typeof import('@/lib/printQueue')>()), enqueuePrint: vi.fn() }));
vi.mock('@/components/OrderTrackingDialog', () => ({ default: ({ orderId }: { orderId: string | null }) => (orderId ? <div data-testid="tracking-open">{orderId}</div> : null) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('the rules', () => {
  it('every delivery status lands in exactly one lane', () => {
    expect(deliveryColumn(undefined)).toBe('pending');
    expect(deliveryColumn('pending')).toBe('pending');
    expect(deliveryColumn('accepted')).toBe('pending');            // an accepted online order still waits for the kitchen
    expect(deliveryColumn('cooking')).toBe('cooking');
    expect(deliveryColumn('ready')).toBe('ready');
    expect(deliveryColumn('rider_assigned')).toBe('assigned');
    expect(deliveryColumn('rider_picked')).toBe('onway');
    expect(deliveryColumn('onway')).toBe('onway');
    expect(deliveryColumn('rider_reached')).toBe('onway');
    expect(deliveryColumn('delivered')).toBe('delivered');
    expect(deliveryColumn('cancelled')).toBe('cancelled');
  });

  it('the lanes, in the design\'s order; a card moved to a lane takes that lane\'s status', () => {
    expect(DELIVERY_COLUMNS.map(c => c.label)).toEqual(['Pending', 'Cooking', 'Ready', 'Rider assigned', 'On the way', 'Delivered', 'Cancelled']);
    expect(ACTIVE_COLUMNS).toEqual(['pending', 'cooking', 'ready', 'assigned', 'onway']);
    expect(columnStatus('assigned')).toBe('rider_assigned');
    expect(columnStatus('onway')).toBe('onway');
    expect(isActiveDelivery({ deliveryStatus: 'rider_picked' })).toBe(true);
    expect(isActiveDelivery({ deliveryStatus: 'delivered' })).toBe(false);
    expect(isActiveDelivery({ deliveryStatus: 'cancelled' })).toBe(false);
  });

  it('one button: Advance, then Assign rider; past that the rider\'s own app moves it', () => {
    expect(advanceFor('pending')).toEqual({ kind: 'status', label: 'Advance', to: 'cooking' });
    expect(advanceFor('cooking')).toEqual({ kind: 'status', label: 'Advance', to: 'ready' });
    expect(advanceFor('ready')).toEqual({ kind: 'assign', label: 'Assign rider' });
    expect(advanceFor('assigned')).toBeNull();
    expect(advanceFor('onway')).toBeNull();
    expect(advanceFor('delivered')).toBeNull();
  });

  it('the subtitle and the rider strip', () => {
    expect(boardSubtitle(7, 2)).toBe('7 active · 2 riders online');
    expect(boardSubtitle(1, 1)).toBe('1 active · 1 rider online');
    const riders = [{ id: 'a', name: 'Ali', isActive: true }, { id: 'h', name: 'Hamza', isActive: true }, { id: 'k', name: 'Kamran', isActive: true }, { id: 'z', name: 'Gone', isActive: false }, { id: 'f', name: 'Faraz', isActive: true }];
    const orders = [
      { riderId: 'a', deliveryStatus: 'onway' as const }, { riderId: 'h', deliveryStatus: 'rider_assigned' as const }, { riderId: 'h', deliveryStatus: 'rider_picked' as const },
      { riderId: 'h', deliveryStatus: 'delivered' as const }, { riderId: 'k', deliveryStatus: 'rider_assigned' as const },
    ];
    const strip = riderStrip(riders, orders, id => id !== 'k');
    expect(strip.map(c => c.label)).toEqual(['Hamza · 2 orders', 'Ali · 1 order', 'Faraz · free', 'Kamran · offline']);   // a delivered order is not "on" a rider; inactive riders are not shown
  });

  it('who and where, as the card shows them', () => {
    expect(shortName('Sara Khan')).toBe('Sara K.');
    expect(shortName('Sara Bano Khan')).toBe('Sara K.');
    expect(shortName('Zain')).toBe('Zain');
    expect(shortName('')).toBe('Customer');
    expect(placeLabel({ customer: { area: 'Gulberg', address: 'x' }, delivery: { distanceFromRestaurantKm: 2.44 } } as any)).toBe('Gulberg · 2.4 km');
    expect(placeLabel({ customer: { address: '12 Model Town, Lahore' }, delivery: undefined } as any)).toBe('12 Model Town');
    expect(placeLabel({ customer: { area: 'Johar Town' }, delivery: { distanceKm: 4 } } as any)).toBe('Johar Town · 4.0 km');
    expect(placeLabel({ customer: undefined, delivery: undefined } as any)).toBe('');
  });
});

function seed() {
  const order = (n: number, ds: string, name: string, area: string, km: number, total: number, rider?: { id: string; name: string }, extra: Record<string, unknown> = {}) => ({
    id: `d${n}`, orderNumber: n, orderType: 'delivery', status: 'running', source: 'website', deliveryStatus: ds,
    items: [{ id: `i${n}`, menuItemId: 'm1', name: 'Zinger Burger', pricingType: 'fixed', price: total, quantity: 1, lineTotal: total, note: '' }],
    subtotal: total, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: total, notes: '', payments: [], amountPaid: 0, createdAt: ago(20 * 60000),
    customer: { id: `c${n}`, name, phone: `0300111${n}`, address: `${area} road`, area }, delivery: { distanceFromRestaurantKm: km },
    riderId: rider?.id, riderName: rider?.name, ...extra,
  });
  const ali = { id: 'r1', name: 'Ali' };
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', autoPrintRiderSlip: false, autoKotOnDeliveryRunning: false },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [{ id: 'm1', name: 'Zinger Burger', price: 650, categoryId: 'c1', pricingType: 'fixed', isActive: true }],
    riders: [
      { id: 'r1', name: 'Ali', phone: '0300', isActive: true, lastSeenAt: ago(20_000) },
      { id: 'r2', name: 'Hamza', phone: '0301', isActive: true, lastSeenAt: ago(60_000) },
      { id: 'r3', name: 'Kamran', phone: '0302', isActive: true, lastSeenAt: ago(3_600_000) },
    ],
    orders: [
      order(1043, 'pending', 'Sara Khan', 'Gulberg', 2.4, 2150),
      order(1044, 'accepted', 'Noman Tariq', 'Bahria', 9.1, 700),
      order(1041, 'cooking', 'Ayesha Noor', 'DHA', 5.1, 1780),
      order(1039, 'ready', 'Fatima Iqbal', 'Johar Town', 4, 2650),
      order(1037, 'rider_assigned', 'Usman Ali', 'Garden Town', 1.9, 1290, ali),
      order(1035, 'onway', 'Hina Malik', 'Cantt', 6.8, 3120, ali),
      order(1034, 'rider_picked', 'Omer Farooq', 'Askari', 3, 990, ali),
      order(1030, 'delivered', 'Bilal Raza', 'Iqbal Town', 2, 800, ali),
      { ...order(1028, 'cancelled', 'Mehwish', 'Wapda', 3, 500), status: 'cancelled' },
    ],
    tables: [], floors: [], kitchens: [], waiters: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}

const mount = async () => { const { default: Page } = await import('@/pages/DeliveryBoardPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const lane = (k: string) => document.querySelector(`[data-dl-lane="${k}"]`) as HTMLElement;
const saved = (id: string) => getOrders().find(o => o.id === id)!;
const cardOf = (l: string, num: number) => within(lane(l)).getByText(`#${num}`).closest('[data-dl-card]') as HTMLElement;

describe('the board under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/delivery'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the header: the title, "N active · M riders online", Board | Map and Rider list', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Delivery board');
    expect(document.querySelector('[data-dl-subtitle]')!.textContent).toBe('7 active · 2 riders online');
    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rider list/ })).toBeInTheDocument();
  });

  it('the rider strip says how many each rider has, and who is offline', async () => {
    await mount();
    const strip = document.querySelector('[data-dl-strip]') as HTMLElement;
    expect(within(strip).getByText('Ali · 3 orders')).toBeInTheDocument();
    expect(within(strip).getByText('Hamza · free')).toBeInTheDocument();
    expect(within(strip).getByText('Kamran · offline')).toBeInTheDocument();
  });

  it('five lanes with their counts — every active order is in one, and the finished ones are hidden', async () => {
    await mount();
    expect(['pending', 'cooking', 'ready', 'assigned', 'onway'].map(k => lane(k).querySelector('.dl-count')!.textContent)).toEqual(['2', '1', '1', '1', '2']);
    expect(lane('delivered')).toBeNull();
    expect(lane('cancelled')).toBeNull();
    expect(within(lane('pending')).getByText('#1044')).toBeInTheDocument();        // accepted → still Pending
    expect(within(lane('onway')).getByText('#1034')).toBeInTheDocument();          // picked up → On the way
    expect(within(lane('assigned')).getByText('#1037')).toBeInTheDocument();       // a rider has it → Rider assigned (the old board lost it)
  });

  it('a card: the order and total, who, where and how far', async () => {
    await mount();
    const c = cardOf('pending', 1043);
    expect(c.textContent).toContain('Rs 2,150');
    expect(c.textContent).toContain('Sara K.');
    expect(c.textContent).toContain('Gulberg · 2.4 km');
    expect(within(cardOf('assigned', 1037)).getByText('Ali')).toBeInTheDocument();   // the rider chip
  });

  it('Show delivered & cancelled brings the two history lanes', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Show delivered & cancelled \(2\)/ }));
    expect(within(lane('delivered')).getByText('#1030')).toBeInTheDocument();
    expect(within(lane('cancelled')).getByText('#1028')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide delivered & cancelled/ }));
    expect(lane('delivered')).toBeNull();
  });

  it('Advance moves a card Pending → Cooking → Ready, and saves it', async () => {
    await mount();
    fireEvent.click(within(cardOf('pending', 1043)).getByRole('button', { name: 'Advance' }));
    expect(saved('d1043').deliveryStatus).toBe('cooking');
    expect(within(lane('cooking')).getByText('#1043')).toBeInTheDocument();
    fireEvent.click(within(cardOf('cooking', 1043)).getByRole('button', { name: 'Advance' }));
    expect(saved('d1043').deliveryStatus).toBe('ready');
    expect(saved('d1043').kitchenStatus).toBe('ready');
    expect(within(lane('ready')).getByText('#1043')).toBeInTheDocument();
  });

  it('a Ready card has Assign rider: pick a rider and it moves to Rider assigned with that rider\'s chip', async () => {
    await mount();
    expect(within(cardOf('ready', 1039)).queryByRole('button', { name: 'Advance' })).toBeNull();
    fireEvent.click(within(cardOf('ready', 1039)).getByRole('button', { name: 'Assign rider' }));
    const hamza = await screen.findByRole('button', { name: /Hamza/ });
    fireEvent.click(hamza);
    expect(saved('d1039').deliveryStatus).toBe('rider_assigned');
    expect(saved('d1039').riderId).toBe('r2');
    expect(saved('d1039').riderName).toBe('Hamza');
    expect(within(cardOf('assigned', 1039)).getByText('Hamza')).toBeInTheDocument();
    expect(within(document.querySelector('[data-dl-strip]') as HTMLElement).getByText('Hamza · 1 order')).toBeInTheDocument();
  });

  it('the ⋯ menu keeps what the old card had: call, WhatsApp, tracking link, live tracking, move by hand, cancel', async () => {
    await mount();
    fireEvent.click(within(cardOf('pending', 1043)).getByRole('button', { name: /More for order 1043/ }));
    expect(await screen.findByRole('link', { name: /Call customer/ })).toHaveAttribute('href', 'tel:03001111043');
    expect(screen.getByRole('button', { name: /Send status on WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send tracking link/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Live tracking/ }));
    expect(await screen.findByTestId('tracking-open')).toHaveTextContent('d1043');
  });

  it('Move to puts a card in another lane by hand; Cancel order cancels it', async () => {
    await mount();
    fireEvent.click(within(cardOf('cooking', 1041)).getByRole('button', { name: /More for order 1041/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'On the way' }));
    expect(saved('d1041').deliveryStatus).toBe('onway');
    expect(within(lane('onway')).getByText('#1041')).toBeInTheDocument();

    fireEvent.click(within(cardOf('pending', 1043)).getByRole('button', { name: /More for order 1043/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cancel order/ }));
    expect(saved('d1043').deliveryStatus).toBe('cancelled');
    expect(lane('pending').textContent).not.toContain('#1043');
  });

  it('Map goes to the live riders map and Rider list to the riders', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(window.location.hash).toBe('#/live-riders');
    fireEvent.click(screen.getByRole('button', { name: /Rider list/ }));
    expect(window.location.hash).toBe('#/riders');
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/delivery'; seed(); });
  afterEach(() => cleanup());
  it('keeps the old columns — and now has the lane an assigned order was missing', async () => {
    setUiStyle('modern'); setTheme('ember');
    const { container } = await mount();
    expect(document.querySelector('[data-dl-board]')).toBeNull();
    const heads = [...container.querySelectorAll('[data-board-col-head]')];
    expect(heads.map(h => h.getAttribute('data-col'))).toEqual(['pending', 'cooking', 'ready', 'rider_assigned', 'onway', 'delivered', 'cancelled']);
    const count = (col: string) => heads.find(h => h.getAttribute('data-col') === col)!.textContent;
    expect(count('rider_assigned')).toContain('1');
    expect(count('pending')).toContain('2');            // accepted joins pending
    expect(count('onway')).toContain('2');              // picked up joins dispatched
  });
});

describe('the stylesheet and the page', () => {
  const css = read('src/styles/ui-refined-delivery.css');
  it('is imported and every rule is scoped to DT Refined', () => {
    expect(read('src/styles.css')).toContain('ui-refined-delivery.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
  it('the old board still opens the tracking dialog and follows the store (v1.75.0), and still sends the tracking link', () => {
    const page = read('src/pages/DeliveryBoardPage.tsx');
    expect(page).toMatch(/data-track-order=\{order\.id\}/);
    expect(page).toMatch(/<OrderTrackingDialog orderId=\{trackingId\}/);
    expect(page).toContain('buildTrackingWhatsAppText');
  });
});
