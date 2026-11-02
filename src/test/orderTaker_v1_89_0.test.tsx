// ============================================================
// v1.89.0 — DT Order Taker, the design package's order-taker screens (design-project/05b-order-taker-app).
//
// What is pinned:
//   • sign-in in the app's look, with its errors on the screen (OTK-02); the offline sign-in still works;
//   • the shell: the top bar says who, which restaurant and its code, location sharing and log out; the tabs sit at
//     the thumb (POS · Tables · Bills · Me) and move between the cashier's own screens (OTK-03);
//   • the connection and the upload queue said at the top: offline, sending, stuck with Retry (OTK-13);
//   • Me: the restaurant, the profile, location sharing, the dark theme that sticks (OTK-12, OTK-14), and a log out
//     that asks first and ends the portal session on the phone;
//   • the wiring: the bootstrap, printers, alerts and service calls unchanged; the shared phone-app kit; the teal.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter, Route, Routes } from '@/lib/hash-router';

const dead = vi.hoisted(() => ({ count: 0, requeue: vi.fn(async (_id: string) => true) }));
vi.mock('@/lib/deferredSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/deferredSync')>()),
  deferredDeadLetterCount: () => dead.count,
  getDeadLetterOps: async () => Array.from({ length: dead.count }, (_, i) => ({ id: `op${i}` })),
  requeueDeadLetter: (id: string) => { dead.count = Math.max(0, dead.count - 1); return dead.requeue(id); },
}));
vi.mock('@/pages/POSScreen', () => ({ default: () => <div data-testid="pos-screen">POS screen</div> }));
vi.mock('@/pages/TablesPage', () => ({ default: () => <div data-testid="tables-screen">Tables screen</div> }));
vi.mock('@/pages/RunningBillsPage', () => ({ default: () => <div data-testid="bills-screen">Bills screen</div> }));
vi.mock('@/components/AutoKotPrinter', () => ({ default: () => <div data-testid="kot-printer" /> }));
vi.mock('@/components/AutoReadyTimer', () => ({ default: () => null }));
vi.mock('@/components/ReadyNotificationBus', () => ({ default: () => <div data-testid="ready-bus" /> }));
vi.mock('@/components/ReadyOrderPoller', () => ({ default: ({ types }: { types: string[] }) => <div data-testid="ready-poller" data-types={types.join(',')} /> }));
vi.mock('@/components/ServiceCallNotifier', () => ({ default: () => <div data-testid="service-calls" /> }));
vi.mock('@/components/StaffProfileCard', () => ({ default: () => <div data-testid="staff-profile" /> }));
vi.mock('@/components/PoweredByBrand', () => ({ default: () => <div data-testid="powered-by" /> }));
vi.mock('@/hooks/useRestaurantIdentity', () => ({
  useRestaurantIdentity: () => ({ tenantId: 'demo-tenant-1', name: 'Sample Restaurant', slug: 's', branchName: 'Main Branch', workspaceCode: 'DT-4821', logoUrl: null, source: 'cache' }),
}));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const TID = 'demo-tenant-1';
const taker = { id: 'ot1', name: 'Ali Hassan', username: 'ali', password: '1234', pin: '1234', role: 'order_taker', isActive: true, phone: '03001112233' };

async function seed(signedIn: boolean) {
  const { setTenant } = await import('@/lib/tenant');
  setTenant(TID, 'Sample Restaurant');
  localStorage.setItem(`desi-pos-data:${TID}`, JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ' }, users: [taker],
    categories: [], menuItems: [], tables: [], floors: [], orders: [], kitchens: [], waiters: [], riders: [], orderCounter: 1,
  }));
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: TID } }));
  if (signedIn) localStorage.setItem('pos-order-taker-session', JSON.stringify({ id: taker.id, user: taker }));
}

async function mount(tab = '') {
  window.location.hash = `#/order-taker/${TID}${tab}`;
  const { default: OrderTakerPortalPage } = await import('@/pages/OrderTakerPortalPage');
  const utils = render(
    <HashRouter>
      <Routes><Route path="/order-taker/:tenantId/*" element={<OrderTakerPortalPage />} /></Routes>
    </HashRouter>,
  );
  return utils;
}
const tabBar = () => screen.getByRole('navigation', { name: 'Order Taker' });
const setOnline = (on: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on });
  window.dispatchEvent(new Event(on ? 'online' : 'offline'));
};

describe('DT Order Taker, the screens', () => {
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    dead.count = 0;
    dead.requeue.mockClear();
    setOnline(true);
  });

  it('sign-in says what is wrong on the screen, and the offline sign-in still opens the app', async () => {
    await seed(false);
    await mount();
    const login = await screen.findByRole('button', { name: 'Sign in' });
    expect(document.querySelector('[data-otk-app]')).toHaveAttribute('data-theme', 'light');
    fireEvent.click(login);
    expect(await screen.findByText('Username / phone and PIN are required')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('username or 03xx-xxxxxxx'), { target: { value: '03001112233' } });
    fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // the portal sign-in cannot reach a server here; the device's own roster signs the order taker in
    expect(await screen.findByTestId('pos-screen', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pos-order-taker-session')!).id).toBe('ot1');
  });

  it('the shell: who and where in the top bar, the tabs at the bottom, the cashier\'s screens inside', async () => {
    await seed(true);
    await mount();
    expect(await screen.findByTestId('pos-screen')).toBeInTheDocument();
    const bar = screen.getByRole('banner');
    expect(bar).toHaveTextContent('Order Taker');
    expect(bar).toHaveTextContent('Ali Hassan · Sample Restaurant · DT-4821');
    expect(within(tabBar()).getAllByRole('button').map(b => b.textContent)).toEqual(['POS', 'Tables', 'Bills', 'Me']);
    expect(within(tabBar()).getByRole('button', { name: /POS/ })).toHaveAttribute('aria-current', 'page');
    // the tab bar comes after the screen, at the thumb
    expect(screen.getByTestId('pos-screen').compareDocumentPosition(tabBar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(tabBar()).getByRole('button', { name: /Tables/ }));
    expect(await screen.findByTestId('tables-screen')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Tables');
    fireEvent.click(within(tabBar()).getByRole('button', { name: /Bills/ }));
    expect(await screen.findByTestId('bills-screen')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Running bills');

    // what kept running behind every tab
    expect(screen.getByTestId('kot-printer')).toBeInTheDocument();
    expect(screen.getByTestId('ready-poller')).toHaveAttribute('data-types', 'dine-in');
    expect(screen.getByTestId('service-calls')).toBeInTheDocument();
  });

  it('location sharing from the top bar is the consent switch', async () => {
    await seed(true);
    await mount();
    await screen.findByTestId('pos-screen');
    const pill = screen.getByRole('button', { name: /OFF/ });
    expect(pill).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pill);
    expect(screen.getByRole('button', { name: /ON/ })).toHaveAttribute('aria-pressed', 'true');
    const { hasLocationConsent } = await import('@/lib/staffLocation');
    expect(hasLocationConsent()).toBe(true);
  });

  it('the connection said at the top: offline, then a change stuck with Retry', async () => {
    await seed(true);
    await mount();
    await screen.findByTestId('pos-screen');
    expect(document.querySelector('[data-otk-banners]')).toBeNull();
    act(() => setOnline(false));
    expect(await screen.findByText(/You are offline\. Orders you take are kept on this phone/)).toBeInTheDocument();
    act(() => setOnline(true));
    await waitFor(() => expect(screen.queryByText(/You are offline/)).toBeNull());

    dead.count = 2;
    const { flushDeferredOps } = await import('@/lib/deferredSync');
    await act(async () => { await flushDeferredOps().catch(() => {}); });
    // the banner re-reads the dead letters every 5 s and on every queue change
    await waitFor(() => expect(screen.getByText(/2 changes could not be sent/)).toBeInTheDocument(), { timeout: 6000 });
    fireEvent.click(within(document.querySelector('[data-otk-banners]') as HTMLElement).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dead.requeue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/could not be sent/)).toBeNull());
  }, 15000);

  it('Me: the restaurant, the profile, the dark theme that sticks', async () => {
    await seed(true);
    await mount('/me');
    const me = await screen.findByText('You are taking orders for');
    const card = me.closest('[data-otk-restaurant]') as HTMLElement;
    expect(card).toHaveTextContent('Sample Restaurant');
    expect(card).toHaveTextContent('Main Branch · Workspace DT-4821');
    expect(screen.getByTestId('staff-profile')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Me');

    fireEvent.click(screen.getByRole('switch', { name: 'Dark theme' }));
    expect(document.querySelector('[data-otk-app]')).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('otk-theme')).toBe('dark');
    cleanup();
    await mount('/me');
    await screen.findByText('You are taking orders for');
    expect(document.querySelector('[data-otk-app]')).toHaveAttribute('data-theme', 'dark');
  });

  it('Log out asks first, then ends the session on the phone and the server', async () => {
    await seed(true);
    await mount('/me');
    await screen.findByText('You are taking orders for');
    localStorage.setItem('dt-portal-token', 'tok');
    const original = window.confirm;
    const ask = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    window.confirm = ask;
    // the bar's icon and the Me button are the same action
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Log out' }));
    expect(localStorage.getItem('pos-order-taker-session')).not.toBeNull();
    const [barIcon, meButton] = screen.getAllByRole('button', { name: /Log out/ });
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Log out' })).toBe(barIcon);
    fireEvent.click(meButton);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('pos-order-taker-session')).toBeNull();
    expect(localStorage.getItem('dt-portal-token')).toBeNull();
    window.confirm = original;
  });
});

describe('the wiring', () => {
  const page = read('src/pages/OrderTakerPortalPage.tsx');
  it('the app keeps its bootstrap, printers, alerts and logout', () => {
    for (const s of ['portalBootstrap()', 'adoptPortalRows', 'portalSignIn', 'portalLogout', '<AutoKotPrinter />', '<AutoReadyTimer />',
      '<ReadyNotificationBus />', "<ReadyOrderPoller types={['dine-in']} />", '<ServiceCallNotifier />', 'window.confirm(']) expect(page).toContain(s);
  });
  it('the teal look, light and dark, on the shared phone-app kit', () => {
    expect(read('src/styles.css')).toContain('@import "./styles/ui-otk.css";');
    const otk = read('src/styles/ui-otk.css');
    expect(otk).toContain('--primary: 175 77% 26%');
    expect(otk).toContain('.dt-otk[data-theme="dark"]');
    expect(read('src/styles/ui-rider.css')).toContain(':is(.dt-rider, .dt-otk) [data-rd-card]');
  });
});
