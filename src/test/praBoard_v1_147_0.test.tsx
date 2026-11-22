// ============================================================
// v1.147.0 — PRA fiscal invoicing as the design draws it (SW-37): "PRA fiscal invoicing — Disabled — enable only with your PRA registration", Enable, the honest
// "Not live" notice, three status cards (Submitted · Pending · Failed), the settings and the invoices table with Retry. Pinned: the rules in lib/praBoard.ts,
// Enable and the settings against the saved config, Retry / Send pending / Export / Test, the module-off guard, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getSettings } from '@/lib/store';
import { PRA_FILTERS, PRA_NOT_LIVE, PRA_STATUS_LABEL, praCounts, praRows, praSubtitle } from '@/lib/praBoard';

const queue: any[] = [];
const retry = vi.fn(); const drain = vi.fn(); const exportAudit = vi.fn(async () => '{}'); const clearLogs = vi.fn(async () => {});
const testConn = vi.fn(async () => ({ ok: false, message: 'Device not reachable', detail: 'ECONNREFUSED' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/praQueue', async (orig) => ({
  ...(await orig<typeof import('@/lib/praQueue')>()),
  getPraQueue: async () => queue.slice(), getPraLogs: async () => [{ id: 'l1', at: Date.now(), orderId: 'o', usin: '2001', direction: 'request', data: { a: 1 } }],
  exportPraAudit: (...a: unknown[]) => (exportAudit as any)(...a), retryPraEntry: (...a: unknown[]) => retry(...a), drainPraQueue: (...a: unknown[]) => drain(...a),
  onPraQueueChange: () => () => {}, clearPraLogs: (...a: unknown[]) => (clearLogs as any)(...a),
}));
vi.mock('@/lib/praTransport', async (orig) => ({ ...(await orig<typeof import('@/lib/praTransport')>()), testPraConnection: (...a: unknown[]) => (testConn as any)(...a), praBrowserLimitation: () => null }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

const E = (usin: string, status: string, t: number, extra: Record<string, unknown> = {}) => ({ id: `q${usin}`, orderId: `o${usin}`, usin, status, attempts: 1, firstQueuedAt: t, deviceId: 'd', ...extra });

describe('the rules', () => {
  const q = [E('2001', 'sent', 3, { praInvoiceNumber: 'PRA-1' }), E('2002', 'failed', 2, { lastError: 'HTTP 500' }), E('2003', 'pending', 1), E('2004', 'failed', 4)] as any[];
  it('the three cards count what is submitted, waiting and failed', () => {
    expect(praCounts(q)).toEqual({ submitted: 1, pending: 1, failed: 2 });
    expect(praCounts([])).toEqual({ submitted: 0, pending: 0, failed: 0 });
  });
  it('the table: the status chosen, newest first', () => {
    expect(PRA_FILTERS.map(f => f.label)).toEqual(['All', 'Failed', 'Pending', 'Submitted']);
    expect(praRows(q, 'all').map(r => r.usin)).toEqual(['2004', '2001', '2002', '2003']);
    expect(praRows(q, 'failed').map(r => r.usin)).toEqual(['2004', '2002']);
    expect(praRows(q, 'sent').map(r => r.usin)).toEqual(['2001']);
    expect(PRA_STATUS_LABEL.sent).toBe('Submitted');
  });
  it('the words', () => {
    expect(praSubtitle(false, 'sandbox')).toBe('Disabled — enable only with your PRA registration');
    expect(praSubtitle(true, 'sandbox')).toBe('Enabled · Sandbox');
    expect(praSubtitle(true, 'production')).toMatch(/^Enabled · Production — real invoices/);
    expect(PRA_NOT_LIVE).toBe('Not live: this build has not been tested against the PRA sandbox.');
  });
});

function seed(moduleOn = true, cfg: Record<string, unknown> = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', praEimsEnabled: moduleOn, praConfig: { enabled: false, posId: '', environment: 'sandbox', transport: 'local', printOnReceipt: true, ...cfg } },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/PraEimsSettingsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const cfg = () => (getSettings() as any).praConfig;
const rows = () => [...document.querySelectorAll('[data-pra-row]')].map(r => r.getAttribute('data-pra-row'));

describe('the page under DT Refined', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); window.location.hash = '#/pra-eims'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    queue.length = 0; queue.push(E('2001', 'sent', 3, { praInvoiceNumber: 'PRA-1' }), E('2002', 'failed', 2, { lastError: 'HTTP 500 from the device' }), E('2003', 'pending', 1));
    retry.mockClear(); drain.mockClear(); exportAudit.mockClear(); clearLogs.mockClear(); testConn.mockClear();
  });
  afterEach(() => cleanup());

  it('the title with its one line, Enable, and the honest "Not live" notice — always', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PRA fiscal invoicing');
    expect(document.querySelector('[data-pra-subtitle]')!.textContent).toBe('Disabled — enable only with your PRA registration');
    expect(document.querySelector('[data-pra-notice]')!.textContent).toBe(PRA_NOT_LIVE);
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('Enable / Disable switch the integration and save it', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(cfg().enabled).toBe(true);
    expect(document.querySelector('[data-pra-subtitle]')!.textContent).toBe('Enabled · Sandbox');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(cfg().enabled).toBe(false);
  });

  it('three cards count what is submitted, pending and failed; a card shows those invoices', async () => {
    await mount();
    await waitFor(() => expect(rows().length).toBe(3));
    expect(['sent', 'pending', 'failed'].map(k => document.querySelector(`[data-pra-card="${k}"] .pr-card-n`)!.textContent)).toEqual(['1', '1', '1']);
    fireEvent.click(document.querySelector('[data-pra-card="failed"]')!);
    expect(rows()).toEqual(['2002']);
  });

  it('the invoices table: status pill, the PRA invoice number as a verify link, the error, the tries — Retry only on a failed one', async () => {
    await mount();
    await waitFor(() => expect(rows().length).toBe(3));
    const failed = document.querySelector('[data-pra-row="2002"]') as HTMLElement;
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(failed.querySelector('.pr-err')!.textContent).toBe('HTTP 500 from the device');
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledWith('q2002');
    const sent = document.querySelector('[data-pra-row="2001"]') as HTMLElement;
    expect(within(sent).getByText('Submitted')).toBeInTheDocument();
    expect(within(sent).getByRole('link', { name: 'PRA-1' })).toHaveAttribute('target', '_blank');
    expect(within(sent).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('the settings save as they are typed; the POS ID takes digits only; production warns; cloud asks for the token', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('POS ID'), { target: { value: '10a0b000' } });
    expect(cfg().posId).toBe('100000');
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'production' } });
    expect(cfg().environment).toBe('production');
    expect(screen.getByText(/real invoices are recorded with the PRA/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Transport'), { target: { value: 'cloud' } });
    expect(cfg().transport).toBe('cloud');
    const token = screen.getByLabelText('PRA bearer token') as HTMLInputElement;
    expect(token.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show token' }));
    expect(token.type).toBe('text');
    fireEvent.change(token, { target: { value: 'abc' } });
    expect(cfg().cloudToken).toBe('abc');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(cfg().printOnReceipt).toBe(false);
  });

  it('Test connection shows what came back; Send pending and Export audit do their jobs', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-pra-test]')!);
    expect(await screen.findByText('Device not reachable')).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-pra-send]')!);
    expect(drain).toHaveBeenCalled();
    (URL as any).createObjectURL = vi.fn(() => 'blob:x'); (URL as any).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(document.querySelector('[data-pra-export]')!);
    await waitFor(() => expect(exportAudit).toHaveBeenCalled());
    click.mockRestore();
  });

  it('the API logs: Show lists them, Clear empties them', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-pra-logs]')!);
    expect(await screen.findByText(/request · #2001/)).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-pra-clear]')!);
    await waitFor(() => expect(clearLogs).toHaveBeenCalled());
  });
});

describe('the module off, and every other look', () => {
  afterEach(() => cleanup());
  it('the module off: the page says where to turn it on, under every look', async () => {
    cleanup(); localStorage.clear(); seed(false); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(screen.getByText(/Ye module abhi OFF hai/)).toBeInTheDocument();
    expect(document.querySelector('[data-pra-page]')).toBeNull();
  });
  it('another look keeps the page', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-pra-page]')).toBeNull();
    expect(screen.getByText(/PRA EIMS — Electronic Invoice Monitoring/)).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-pra.css');
    expect(read('src/styles.css')).toContain('ui-refined-pra.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
