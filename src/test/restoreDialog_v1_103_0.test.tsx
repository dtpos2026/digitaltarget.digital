// v1.103.0 — the Backup & Restore page shows the restore's real progress, never reloads on a blind timer, and says what is left.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';

let finish: (o: unknown) => void = () => {};
const importDataMock = vi.fn();
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), importData: (...a: unknown[]) => importDataMock(...a) }));
vi.mock('@/lib/authProvider', async (orig) => ({ ...(await orig<typeof import('@/lib/authProvider')>()), usingSupabaseAuth: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
async function mount() {
  localStorage.setItem('desi-pos-data', JSON.stringify({ settings: { name: 'X' }, users: [{ id: 'a1', name: 'Owner', username: 'o', password: 'x', role: 'admin', isActive: true }], orders: [], categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 1 }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); reload();
  const { default: Page } = await import('@/pages/BackupRestorePage');
  window.location.hash = '#/backup';
  return render(<HashRouter><Page /></HashRouter>);
}
const pick = (c: HTMLElement) => fireEvent.change(c.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['{"menuItems":[]}'], 'b.json')] } });
const outcome = (o: object) => ({ cloud: true, total: 500, ok: 500, failed: 0, failedRows: [], ...o });

describe('the restore dialog', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); importDataMock.mockReset(); importDataMock.mockImplementation(() => new Promise(r => { finish = r; })); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('shows live progress, stays open past six seconds, and cannot be reloaded away by a timer', async () => {
    const reloadSpy = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, reload: reloadSpy, hash: orig.hash } });
    const { container } = await mount();
    pick(container);
    expect(await screen.findByTestId('restore-progress')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new CustomEvent('dt-import-progress', { detail: { processedCount: 200, totalCount: 500 } })); });
    await waitFor(() => expect(screen.getByTestId('restore-progress').textContent).toMatch(/200 of 500 records uploaded/));
    await new Promise(r => setTimeout(r, 6500));                        // the old blind reload fired here
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('restore-progress')).toBeInTheDocument();
    Object.defineProperty(window, 'location', { configurable: true, value: orig });
  }, 15000);

  it('when some records could not be uploaded it stays open and says they are queued', async () => {
    const { container } = await mount();
    pick(container);
    await screen.findByTestId('restore-progress');
    await act(async () => { finish(outcome({ ok: 497, failed: 3, failedRows: [{ col: 'orders', id: 'o1', error: 'timeout' }] })); });
    const sum = await screen.findByTestId('restore-summary');
    expect(sum.textContent).toMatch(/497/);
    expect(sum.textContent).toMatch(/3[\s\S]*could not be uploaded yet/);
    expect(sum.textContent).toMatch(/queued/);
    expect(sum.textContent).toMatch(/orders · timeout/);
    expect(screen.getByRole('button', { name: /Reload now/ })).toBeInTheDocument();
  });

  it('a clean restore says so and reloads by itself shortly after the upload is done', async () => {
    const reloadSpy = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...orig, reload: reloadSpy, hash: orig.hash } });
    const { container } = await mount();
    pick(container);
    await screen.findByTestId('restore-progress');
    await act(async () => { finish(outcome({})); });
    expect(reloadSpy).not.toHaveBeenCalled();                          // not instantly
    await new Promise(r => setTimeout(r, 1800));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'location', { configurable: true, value: orig });
  }, 10000);
});
