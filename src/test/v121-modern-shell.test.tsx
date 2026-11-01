// ============================================================
// THE MODERN SHELL — sidebar, "More" launcher, Settings → Modules.
//
// Rendered with the real permission rules and the real module list. What is
// pinned: the sidebar stays short, every module is still reachable, a hidden
// module leaves the menu but its route and data are untouched, and switching
// back to Classic restores the full menu.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { HashRouter, Route, Routes, useLocation } from '@/lib/hash-router';
import type { ReactNode } from 'react';

// The cloud app routes by location.hash (src/lib/hash-router.tsx), so "a router that starts at /" is a HashRouter with
// the hash set first.
function MemoryRouter({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: string[] }) {
  if (typeof window !== 'undefined') window.location.hash = '#' + initialEntries[0];
  return <HashRouter>{children}</HashRouter>;
}
import { TooltipProvider } from '@/components/ui/tooltip';
import ModernSidebar from '@/components/shell/ModernSidebar';
import ModuleLauncher from '@/components/shell/ModuleLauncher';
import ModuleManagementCard from '@/components/settings/ModuleManagementCard';
import InterfaceStyleCard from '@/components/settings/InterfaceStyleCard';
import { PAGES, visiblePagesForUser } from '@/lib/permissions';
import { NAV_PREFS_KEY } from '@/lib/navPrefs';
import { UI_STYLE_KEY } from '@/lib/uiStyle';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};

const STORE_KEY = 'desi-pos-data';

function seed(role: 'admin' | 'cashier' = 'admin') {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', costTrackingEnabled: true, premiumThemeAllowed: true },
    users: [
      { id: 'admin-default', name: 'Administrator', username: 'admin', password: 'x', role: 'admin', isActive: true },
      { id: 'u-cashier', name: 'Bilal', username: 'bilal', password: 'x', role: 'cashier', isActive: true },
    ],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], inventory: [],
    orderCounter: 1000,
  }));
  localStorage.setItem('pos-user-id', role === 'admin' ? 'admin-default' : 'u-cashier');
  localStorage.setItem('pos-user-role', role);
}

const Where = () => <div data-testid="where">{useLocation().pathname}{useLocation().search}</div>;

function shell(opts: { launcher?: boolean; collapsed?: boolean } = {}) {
  const Sidebar = () => {
    const [open, setOpen] = (require('react') as typeof import('react')).useState(!!opts.launcher);
    return (
      <>
        <ModernSidebar userRole="admin" onLogout={() => {}} mobileOpen={false} setMobileOpen={() => {}} collapsed={!!opts.collapsed} onOpenLauncher={() => setOpen(true)} />
        <ModuleLauncher open={open} onOpenChange={setOpen} />
      </>
    );
  };
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

// The cloud app hides modules a restaurant's PLAN does not include and ones it has not switched on; the offline POS had
// neither. These tests are about the shell itself, so the restaurant is on the Enterprise plan with every module on.
beforeEach(() => {
  cleanup(); localStorage.clear();
  localStorage.setItem('dtpos-ui-style', 'modern');
  localStorage.setItem('pos-tenant-plan', 'enterprise');
  seed();
});

describe('the sidebar', () => {
  it('is short by default: the everyday modules, More with a count, Settings and the user at the foot', () => {
    shell();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const labels = within(nav).getAllByRole('button').map(b => b.textContent?.replace(/\d+$/, '').trim());
    expect(labels.slice(0, 3)).toEqual(['POS', 'Tables', 'Retrieve']);
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('More');
    expect(labels.length).toBeLessThan(15); // was 35+ before
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Chai Corner')).toBeInTheDocument(); // the restaurant leads
    expect(screen.getByText(/Powered by/)).toBeInTheDocument(); // …the credit is small
  });

  it('marks the current page and navigates on click', async () => {
    shell();
    fireEvent.click(screen.getByRole('button', { name: /^Tables$/ }));
    // The cloud router follows location.hash, which reports its change on the next tick.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/tables'));
    expect(screen.getByRole('button', { name: /^Tables$/ })).toHaveAttribute('aria-current', 'page');
  });

  it('collapsed: icons only, still labelled for screen readers', () => {
    shell({ collapsed: true });
    expect(screen.getByRole('button', { name: 'POS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More modules' })).toBeInTheDocument();
    expect(screen.queryByText('Point of Sale')).toBeNull();
  });

  it('a cashier sees only what the permission system allows', () => {
    cleanup(); localStorage.clear(); seed('cashier');
    render(
      <TooltipProvider><MemoryRouter>
        <ModernSidebar userRole="cashier" onLogout={() => {}} mobileOpen={false} setMobileOpen={() => {}} collapsed={false} onOpenLauncher={() => {}} />
      </MemoryRouter></TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: /^Dashboard$/ })).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.getByRole('button', { name: /^POS$/ })).toBeInTheDocument();
  });
});

describe('More — the module launcher', () => {
  it('lists every module the user may open, grouped, and searches them', () => {
    shell({ launcher: true });
    const dlg = screen.getByRole('dialog');
    for (const g of ['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin']) {
      expect(within(dlg).getByRole('region', { name: g })).toBeInTheDocument();
    }
    // The offline POS hid its cloud-only modules from this list; the cloud app lists everything the signed-in user may
    // open (role + plan + modules the restaurant has switched on), so the expected count is exactly that.
    const admin = { id: 'admin-default', name: 'Administrator', username: 'admin', password: 'x', role: 'admin', isActive: true } as any;
    const total = visiblePagesForUser(admin, true, { name: 'Chai Corner', costTrackingEnabled: true } as any, { branchCount: 0 }).length;
    expect(within(dlg).getAllByRole('button').filter(b => b.hasAttribute('data-module')).length).toBe(total);

    fireEvent.change(within(dlg).getByLabelText('Search modules'), { target: { value: 'stock' } });
    expect(within(dlg).queryByText('Menu')).toBeNull();
    fireEvent.change(within(dlg).getByLabelText('Search modules'), { target: { value: 'zzzz' } });
    expect(within(dlg).getByText(/No module matches/)).toBeInTheDocument();
  });

  it('opens the chosen module and closes', async () => {
    shell({ launcher: true });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Wastage' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/wastage'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a starred module appears under Favorites in the sidebar', () => {
    shell({ launcher: true });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add Wastage to favorites' }));
    expect(JSON.parse(localStorage.getItem(NAV_PREFS_KEY)!).favorites).toEqual(['wastage']);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: /Wastage/ })).toBeInTheDocument();
  });
});

describe('Settings → Modules', () => {
  const renderCard = () => render(
    <TooltipProvider><MemoryRouter><ModuleManagementCard /></MemoryRouter></TooltipProvider>,
  );

  it('hiding a module removes it from the sidebar and More but it stays in the list to bring back', () => {
    renderCard();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Kitchen placement' })).getByRole('radio', { name: 'Hidden' }));
    expect(JSON.parse(localStorage.getItem(NAV_PREFS_KEY)!).placement.kitchen).toBe('hidden');
    expect(screen.getByRole('radiogroup', { name: 'Kitchen placement' })).toBeInTheDocument(); // still listed
    cleanup();
    shell({ launcher: true });
    // (the open dialog marks the sidebar aria-hidden, hence hidden: true)
    const nav = screen.getByRole('navigation', { name: 'Main', hidden: true });
    expect(within(nav).queryByRole('button', { name: /^Kitchen$/, hidden: true })).toBeNull();
    expect(within(nav).getByRole('button', { name: /^POS$/, hidden: true })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Kitchen' })).toBeNull();
  }, 15_000); // renders the module list, then the whole shell with the launcher: ~4.6 s alone, slower when the full suite runs in parallel

  it('Settings itself cannot be moved or hidden', () => {
    renderCard();
    const row = document.querySelector('[data-module-row="settings"]')!;
    expect(row.textContent).toMatch(/Always in the menu/);
    expect(within(row as HTMLElement).queryByRole('radio')).toBeNull();
  });

  it('Restore default puts everything back', () => {
    localStorage.setItem(NAV_PREFS_KEY, JSON.stringify({ v: 1, placement: { pos: 'hidden', tables: 'hidden' }, order: [], favorites: ['menu'] }));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Restore default/ }));
    expect(localStorage.getItem(NAV_PREFS_KEY)).toBeNull();
    expect(screen.getByText('0 hidden')).toBeInTheDocument();
  });

  it('nothing else in storage is touched', () => {
    localStorage.setItem('desi-pos-data-probe', 'keep');
    const before = localStorage.getItem(STORE_KEY);
    renderCard();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Reports placement' })).getByRole('radio', { name: 'Hidden' }));
    expect(localStorage.getItem(STORE_KEY)).toBe(before);
    expect(localStorage.getItem('desi-pos-data-probe')).toBe('keep');
  });
});

describe('Settings → Appearance', () => {
  it('switches Modern ⇄ Classic and picks an accent, with a plain-language safety note', () => {
    render(<InterfaceStyleCard />);
    expect(screen.getByText(/never touched/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Classic/ }));
    expect(localStorage.getItem(UI_STYLE_KEY)).toBe('classic');
    expect(document.documentElement.hasAttribute('data-ui')).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: /Modern/ }));
    expect(document.documentElement.getAttribute('data-ui')).toBe('modern');
    fireEvent.click(screen.getByRole('radio', { name: 'Emerald' }));
    expect(localStorage.getItem('dtpos-ui-accent')).toBe('emerald');
    document.documentElement.removeAttribute('data-ui');
  });
});

describe('Settings → Theme gallery', () => {
  const reset = () => ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent'].forEach(a => document.documentElement.removeAttribute(a));

  it('offers thirteen themes; choosing one applies it and drops any accent override', () => {
    localStorage.setItem('dtpos-ui-accent', 'emerald');
    render(<InterfaceStyleCard />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getAllByRole('radio')).toHaveLength(13);
    for (const name of ['Ember Orange', 'Tomato Red', 'Fresh Green', 'Sunny Yellow', 'Clean White']) {
      expect(within(group).getByRole('radio', { name: new RegExp(name) })).toBeInTheDocument();
    }
    fireEvent.click(within(group).getByRole('radio', { name: /Tomato Red/ }));
    expect(localStorage.getItem('dtpos-ui-theme')).toBe('tomato');
    expect(localStorage.getItem('dtpos-ui-accent')).toBeNull();
    expect(document.documentElement.getAttribute('data-ui-theme')).toBe('tomato');
    expect(within(group).getByRole('radio', { name: /Tomato Red/ })).toHaveAttribute('aria-checked', 'true');
    reset();
  });

  it('the theme gallery is a Modern feature: Classic hides it and keeps its own colour themes', () => {
    localStorage.setItem('dtpos-ui-style', 'classic');
    render(<InterfaceStyleCard />);
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    reset();
  });
});

vi.stubGlobal('confirm', () => true);
