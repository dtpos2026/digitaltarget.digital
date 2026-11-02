// ============================================================
// v1.85.0 — the DT design package, step 1: the DT Refined theme, its shell (sidebar, top bar) and the SW-02 dashboard.
//
// What is pinned:
//   • the theme's colours are the design package's tokens (design-project/01-design-system/tokens.css), in JS and CSS;
//   • it is open to every restaurant (the premium gate leaves it alone) and is a first choice in Settings → Appearance;
//     leaving it for Modern really changes the look;
//   • the sidebar groups every module the user may open in the design's order, remembers open groups, opens the group
//     of the current page, and says honestly whether the till is online and what is waiting to sync;
//   • every dashboard figure is computed from real orders with the same "paid sale" rule as the reports — today
//     against the same weekday last week, split bills divided, credit shown apart, open bills by type, top items by
//     quantity, orders by hour, and only actionable alerts;
//   • the dashboard renders through the real store and the page picks it only for DT Refined (other themes unchanged).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ALL_THEMES, DESIGN_THEMES, REFINED_THEME_ID, findTheme, isRefinedTheme, isRetailTheme, type Triplet,
} from '@/lib/uiThemes';
import { UI_STYLE_KEY, UI_THEME_KEY, getThemeId, getUiStyle, hslToRgb, setTheme, setUiStyle } from '@/lib/uiStyle';
import { enforcePremiumThemeGate } from '@/lib/premiumTheme';
import { GROUP_ORDER, OPEN_GROUPS_KEY, groupPages, initialOpenGroups, readOpenGroups, syncLabel } from '@/lib/refinedNav';
import { PAGES, type PageDef } from '@/lib/permissions';
import {
  attentionItems, compareWindows, dailySales, dashboardCsv, highlightHour, hourLabel, kpisIn, openBills, ordersByHour,
  paymentMix, roundShares, toCsvText, topItemsByQty,
} from '@/lib/refinedDashboard';
import type { MenuItem, Order } from '@/lib/types';

vi.mock('@/components/PlanStatusWidget', () => ({ default: () => null }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const STORE_KEY = 'desi-pos-data';
/** The store keeps what it read in memory; a tenant change drops it, so the next read sees the new seed. */
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

function Router({ children, at = '/' }: { children: ReactNode; at?: string }) {
  window.location.hash = '#' + at;
  return <HashRouter>{children}</HashRouter>;
}

const hexToHsl = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
};
const triplet = (t: Triplet) => { const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number); return { h, s, l }; };
const close = (a: { h: number; s: number; l: number }, b: { h: number; s: number; l: number }) =>
  (Math.abs(a.h - b.h) <= 2 || a.s < 1) && Math.abs(a.s - b.s) <= 1.5 && Math.abs(a.l - b.l) <= 1.5;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent', 'data-look', 'data-ui-mode', 'data-anim', 'style'].forEach(a => document.documentElement.removeAttribute(a));
});

// ------------------------------------------------------------------ the theme
describe('the DT Refined theme is the design package', () => {
  const tokens = read('design-project/01-design-system/tokens.css');
  const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1];
  const t = findTheme(REFINED_THEME_ID);

  it('is registered once, in its own family, after the Modern and DT Retail themes', () => {
    expect(DESIGN_THEMES.map(x => x.id)).toEqual([REFINED_THEME_ID]);
    expect(ALL_THEMES.filter(x => x.id === REFINED_THEME_ID)).toHaveLength(1);
    expect(ALL_THEMES[ALL_THEMES.length - 1].id).toBe(REFINED_THEME_ID);
    expect(t.id).toBe(REFINED_THEME_ID);
    expect(t.family).toBe('design');
    expect(t.name).toBe('DT Refined');
    expect(t.sidebar).toBe('light');
    expect(isRefinedTheme(REFINED_THEME_ID)).toBe(true);
    expect(isRefinedTheme('ember')).toBe(false);
    expect(isRetailTheme(REFINED_THEME_ID)).toBe(false);
  });

  it('its accent is the design accent #5b21b6 and its surfaces are the design tokens', () => {
    expect(token('accent').toLowerCase()).toBe('#5b21b6');
    const [r, g, b] = hslToRgb(t.accent);
    expect(Math.abs(r - 0x5b)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 0x21)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 0xb6)).toBeLessThanOrEqual(3);
    expect(close(triplet(t.surface.background), hexToHsl(token('bg')))).toBe(true);
    expect(close(triplet(t.surface.card), hexToHsl(token('surface')))).toBe(true);
    expect(close(triplet(t.surface.foreground), hexToHsl(token('text')))).toBe(true);
    expect(close(triplet(t.surface.mutedForeground), hexToHsl(token('muted')))).toBe(true);
    expect(close(triplet(t.surface.border), hexToHsl(token('border')))).toBe(true);
    expect(close(triplet(t.surface.muted), hexToHsl(token('accent-tint')))).toBe(true);
  });

  it('ui-tokens.css carries exactly the same surfaces for the theme', () => {
    const css = read('src/styles/ui-tokens.css');
    const block = css.match(/:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]\s*\{([^}]*)\}/)![1];
    const v = (name: string) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))![1].trim();
    expect(v('background')).toBe(t.surface.background);
    expect(v('card')).toBe(t.surface.card);
    expect(v('foreground')).toBe(t.surface.foreground);
    expect(v('muted-foreground')).toBe(t.surface.mutedForeground);
    expect(v('muted')).toBe(t.surface.muted);
    expect(v('border')).toBe(t.surface.border);
  });

  it('ui-refined.css is loaded, scoped to the theme, and uses the design sizes', () => {
    expect(read('src/styles.css')).toMatch(/@import "\.\/styles\/ui-refined\.css";/);
    const css = read('src/styles/ui-refined.css');
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)!.flatMap(s => s.split(/,(?![^(]*\))/)).map(s => s.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const s of selectors) expect(s.startsWith('html[data-ui="modern"][data-ui-theme="dt-refined"]')).toBe(true);
    expect(css).toMatch(/--ui-radius-card:\s*16px/);
    expect(css).toMatch(/--ui-header-h:\s*4rem/);           // 64 px top bar
    expect(css).toMatch(/--ui-sidebar-w:\s*15\.5rem/);      // 248 px sidebar
    expect(css).toMatch(/--ui-sidebar-w-collapsed:\s*4\.5rem/); // 72 px collapsed
    expect(css).toContain('0 0 0 3px hsl(263 69% 42% / .25)'); // the design's focus ring
  });

  it('applying it sets the Modern attributes with the theme id, and Classic removes them', () => {
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
    const root = document.documentElement;
    expect(root.getAttribute('data-ui')).toBe('modern');
    expect(root.getAttribute('data-ui-theme')).toBe(REFINED_THEME_ID);
    expect(root.getAttribute('data-sidebar')).toBe('light');
    expect(root.hasAttribute('data-look')).toBe(false); // not the DT Retail rules
    setUiStyle('classic');
    expect(root.hasAttribute('data-ui')).toBe(false);
    expect(root.hasAttribute('data-ui-theme')).toBe(false);
  });
});

describe('open to every restaurant', () => {
  const seedSettings = (premiumThemeAllowed: boolean) => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings: { name: 'Chai Corner', premiumThemeAllowed }, users: [], orders: [] }));
    reload();
  };

  it('the premium gate keeps DT Refined when the premium set is not allotted', () => {
    seedSettings(false);
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
    enforcePremiumThemeGate();
    expect(getUiStyle()).toBe('modern');
    expect(getThemeId()).toBe(REFINED_THEME_ID);
  });

  it('…but still returns any other Modern theme to Classic, as before', () => {
    seedSettings(false);
    setTheme('ember');
    setUiStyle('modern');
    enforcePremiumThemeGate();
    expect(getUiStyle()).toBe('classic');
  });
});

describe('Settings → Appearance', () => {
  const seedSettings = (premiumThemeAllowed: boolean) => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings: { name: 'Chai Corner', premiumThemeAllowed }, users: [], orders: [] }));
    reload();
  };
  const choiceOf = (id: string) => document.querySelector(`[data-style-choice="${id}"]`) as HTMLElement;
  const card = async () => { const { default: InterfaceStyleCard } = await import('@/components/settings/InterfaceStyleCard'); return render(<InterfaceStyleCard />); };

  it('offers DT Refined first, then Modern and Classic', async () => {
    seedSettings(true);
    await card();
    const group = screen.getByRole('radiogroup', { name: 'Interface style' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map(r => r.getAttribute('data-style-choice'))).toEqual(['refined', 'modern', 'classic']);
    expect(radios[0].textContent).toMatch(/DT Refined/);
    expect(radios[0].textContent).toMatch(/Open to every restaurant/);
  });

  it('a restaurant without the premium set can switch DT Refined on; Modern stays locked', async () => {
    seedSettings(false);
    await card();
    expect(choiceOf('modern').textContent).toMatch(/Premium — locked/);
    expect(choiceOf('refined').textContent).not.toMatch(/locked/);
    fireEvent.click(choiceOf('refined'));
    expect(localStorage.getItem(UI_THEME_KEY)).toBe(REFINED_THEME_ID);
    expect(localStorage.getItem(UI_STYLE_KEY)).toBe('modern');
    await waitFor(() => expect(choiceOf('refined')).toHaveAttribute('aria-checked', 'true'));
    // the Modern theme manager is not offered on DT Refined
    expect(screen.queryByRole('tablist', { name: 'Theme family' })).toBeNull();
    fireEvent.click(choiceOf('modern'));
    expect(localStorage.getItem(UI_THEME_KEY)).toBe(REFINED_THEME_ID); // locked: nothing changed
    expect(getUiStyle()).toBe('modern');
  });

  it('leaving DT Refined for Modern really changes the look', async () => {
    seedSettings(true);
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
    await card();
    expect(choiceOf('refined')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(choiceOf('modern'));
    expect(localStorage.getItem(UI_THEME_KEY)).toBe('ember');
    expect(getUiStyle()).toBe('modern');
    await waitFor(() => expect(choiceOf('modern')).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('tablist', { name: 'Theme family' })).toBeTruthy();
  });
});

// ------------------------------------------------------------------ the sidebar
describe('the sidebar: grouping and status words', () => {
  const page = (key: string, group: PageDef['group']): PageDef => ({ key, path: `/${key}`, title: key, group, defaultRoles: ['admin'] } as PageDef);

  it('groups in the design order, keeps each group\'s order, drops duplicates and empty groups', () => {
    const out = groupPages([page('reports', 'Reports'), page('pos', 'Operations'), page('tables', 'Operations'), page('pos', 'Operations'), page('staff', 'Staff')]);
    expect(out.map(g => g.group)).toEqual(['Operations', 'Staff', 'Reports']);
    expect(out[0].items.map(i => i.key)).toEqual(['pos', 'tables']);
    expect(GROUP_ORDER).toEqual(['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin']);
  });

  it('every real module lands in one of the design groups', () => {
    const groups = groupPages(PAGES);
    expect(groups.reduce((s, g) => s + g.items.length, 0)).toBe(new Set(PAGES.map(p => p.key)).size);
    for (const g of groups) expect(GROUP_ORDER).toContain(g.group);
  });

  it('first visit opens Operations; later the saved groups; the current page\'s group is always open', () => {
    expect([...initialOpenGroups(null)]).toEqual(['Operations']);
    expect([...initialOpenGroups(['Staff'])]).toEqual(['Staff']);
    expect([...initialOpenGroups(['Staff'], 'Inventory')].sort()).toEqual(['Inventory', 'Staff']);
    localStorage.setItem(OPEN_GROUPS_KEY, '{not json');
    expect(readOpenGroups()).toBeNull();
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(['Admin', 3, 'Reports']));
    expect(readOpenGroups()).toEqual(['Admin', 'Reports']);
  });

  it('the status card never says "synced" when it is not', () => {
    expect(syncLabel({ online: true, pending: 0 })).toEqual({ tone: 'ok', title: 'Online', detail: 'Offline-ready · queue empty' });
    expect(syncLabel({ online: true, pending: 1 })).toEqual({ tone: 'warn', title: 'Online', detail: 'Offline-ready · 1 change waiting to sync' });
    expect(syncLabel({ online: true, pending: 3, lastError: 'boom' })).toEqual({ tone: 'warn', title: 'Online — sync needs attention', detail: '3 changes waiting to sync' });
    expect(syncLabel({ online: false, pending: 2 })).toEqual({ tone: 'bad', title: 'Offline', detail: 'Working locally · 2 changes waiting to sync' });
  });
});

describe('the sidebar, rendered with the real permission rules', () => {
  const seed = (role: 'admin' | 'cashier') => {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: { name: 'Chai Corner', currencySymbol: 'Rs ', costTrackingEnabled: true, premiumThemeAllowed: true },
      users: [
        { id: 'admin-default', name: 'Administrator', username: 'admin', password: 'x', role: 'admin', isActive: true },
        { id: 'u-cashier', name: 'Bilal', username: 'bilal', password: 'x', role: 'cashier', isActive: true },
      ],
      categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], inventory: [], orderCounter: 1000,
    }));
    localStorage.setItem('pos-user-id', role === 'admin' ? 'admin-default' : 'u-cashier');
    localStorage.setItem('pos-user-role', role);
    localStorage.setItem('pos-tenant-plan', 'enterprise');
    reload();
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
  };
  const sidebar = async (at = '/', role: 'admin' | 'cashier' = 'admin', collapsed = false) => {
    const { default: RefinedSidebar } = await import('@/components/shell/RefinedSidebar');
    return render(
      <TooltipProvider><Router at={at}>
        <RefinedSidebar userRole={role} onLogout={() => {}} mobileOpen={false} setMobileOpen={() => {}} collapsed={collapsed} onOpenLauncher={() => {}} />
      </Router></TooltipProvider>,
    );
  };
  const groupButton = (name: string) => document.querySelector(`[data-refined-group="${name}"] > button[aria-expanded]`) as HTMLElement;

  it('shows the restaurant, the groups in order with counts, Operations open, and the status card', async () => {
    seed('admin');
    await sidebar('/');
    expect(screen.getByText('Chai Corner')).toBeInTheDocument();
    const heads = [...document.querySelectorAll('[data-refined-group]')].map(e => e.getAttribute('data-refined-group'));
    expect(heads[0]).toBe('Operations');
    expect(heads).toEqual(GROUP_ORDER.filter(g => heads.includes(g)));
    expect(groupButton('Operations')).toHaveAttribute('aria-expanded', 'true');
    expect(groupButton('Inventory')).toHaveAttribute('aria-expanded', 'false');
    expect(within(groupButton('Inventory')).getByText(/^\d+$/)).toBeInTheDocument(); // count on a closed group
    expect(screen.getByTestId('refined-sync-card').textContent).toMatch(/Online|Offline/);
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });

  it('opening a group shows its modules and is remembered', async () => {
    seed('admin');
    await sidebar('/');
    expect(screen.queryByRole('button', { name: 'Inventory' })).toBeNull();
    fireEvent.click(groupButton('Inventory'));
    expect(groupButton('Inventory')).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY)!)).toContain('Inventory'));
  });

  it('the current page is a filled item and its group opens by itself', async () => {
    seed('admin');
    await sidebar('/dashboard');
    expect(groupButton('Reports')).toHaveAttribute('aria-expanded', 'true');
    const item = document.querySelector('[data-nav-key="dashboard"]')!;
    expect(item).toHaveAttribute('aria-current', 'page');
    expect(item).toHaveAttribute('data-refined-nav-item');
  });

  it('one filled item even when two entries share a route (Day Close opens Settings)', async () => {
    seed('admin');
    await sidebar('/settings');
    const current = [...document.querySelectorAll('[aria-current="page"]')];
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-nav-key')).toBe('settings');
  });

  it('a cashier sees only what the permission system allows', async () => {
    seed('cashier');
    await sidebar('/', 'cashier');
    expect(document.querySelector('[data-nav-key="dashboard"]')).toBeNull();
    expect(document.querySelector('[data-nav-key="settings"]')).toBeNull();
    expect(document.querySelector('[data-nav-key="pos"]')).not.toBeNull();
  });

  it('collapsed: icons only, still labelled', async () => {
    seed('admin');
    await sidebar('/', 'admin', true);
    expect(screen.getByRole('button', { name: 'Search modules' })).toBeInTheDocument();
    expect(screen.queryByTestId('refined-sync-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'POS' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ the dashboard figures
// Tuesday 3 Nov 2026, 15:30 local
const NOW = new Date(2026, 10, 3, 15, 30, 0).getTime();
const at = (d: number, h: number, min = 0, m = 11) => new Date(2026, m - 1, d, h, min).toISOString();
let seq = 0;
const order = (o: Partial<Order> = {}): Order => ({
  id: `o${++seq}`, orderNumber: seq, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
  items: [{ id: 'i', menuItemId: 'm-karahi', name: 'Karahi', quantity: 1, lineTotal: 1000 } as any],
  subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000, createdAt: at(3, 12), paidAt: at(3, 12), notes: '', ...o,
} as Order);
const line = (menuItemId: string, name: string, quantity: number, lineTotal: number) => ({ id: `${menuItemId}-${quantity}`, menuItemId, name, quantity, lineTotal, price: lineTotal / quantity } as any);

describe('dashboard: period and comparison', () => {
  it('Today runs to the end of today and is compared with the same weekday last week, to the same clock time', () => {
    const c = compareWindows(1, NOW);
    expect(new Date(c.cur.start).getDate()).toBe(3);
    expect(new Date(c.cur.start).getHours()).toBe(0);
    expect(new Date(c.cur.end).getDate()).toBe(4);
    expect(new Date(c.prev.start).getDate()).toBe(27); // Tuesday 27 Oct
    expect(new Date(c.prev.start).getMonth()).toBe(9);
    expect(c.prev.end - c.prev.start).toBe(NOW - c.cur.start);
    expect(c.vs).toBe('last Tue');
  });

  it('Week and Month are the last N calendar days against the N before', () => {
    const w = compareWindows(7, NOW);
    expect(new Date(w.cur.start).getDate()).toBe(28); // 28 Oct … 3 Nov
    expect(w.prev.end).toBe(w.cur.start);
    expect(Math.round((w.cur.start - w.prev.start) / 86400000)).toBe(7);
    expect(w.vs).toBe('the 7 days before');
    expect(compareWindows(30, NOW).label).toBe('last 30 days');
  });

  it('a bill after the clock time last week is not in the comparison; credit and open bills are not sales', () => {
    const orders = [
      order({ grandTotal: 1000 }),
      order({ grandTotal: 2000, paidAt: at(3, 13), createdAt: at(3, 13) }),
      order({ grandTotal: 1500, paidAt: at(27, 12, 0, 10), createdAt: at(27, 12, 0, 10) }),
      order({ grandTotal: 9999, paidAt: at(27, 18, 0, 10), createdAt: at(27, 18, 0, 10) }), // after 15:30
      order({ grandTotal: 700, status: 'credit_pending', paymentMethod: 'credit' }),
      order({ grandTotal: 400, status: 'running', paidAt: undefined }),
      order({ grandTotal: 300, status: 'void' }),
    ];
    const c = compareWindows(1, NOW);
    expect(kpisIn(orders, c.cur)).toEqual({ sales: 3000, orders: 2, avg: 1500 });
    expect(kpisIn(orders, c.prev)).toEqual({ sales: 1500, orders: 1, avg: 1500 });
  });
});

describe('dashboard: open bills, days, shares', () => {
  it('open bills are running or on hold, split by order type, largest first', () => {
    const r = openBills([
      order({ status: 'running' }), order({ status: 'hold', orderType: 'delivery' }), order({ status: 'running' }),
      order({ status: 'paid' }), order({ status: 'pending_approval', orderType: 'delivery' }),
    ]);
    expect(r.total).toBe(3);
    expect(r.byType).toEqual([{ key: 'dining', word: 'dining', count: 2 }, { key: 'delivery', word: 'delivery', count: 1 }]);
  });

  it('one point per day, quiet days are zero, today is last', () => {
    const pts = dailySales([order({ grandTotal: 500 }), order({ grandTotal: 800, paidAt: at(1, 20), createdAt: at(1, 20) }), order({ grandTotal: 50, paidAt: at(20, 9, 0, 10), createdAt: at(20, 9, 0, 10) })], 7, NOW);
    expect(pts).toHaveLength(7);
    expect(pts.map(p => p.label)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    expect(pts[6]).toMatchObject({ sales: 500, orders: 1 });
    expect(pts[4]).toMatchObject({ sales: 800, orders: 1 }); // Sunday 1 Nov
    expect(pts.reduce((s, p) => s + p.sales, 0)).toBe(1300); // 20 Oct is outside
    expect(dailySales([], 30, NOW)[29].label).toBe('3 Nov');
  });

  it('shares always add to exactly 100', () => {
    expect(roundShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(roundShares([2000, 1500, 1000, 800]).reduce((s, x) => s + x, 0)).toBe(100);
    expect(roundShares([0, 0])).toEqual([0, 0]);
  });
});

describe('dashboard: payment mix', () => {
  const w = compareWindows(1, NOW).cur;
  it('a paid bill counts under its method; a split bill is divided by its payments and scaled to its total', () => {
    const mix = paymentMix([
      order({ grandTotal: 1000, paymentMethod: 'cash' }),
      order({ grandTotal: 2000, paymentMethod: 'card' }),
      order({ grandTotal: 1500, paymentMethod: 'cash', payments: [{ id: 'a', method: 'cash', amount: 600, at: at(3, 12) }, { id: 'b', method: 'online', amount: 1200, at: at(3, 12) }] }), // 1800 handed over for 1500
    ], w);
    const by = Object.fromEntries(mix.rows.map(r => [r.key, r.amount]));
    expect(by).toEqual({ cash: 1500, card: 2000, online: 1000 });
    expect(mix.total).toBe(4500); // equals Sales
    expect(mix.rows[0].key).toBe('card');
    expect(mix.rows.reduce((s, r) => s + r.pct, 0)).toBe(100);
  });

  it('credit is its own slice and voids, open bills and approvals are left out', () => {
    const mix = paymentMix([
      order({ grandTotal: 1000 }),
      order({ grandTotal: 500, status: 'credit_pending', paymentMethod: 'credit' }),
      order({ grandTotal: 900, status: 'void' }),
      order({ grandTotal: 800, status: 'running', paidAt: undefined }),
      order({ grandTotal: 700, status: 'pending_approval', paymentMethod: 'credit' }),
    ], w);
    expect(mix.rows.map(r => [r.name, r.amount])).toEqual([['Cash', 1000], ['Credit', 500]]);
    expect(mix.credit).toBe(500);
    expect(mix.rows.map(r => r.pct)).toEqual([67, 33]);
  });

  it('nothing sold: no rows', () => {
    expect(paymentMix([], w)).toEqual({ rows: [], total: 0, credit: 0 });
  });
});

describe('dashboard: top items and orders by hour', () => {
  const w = compareWindows(1, NOW).cur;
  const menu = [{ id: 'm-tea', name: 'Tea', image: 'data:image/png;base64,AA' } as MenuItem];

  it('top items by quantity, from paid bills only, with the menu picture', () => {
    const top = topItemsByQty([
      order({ items: [line('m-karahi', 'Karahi', 2, 2000)] }),
      order({ items: [line('m-karahi', 'Karahi', 1, 1000), line('m-tea', 'Tea', 4, 400)] }),
      order({ items: [line('m-pizza', 'Pizza', 9, 9000)], status: 'void' }),
      order({ items: [line('m-naan', 'Naan', 3, 150)] }),
    ], menu, w, 5);
    expect(top.map(t => [t.name, t.qty])).toEqual([['Tea', 4], ['Karahi', 3], ['Naan', 3]]); // Karahi beats Naan on sales
    expect(top[0].image).toBe('data:image/png;base64,AA');
    expect(top[1].sales).toBe(3000);
  });

  it('orders per hour, trimmed to the busy hours, at least 8 bars, the current hour kept', () => {
    const orders = [order({ paidAt: at(3, 12, 10) }), order({ paidAt: at(3, 12, 50) }), order({ paidAt: at(3, 13, 5) })];
    const bars = ordersByHour(orders, w, [15]);
    expect(bars.map(b => b.hour)).toEqual([10, 11, 12, 13, 14, 15, 16, 17]); // 12–15 widened on both sides to 8 bars
    expect(bars.find(b => b.hour === 12)!.orders).toBe(2);
    expect(bars.find(b => b.hour === 15)!.orders).toBe(0);
    expect(ordersByHour([], w)).toEqual([]);
    expect(highlightHour(bars, true, NOW)).toEqual({ hour: 15, why: 'now' });
    expect(highlightHour(bars, false, NOW)).toEqual({ hour: 12, why: 'busiest' });
    expect(hourLabel(0)).toBe('12 AM');
    expect(hourLabel(12)).toBe('12 PM');
    expect(hourLabel(21)).toBe('9 PM');
  });

  it('a late-night service widens to the left, never past midnight', () => {
    const bars = ordersByHour([order({ paidAt: at(3, 23, 30) })], { start: new Date(2026, 10, 3).getTime(), end: new Date(2026, 10, 4).getTime() });
    expect(bars[bars.length - 1].hour).toBe(23);
    expect(bars).toHaveLength(8);
  });
});

describe('dashboard: needs attention', () => {
  const money = (n: number) => `Rs ${n}`;
  const dayStartMs = new Date(2026, 10, 3, 8, 0).getTime();

  it('lists only what someone can act on, most urgent first, each with the page that fixes it', () => {
    const items = attentionItems({
      orders: [
        order({ status: 'pending_approval' }), order({ status: 'pending_approval' }),
        order({ status: 'running', paidAt: undefined, createdAt: at(2, 22) }), // left open from yesterday
        order({ status: 'running', paidAt: undefined, createdAt: at(3, 14) }),
      ],
      lowStock: [{ name: 'Chicken', qty: 2, min: 5 }, { name: 'Oil', qty: 1, min: 4 }, { name: 'Rice', qty: 0, min: 10 }, { name: 'Salt', qty: 0, min: 1 }],
      outstandingCredit: 800,
      dayStartMs,
      money,
    });
    expect(items.map(i => i.text)).toEqual([
      '2 online orders await approval',
      '1 bill from an earlier day is still open',
      'Chicken is below the minimum (2 left, minimum 5)',
      'Oil is below the minimum (1 left, minimum 4)',
      'Rice is below the minimum (0 left, minimum 10)',
      '1 more item below the minimum',
      'Rs 800 is owed on credit',
    ]);
    expect(items.map(i => i.to)).toEqual(['/online-approval', '/running-bills', '/inventory', '/inventory', '/inventory', '/inventory', '/credits']);
    expect(items.map(i => i.tone)).toEqual(['warning', 'warning', 'danger', 'danger', 'danger', 'danger', 'info']);
  });

  it('nothing to do: an empty list (the card then says so)', () => {
    expect(attentionItems({ orders: [order()], lowStock: [], outstandingCredit: 0, dayStartMs, money })).toEqual([]);
  });
});

describe('dashboard: export', () => {
  it('writes every card as a section, figures as shown, and escapes text safely', () => {
    const rows = dashboardCsv({
      shop: 'Chai, Corner', periodLabel: 'Today', generatedAt: new Date(NOW),
      kpis: { sales: 4500, orders: 3, avg: 1500 }, prev: { sales: 1500, orders: 1, avg: 1500 }, vs: 'last Tue', open: 3,
      days: [{ key: 'k', label: 'Tue', sales: 4500, orders: 3 }],
      mix: [{ key: 'card', name: 'Card', amount: 2000, pct: 44 }],
      top: [{ key: 'm', name: 'Tea "special"', qty: 4, sales: 400 }],
      hours: [{ hour: 21, label: '21', orders: 2 }],
    });
    expect(rows).toContainEqual(['Sales', 4500, 1500]);
    expect(rows).toContainEqual(['Open bills (now)', 3, '']);
    expect(rows).toContainEqual(['Card', 2000, 44]);
    expect(rows).toContainEqual(['9 PM', 2]);
    const text = toCsvText(rows);
    expect(text.charCodeAt(0)).toBe(0xfeff); // Excel reads the rupee sign and Urdu names correctly
    expect(text).toContain('"Chai, Corner"');
    expect(text).toContain('"Tea ""special"""');
  });
});

// ------------------------------------------------------------------ the dashboard, rendered
describe('the SW-02 dashboard through the real store', () => {
  afterEach(() => { vi.useRealTimers(); });

  const seedStore = () => {
    seq = 0;
    const orders = [
      order({ grandTotal: 1000, paymentMethod: 'cash', items: [line('m-karahi', 'Karahi', 2, 1000)] }),
      order({ grandTotal: 2000, paymentMethod: 'card', orderType: 'delivery', paidAt: at(3, 13, 10), createdAt: at(3, 13), items: [line('m-pizza', 'Pizza', 1, 2000)] }),
      order({ grandTotal: 1500, paymentMethod: 'cash', orderType: 'takeaway', paidAt: at(3, 14, 5), createdAt: at(3, 14), payments: [{ id: 'p1', method: 'cash', amount: 500, at: at(3, 14, 5) }, { id: 'p2', method: 'online', amount: 1000, at: at(3, 14, 5) }], items: [line('m-karahi', 'Karahi', 1, 500), line('m-tea', 'Tea', 4, 1000)] }),
      order({ grandTotal: 1500, paidAt: at(27, 12, 0, 10), createdAt: at(27, 12, 0, 10) }), // last Tuesday
      order({ status: 'running', paidAt: undefined, createdAt: at(3, 15) }),
      order({ status: 'hold', orderType: 'delivery', paidAt: undefined, createdAt: at(3, 15, 10) }),
      order({ status: 'running', paidAt: undefined, createdAt: at(2, 22) }), // left open from yesterday
      order({ status: 'pending_approval', paidAt: undefined, createdAt: at(3, 15, 20) }),
      order({ grandTotal: 800, status: 'credit_pending', paymentMethod: 'credit', paidAt: undefined, createdAt: at(3, 11) }),
    ];
    localStorage.setItem(STORE_KEY, JSON.stringify({
      settings: { name: 'Chai Corner', currencySymbol: 'Rs ', premiumThemeAllowed: false },
      users: [{ id: 'admin-default', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
      categories: [], menuItems: [], orders, tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [],
      inventory: [{ id: 'inv1', name: 'Chicken', quantity: 2, lowStockThreshold: 5, isActive: true, unit: 'kg' }],
      orderCounter: 1000,
    }));
    localStorage.setItem('pos-user-id', 'admin-default');
    localStorage.setItem('pos-user-role', 'admin');
    reload();
  };

  const page = async () => {
    const { default: DashboardPage } = await import('@/pages/DashboardPage');
    return render(<TooltipProvider><Router at="/dashboard"><DashboardPage /></Router></TooltipProvider>);
  };

  it('DT Refined: greeting, four cards, mix, top items, alerts — every figure from the orders', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    seedStore();
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
    await page();
    expect(screen.getByTestId('refined-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-dashboard')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Good afternoon, Ayesha');
    expect(screen.getByText(/Chai Corner · Tuesday/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('sw02-period')).getByRole('tab', { name: 'Today' }));
    await waitFor(() => expect(screen.getByTestId('sw02-kpi-sales-value').textContent).toMatch(/4,500/));
    expect(screen.getByTestId('sw02-kpi-sales').textContent).toMatch(/Sales today/);
    expect(screen.getByTestId('sw02-kpi-sales-note').textContent).toMatch(/200% vs last Tue/);
    expect(screen.getByTestId('sw02-kpi-orders-value').textContent).toBe('3');
    expect(screen.getByTestId('sw02-kpi-orders-note').textContent).toMatch(/2 more than last Tue/);
    expect(screen.getByTestId('sw02-kpi-avg-value').textContent).toMatch(/1,500/);
    expect(screen.getByTestId('sw02-kpi-avg-note').textContent).toMatch(/0% vs last Tue/);
    expect(screen.getByTestId('sw02-kpi-open-value').textContent).toBe('3');
    expect(screen.getByTestId('sw02-kpi-open-note').textContent).toBe('2 dining · 1 delivery');

    const mix = screen.getByTestId('sw02-mix');
    expect(within(mix).getAllByRole('listitem').slice(0, 4).map(li => li.textContent)).toEqual(['Card38%', 'Cash28%', 'Online19%', 'Credit15%']);
    expect(mix.textContent).toMatch(/Credit is counted in Sales once it is collected/);

    expect(within(screen.getByTestId('sw02-top')).getAllByRole('listitem').map(li => li.textContent)).toEqual(['TETea4 sold', 'KAKarahi3 sold', 'PIPizza1 sold']);

    const alerts = within(screen.getByTestId('sw02-attention')).getAllByRole('button').map(b => b.textContent);
    expect(alerts[0]).toBe(' 1 online order awaits approval');
    expect(alerts[1]).toBe(' 1 bill from an earlier day is still open');
    expect(alerts[2]).toBe(' Chicken is below the minimum (2 left, minimum 5)');
    expect(alerts[3]).toMatch(/800 is owed on credit$/);

    expect(screen.getByTestId('recent-orders')).toBeInTheDocument();
  });

  it('Week compares with the 7 days before, and Standard view is one click away (and remembered)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    seedStore();
    setTheme(REFINED_THEME_ID);
    setUiStyle('modern');
    await page();
    fireEvent.click(within(screen.getByTestId('sw02-period')).getByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(screen.getByTestId('sw02-kpi-sales').textContent).toMatch(/Sales · last 7 days/));
    // 28 Oct … 3 Nov holds today's 4,500; last Tuesday (27 Oct) falls in the 7 days before
    expect(screen.getByTestId('sw02-kpi-sales-value').textContent).toMatch(/4,500/);
    expect(screen.getByTestId('sw02-kpi-sales-note').textContent).toMatch(/200% vs the 7 days before/);
    fireEvent.click(screen.getByTestId('switch-standard'));
    await waitFor(() => expect(screen.queryByTestId('refined-dashboard')).toBeNull());
    expect(localStorage.getItem('dtpos-dashboard-layout')).toBe('standard');
  });

  it('every other theme keeps the v1.80.0 Overview', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    seedStore();
    setTheme('ember');
    setUiStyle('modern');
    await page();
    expect(screen.getByTestId('overview-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('refined-dashboard')).toBeNull();
  });
});
