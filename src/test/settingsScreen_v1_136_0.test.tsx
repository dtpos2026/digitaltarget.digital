// v1.136.0 — Settings in DT Refined (SW-28): the section's name is the page title, and a Discard / Save changes bar appears while there is
// something to discard or confirm. Edits are still kept on the device as they are typed (the autosave is unchanged).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getSettings } from '@/lib/store';
import { REFINED_ORDER } from '@/lib/refinedNav';

const saveNow = vi.fn(async () => {});
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), saveSettingsNow: (...a: unknown[]) => (saveNow as any)(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn(), loading: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const seed = () => {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Butt Bakers', address: 'Main Boulevard', currencySymbol: 'Rs ', phone1: '0300' },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], inventory: [], orderCounter: 10,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
  reload();
};
const mount = async (hash = '#/settings') => {
  const { default: Page } = await import('@/pages/SettingsPage');
  window.location.hash = hash;
  return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>);
};
beforeEach(() => { cleanup(); localStorage.clear(); saveNow.mockClear(); seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
afterEach(cleanup);

describe('Settings in DT Refined', () => {
  it('the page title is the section\'s name with its one line under it; the old strip is at the foot, not the top', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-settings-title] h1')!.textContent).toBe('General');
    expect(container.textContent).toMatch(/Restaurant info, currency/);
    expect(container.querySelector('[data-page-subtitle]')).toBeTruthy();
    const strip = screen.getByText(/Data security & isolation/);
    const nav = container.querySelector('nav[aria-label="Settings sections"]')!;
    expect(nav.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('another section renames the page (a link can open it directly)', async () => {
    const { container } = await mount('#/settings?tab=receipt');
    expect(container.querySelector('[data-settings-title] h1')!.textContent).toBe('Receipt & QR');
  });

  it('no bar until something changes; then Discard and Save changes', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-settings-bar]')).toBeNull();
    fireEvent.change(screen.getByDisplayValue('Butt Bakers'), { target: { value: 'Butt Bakers & Café' } });
    const bar = container.querySelector('[data-settings-bar]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('Discard puts the settings back as they were, on the device too, and the bar goes away', async () => {
    const { container } = await mount();
    fireEvent.change(screen.getByDisplayValue('Butt Bakers'), { target: { value: 'Something else' } });
    fireEvent.click(within(container.querySelector('[data-settings-bar]') as HTMLElement).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(container.querySelector('[data-settings-bar]')).toBeNull());
    expect(screen.getByDisplayValue('Butt Bakers')).toBeInTheDocument();
    expect(getSettings().name).toBe('Butt Bakers');
  });

  it('Save changes confirms with the cloud and the bar goes away', async () => {
    const { container } = await mount();
    fireEvent.change(screen.getByDisplayValue('Butt Bakers'), { target: { value: 'Butt Bakers & Café' } });
    fireEvent.click(within(container.querySelector('[data-settings-bar]') as HTMLElement).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveNow).toHaveBeenCalledTimes(1));
    expect((saveNow.mock.calls[0] as any[])[0]).toMatchObject({ name: 'Butt Bakers & Café' });
    await waitFor(() => expect(container.querySelector('[data-settings-bar]')).toBeNull());
  });

  it('the Admin group of the menu opens with Settings, as the design lists it', () => {
    expect(REFINED_ORDER.Admin?.slice(0, 6)).toEqual(['settings', 'printing-center', 'branches', 'devices', 'backup', 'moduleManagement']);
  });

  it('another look keeps the old header and top strip', async () => {
    setTheme('ember');
    const { container } = await mount();
    expect(container.querySelector('[data-settings-bar]')).toBeNull();
    expect(screen.getByText(/Restaurant details, look and feel, printing, and the modules you use/)).toBeInTheDocument();
  });
});
