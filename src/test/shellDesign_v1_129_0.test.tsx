// v1.129.0 — the shell (sidebar + top bar) is the Design Package's SW-02, exactly; the owner called the old one "messy".
// The rule these tests pin: the bar carries ONLY title · search · branch · sync · bell · user. Everything it used to carry loose
// (clock, status pulse, colour scheme, text size, log out) is one click away in the user menu — nothing was removed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HashRouter } from '@/lib/hash-router';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { agoLabel, lastSyncedAt, markSynced, onSyncedAt, syncChipState } from '@/lib/syncClock';

vi.mock('@/components/HeaderNotificationBar', () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock('@/components/BillingStatusBar', () => ({ default: ({ pills = true, warning = true }: { pills?: boolean; warning?: boolean }) => <span data-testid={`billing-${pills ? 'pills' : 'nopills'}-${warning ? 'warn' : 'nowarn'}`} /> }));
vi.mock('@/components/shell/HeaderClock', () => ({ default: () => <span data-testid="clock" /> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

describe('the sync chip words', () => {
  const T = 1_000_000_000_000;
  it('says how long ago the cloud was last heard from, and never "synced" while it is not', () => {
    expect(syncChipState({ online: true, pending: 0 }, T - 12_000, T)).toEqual({ tone: 'ok', label: 'Synced 12 s ago' });
    expect(syncChipState({ online: true, pending: 0 }, T - 1_000, T)).toEqual({ tone: 'ok', label: 'Synced just now' });
    expect(syncChipState({ online: true, pending: 0 }, 0, T)).toEqual({ tone: 'ok', label: 'Synced' });            // never heard yet: no invented time
    expect(syncChipState({ online: true, pending: 3 }, T, T)).toEqual({ tone: 'warn', label: '3 waiting to sync' });
    expect(syncChipState({ online: true, pending: 0, lastError: 'x' }, T, T)).toEqual({ tone: 'warn', label: 'Sync needs attention' });
    expect(syncChipState({ online: false, pending: 0 }, T, T)).toEqual({ tone: 'bad', label: 'Offline' });
    expect(syncChipState({ online: false, pending: 2 }, T, T)).toEqual({ tone: 'bad', label: 'Offline · 2 waiting' });
    expect(syncChipState({ online: true, pending: 2, flushing: true }, T, T)).toEqual({ tone: 'busy', label: 'Syncing…' });
  });

  it('ago labels step seconds → minutes → hours → days', () => {
    expect([2, 12, 59, 60, 600, 3600, 7200, 86400 * 3].map(s => agoLabel(T - s * 1000, T))).toEqual(['just now', '12 s ago', '59 s ago', '1 min ago', '10 min ago', '1 h ago', '2 h ago', '3 d ago']);
  });

  it('is marked by real cloud contact and tells listeners', () => {
    const seen = vi.fn();
    const off = onSyncedAt(seen);
    markSynced(T);
    expect(lastSyncedAt()).toBe(T);
    expect(seen).toHaveBeenCalledTimes(1);
    off(); markSynced(T + 1);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('the top bar, as the design draws it', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); window.location.hash = '#/dashboard'; });
  afterEach(() => cleanup());

  const mount = async (extra: Record<string, unknown> = {}) => {
    const { default: ModernHeader } = await import('@/components/shell/ModernHeader');
    return render(
      <TooltipProvider><HashRouter>
        <ModernHeader title="Dashboard" collapsed={false} onToggleCollapse={() => {}} onOpenMobileMenu={() => {}} onOpenLauncher={() => {}} zoom={100} onZoom={() => {}} onResetZoom={() => {}}
          userChip={{ name: 'Bilal', role: 'cashier', onLogout: () => {} }} {...extra}>
          <span data-testid="branch-chip">Main branch</span>
        </ModernHeader>
      </HashRouter></TooltipProvider>,
    );
  };

  it('holds exactly: the title, the search with Ctrl K, the branch, the sync chip, the bell and the user', async () => {
    await mount();
    const bar = document.querySelector('[data-refined-header]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(within(bar).getByRole('heading', { level: 1 }).textContent).toBe('Dashboard');
    expect(within(bar).getAllByRole('button', { name: 'Search modules' }).length).toBeGreaterThan(0);
    expect(within(bar).getByText('Ctrl K')).toBeInTheDocument();
    expect(within(bar).getByTestId('branch-chip')).toBeInTheDocument();
    expect(within(bar).getByTestId('refined-sync-chip')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(bar).getByTestId('refined-user-menu')).toBeInTheDocument();
  });

  it('carries no clock, scheme swatches, text-size buttons or log-out loose in the bar', async () => {
    await mount();
    const bar = document.querySelector('[data-refined-header]') as HTMLElement;
    expect(within(bar).queryByTestId('clock')).toBeNull();
    expect(within(bar).queryByTestId('scheme-switcher')).toBeNull();
    expect(within(bar).queryByRole('button', { name: /smaller|larger/i })).toBeNull();
    expect(within(bar).queryByTestId('refined-logout')).toBeNull();
    expect(within(bar).queryByTestId('billing-pills-warn')).toBeNull();
  });

  it('the user menu holds all of it: who and where, the time, the status, the colour scheme, the text size, log out', async () => {
    const onLogout = vi.fn(); const onZoom = vi.fn();
    await mount({ userChip: { name: 'Bilal', role: 'cashier', onLogout }, onZoom });
    fireEvent.click(screen.getByTestId('refined-user-menu'));
    expect(await screen.findByTestId('clock')).toBeInTheDocument();
    expect(screen.getByTestId('refined-status')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Colour scheme' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Larger' }));
    expect(onZoom).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByTestId('refined-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('on the POS path Ctrl K belongs to the item search: no badge on the module search', async () => {
    window.location.hash = '#/';
    await mount();
    const bar = document.querySelector('[data-refined-header]') as HTMLElement;
    expect(within(bar).queryByText('Ctrl K')).toBeNull();
  });

  it('Ctrl K opens the module search everywhere else', async () => {
    const open = vi.fn();
    await mount({ onOpenLauncher: open });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
