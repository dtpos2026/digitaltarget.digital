// ============================================================
// v1.145.0 — the Staff audit log as the design draws it (SW-39): "N events", Export, a search with All · Void · Discount … chips, and a table —
// Time · User · Action (a coloured pill) · Bill · Amount · Reason · Approved by. Pinned: the rules in lib/auditBoard.ts, the chips / exact action / search /
// day, the export, the old look and the stylesheet. The log itself is append-only and is not touched.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { AUDIT_ACTION_TITLES } from '@/lib/staffAudit';
import { actionTone, auditCsv, auditRows, auditSubtitle, billOf, matchesGroup, timeOf } from '@/lib/auditBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

const ROWS = () => [
  { id: 'a1', at: at(12, 41), action: 'DISCOUNT', userName: 'Ali Raza', userRole: 'cashier', orderNumber: 1042, amount: 200, reason: 'Regular customer', approvedBy: 'Sana', deviceName: 'Counter 1', tableLabel: 'T-04' },
  { id: 'a2', at: at(12, 20), action: 'VOID', userName: 'Sana Ahmed', userRole: 'manager', orderNumber: 1036, amount: 1290, reason: 'Customer left' },
  { id: 'a3', at: at(11, 58), action: 'PAYMENT', userName: 'Ali Raza', userRole: 'cashier', orderNumber: 1031, amount: 2400 },
  { id: 'a4', at: at(11, 2), action: 'LOGIN', userName: 'Ali Raza', userRole: 'cashier', deviceName: 'Counter 1' },
  { id: 'a5', at: at(10, 30), action: 'RESTRICTED_BLOCKED', userName: 'Bilal', userRole: 'cashier', orderNumber: 1020, reason: 'Price edit needs a manager' },
  { id: 'a6', at: at(9, 15), action: 'RIGHTS_CHANGED', userName: 'Ayesha', userRole: 'admin', reason: 'Bilal may give discounts' },
] as any[];

describe('the rules', () => {
  it('the chips are groups of the log\'s actions; the exact action narrows further; the search reads who, what, where and why; newest first', () => {
    const all = ROWS();
    expect(auditRows(all, 'all', 'all', '').map(r => r.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(auditRows(all, 'void', 'all', '').map(r => r.id)).toEqual(['a2']);
    expect(auditRows(all, 'approval', 'all', '').map(r => r.id)).toEqual(['a5']);
    expect(auditRows(all, 'rights', 'all', '').map(r => r.id)).toEqual(['a6']);
    expect(auditRows(all, 'payment', 'all', '').map(r => r.id)).toEqual(['a3']);
    expect(auditRows(all, 'all', 'LOGIN', '').map(r => r.id)).toEqual(['a4']);
    expect(auditRows(all, 'all', 'all', 'ali').map(r => r.id)).toEqual(['a1', 'a3', 'a4']);
    expect(auditRows(all, 'all', 'all', '#1036').map(r => r.id)).toEqual(['a2']);
    expect(auditRows(all, 'all', 'all', 'counter 1').map(r => r.id)).toEqual(['a1', 'a4']);
    expect(auditRows(all, 'all', 'all', 'sana').map(r => r.id)).toEqual(['a1', 'a2']);                 // the user, or who approved
    expect(auditRows(all, 'void', 'all', 'ali')).toEqual([]);
    expect(matchesGroup({ action: 'LOGOUT' }, 'login')).toBe(true);
  });

  it('the pill colours and the words', () => {
    expect(actionTone('DISCOUNT')).toBe('warn'); expect(actionTone('VOID')).toBe('bad'); expect(actionTone('LOGIN')).toBe('info');
    expect(actionTone('PAYMENT')).toBe('ok'); expect(actionTone('MANAGER_APPROVAL')).toBe('accent'); expect(actionTone('RIGHTS_RULE')).toBe('accent'); expect(actionTone('ORDER_EDIT')).toBe('neutral');
    expect(billOf({ orderNumber: 1042 })).toBe('#1042'); expect(billOf({ orderId: 'abcdef123456' })).toBe('abcdef12'); expect(billOf({})).toBe('—');
    expect(timeOf(at(9, 5))).toBe('09:05'); expect(timeOf('nope')).toBe('—');
    expect(auditSubtitle(1, '2026-11-22', '2026-11-22')).toBe('1 event today');
    expect(auditSubtitle(8632, '2026-11-20', '2026-11-22')).toBe('8,632 events on 20 Nov 2026');
  });

  it('the CSV keeps the old columns', () => {
    const csv = auditCsv(ROWS().slice(0, 2), AUDIT_ACTION_TITLES);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Date/Time","User","Role","Action","Order","Table","Device","Approved By","Amount","Reason"');
    expect(lines[1]).toContain('"Discount applied"'); expect(lines[1]).toContain('"#1042"'); expect(lines[1]).toContain('"Regular customer"'); expect(lines[1]).toContain('"Sana"');
  });
});

function seed() {
  localStorage.setItem('pos-staff-audit-v1', JSON.stringify(ROWS()));
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
}
const mount = async () => { const { default: Page } = await import('@/pages/StaffAuditLogPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const ids = () => [...document.querySelectorAll('[data-au-row]')].map(r => r.getAttribute('data-au-row'));
const loaded = async () => { await waitFor(() => expect(document.querySelectorAll('[data-au-row]').length).toBeGreaterThan(0)); };

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/staff-audit'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "6 events today", Export and the table with a coloured pill per action', async () => {
    await mount(); await loaded();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Staff audit log');
    expect(document.querySelector('[data-au-subtitle]')!.textContent).toBe('6 events today');
    expect(ids()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const r = document.querySelector('[data-au-row="a1"]') as HTMLElement;
    expect(r.querySelector('.au-pill')!.getAttribute('data-tone')).toBe('warn');
    expect(r.querySelector('.au-pill')!.getAttribute('title')).toBe('Discount applied');
    for (const t of ['12:41', 'Ali Raza', 'cashier', '#1042', 'T-04', 'Rs 200', 'Regular customer', 'Sana', 'Counter 1']) expect(r.textContent).toContain(t);
    expect(document.querySelector('[data-au-row="a2"] .au-pill')!.getAttribute('data-tone')).toBe('bad');
    expect(document.querySelector('[data-au-row="a4"]')!.textContent).toContain('—');
  });

  it('the chips, the exact action and the search narrow the table', async () => {
    await mount(); await loaded();
    fireEvent.click(document.querySelector('[data-au-group="void"]')!);
    expect(ids()).toEqual(['a2']);
    fireEvent.click(document.querySelector('[data-au-group="all"]')!);
    fireEvent.change(screen.getByRole('combobox', { name: 'Exact action' }), { target: { value: 'LOGIN' } });
    expect(ids()).toEqual(['a4']);
    fireEvent.click(document.querySelector('[data-au-group="all"]')!);
    expect((screen.getByRole('combobox', { name: 'Exact action' }) as HTMLSelectElement).value).toBe('all');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search staff audit log' }), { target: { value: 'bilal' } });
    expect(ids()).toEqual(['a5', 'a6']);                              // the person, and the rights change that names them
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search staff audit log' }), { target: { value: 'zzz' } });
    expect(document.querySelector('[data-au-empty]')!.textContent).toBe('No records match.');
  });

  it('another day with no records says so', async () => {
    await mount(); await loaded();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2020-01-01' } });
    await waitFor(() => expect(document.querySelector('[data-au-empty]')?.textContent).toBe('No audit records for this day.'));
    expect(document.querySelector('[data-au-subtitle]')!.textContent).toBe('0 events on 1 Jan 2020');
    expect(document.querySelector('[data-au-export]')).toBeDisabled();
  });

  it('Export downloads what the chips show', async () => {
    const blobs: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; });
    (URL as any).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount(); await loaded();
    fireEvent.click(document.querySelector('[data-au-group="discount"]')!);
    fireEvent.click(document.querySelector('[data-au-export]')!);
    expect(click).toHaveBeenCalled();
    const text = await blobs[0].text();
    expect(text.split('\n').length).toBe(2);                         // the header and the one discount
    expect(text).toContain('Regular customer');
    click.mockRestore();
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/staff-audit'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: the old heading, the date box and the summary chips', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-au-page]')).toBeNull();
    expect(screen.getByText('Staff — Action Audit Log')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Discount applied: 1/)).toBeInTheDocument());
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-audit.css');
    expect(read('src/styles.css')).toContain('ui-refined-audit.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
