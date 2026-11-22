// ============================================================
// v1.148.0 — HR as the design draws it (SW-23): "HR · 3 employees on record", Add employee, underlined tabs (Employees · Attendance · Advances · Payslips)
// and the employees table (Code · Employee · Designation · Joined · Basic · Allowances · Status). Pinned: the words in lib/hrBoard.ts, the page under DT Refined
// (add, edit, delete against the saved list), the other tabs still reachable, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getEmployees } from '@/lib/store';
import { employeeCountLine, joinedLabel } from '@/lib/hrBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

const EMPLOYEES = () => [
  { id: 'e1', empCode: 'E-001', name: 'Sana Ahmed', fatherName: '', cnic: '', phone: '0300111', address: '', designation: 'Manager', department: '', joiningDate: '2025-03-12', basicSalary: 85000, allowances: 10000, status: 'active', notes: '' },
  { id: 'e2', empCode: 'E-002', name: 'Ali Raza', fatherName: '', cnic: '', phone: '0300222', address: '', designation: 'Cashier', department: '', joiningDate: '2025-06-02', basicSalary: 48000, allowances: 4000, status: 'active', notes: '' },
  { id: 'e3', empCode: 'E-003', name: 'Hamza Tariq', fatherName: '', cnic: '', phone: '', address: '', designation: '', department: '', joiningDate: '', basicSalary: 38000, allowances: 0, status: 'inactive', notes: '' },
];

describe('the words', () => {
  it('joinedLabel: "12 Mar 2025", and a dash when there is no usable date', () => {
    expect(joinedLabel('2025-03-12')).toBe('12 Mar 2025');
    expect(joinedLabel('2025-08-02T10:00:00.000Z')).toBe('02 Aug 2025');
    expect(joinedLabel('')).toBe('—'); expect(joinedLabel(undefined)).toBe('—'); expect(joinedLabel('2025-13-40')).toBe('—'); expect(joinedLabel('nonsense')).toBe('—');
  });
  it('employeeCountLine: plural, singular and none', () => {
    expect(employeeCountLine(3)).toBe('3 employees on record');
    expect(employeeCountLine(1)).toBe('1 employee on record');
    expect(employeeCountLine(0)).toBe('No employees on record yet');
  });
});

function seed(employees = EMPLOYEES()) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [],
    employees, attendance: [], leaves: [], payslips: [], advances: [], orderCounter: 100,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/HRPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const row = (code: string) => document.querySelector(`[data-hr-row="${code}"]`) as HTMLElement;
const goTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/hr'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "3 employees on record", Add employee and the underlined tabs', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('HR');
    expect(document.querySelector('[data-hr-subtitle]')!.textContent).toBe('3 employees on record');
    expect(screen.getByRole('button', { name: /Add employee/ })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tabs-list"]')!.getAttribute('data-tabs')).toBe('underline');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Employees', 'Attendance', 'Advances', 'Payslips', 'Leaves']);   // the design's four, plus Leaves (kept)
    expect(screen.getByRole('tab', { name: 'Employees' }).getAttribute('aria-selected')).toBe('true');
  });

  it('the table: Code · Employee · Designation · Joined · Basic · Allowances · Status, with money and a status pill', async () => {
    await mount();
    const heads = [...document.querySelectorAll('[data-hr-employees] thead th')].map(t => t.textContent);
    expect(heads).toEqual(['Code', 'Employee', 'Designation', 'Joined', 'Basic', 'Allowances', 'Status', '']);
    const r = row('E-001');
    expect(r.textContent).toContain('Sana Ahmed');
    expect(r.textContent).toContain('0300111');
    expect(r.textContent).toContain('Manager');
    expect(r.textContent).toContain('12 Mar 2025');
    expect(r.textContent).toContain('Rs 85,000');
    expect(r.textContent).toContain('Rs 10,000');
    expect(within(r).getByText('Active')).toBeInTheDocument();
    expect(within(row('E-003')).getByText('Inactive')).toBeInTheDocument();
    expect(row('E-003').textContent).toContain('—');                       // no designation / date on record
  });

  it('Add employee opens the form, saves, and the table and the count follow', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Add employee/ }));
    const dlg = await screen.findByRole('dialog');
    const text = within(dlg).getAllByRole('textbox');
    fireEvent.change(text[0], { target: { value: 'E-004' } });
    fireEvent.change(text[1], { target: { value: 'Noor Fatima' } });
    fireEvent.change(text[4], { target: { value: '0300444' } });
    fireEvent.change(text[5], { target: { value: 'Chef' } });
    fireEvent.change(within(dlg).getAllByRole('spinbutton')[0], { target: { value: '60000' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(getEmployees().some(e => e.empCode === 'E-004' && e.name === 'Noor Fatima' && e.basicSalary === 60000)).toBe(true);
    expect(row('E-004').textContent).toContain('Rs 60,000');
    expect(document.querySelector('[data-hr-subtitle]')!.textContent).toBe('4 employees on record');
  });

  it('a row opens the same form to edit; Save keeps the change', async () => {
    await mount();
    fireEvent.click(row('E-002'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Edit Employee')).toBeInTheDocument();
    fireEvent.change(within(dlg).getAllByRole('textbox')[5], { target: { value: 'Head cashier' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(getEmployees().find(e => e.id === 'e2')!.designation).toBe('Head cashier');
    expect(row('E-002').textContent).toContain('Head cashier');
  });

  it('Delete asks first: No keeps the employee, Yes removes them and lowers the count', async () => {
    await mount();
    Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => false) });
    fireEvent.click(within(row('E-003')).getByRole('button', { name: 'Delete' }));
    expect(getEmployees().length).toBe(3);
    (window.confirm as any) = vi.fn(() => true);
    fireEvent.click(within(row('E-003')).getByRole('button', { name: 'Delete' }));
    expect(getEmployees().map(e => e.empCode)).toEqual(['E-001', 'E-002']);
    expect(row('E-003')).toBeNull();
    expect(document.querySelector('[data-hr-subtitle]')!.textContent).toBe('2 employees on record');
  });

  it('with nobody on record: "No employees on record yet" and the way to add the first one', async () => {
    cleanup(); localStorage.clear(); seed([]); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(document.querySelector('[data-hr-subtitle]')!.textContent).toBe('No employees on record yet');
    expect(document.querySelector('[data-hr-empty]')!.textContent).toContain('Add employee');
  });

  it('the other tabs are still there: Attendance, Advances, Payslips and Leaves open; Add employee belongs to Employees only', async () => {
    await mount();
    goTab(/^Attendance$/);
    expect(await screen.findByRole('tab', { name: 'Attendance', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add employee/ })).toBeNull();
    goTab(/^Advances$/);
    expect(await screen.findByRole('tab', { name: 'Advances', selected: true })).toBeInTheDocument();
    goTab(/^Payslips$/);
    expect(await screen.findByRole('tab', { name: 'Payslips', selected: true })).toBeInTheDocument();
    goTab(/^Leaves$/);
    expect(await screen.findByRole('tab', { name: 'Leaves', selected: true })).toBeInTheDocument();
    goTab(/^Employees$/);
    expect(await screen.findByRole('button', { name: /Add employee/ })).toBeInTheDocument();
    expect(row('E-001')).not.toBeNull();
  });

  it('coming back to Employees from another tab does not pop the Add form open again', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Add employee/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    goTab(/^Payslips$/);
    expect(await screen.findByRole('tab', { name: 'Payslips', selected: true })).toBeInTheDocument();
    goTab(/^Employees$/);
    expect(await screen.findByRole('tab', { name: 'Employees', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('another look keeps the old page', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-hr-page]')).toBeNull();
    expect(screen.getByText('HR Management')).toBeInTheDocument();
    expect(screen.getByText('Employees (3)')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tabs-list"]')!.getAttribute('data-tabs')).toBeNull();
  });
});

describe('the stylesheet', () => {
  const scoped = (file: string) => {
    const css = read(file);
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  };
  it('ui-refined-hr.css is imported and every rule is scoped to DT Refined', () => {
    expect(read('src/styles.css')).toContain('ui-refined-hr.css');
    scoped('src/styles/ui-refined-hr.css');
  });
  it('the underlined tabs are opt-in (data-tabs="underline") and every one of their rules is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-components.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.split('}').map(b => b.split('{')[0].trim()).filter(sel => sel.includes('[data-tabs="underline"]'));
    expect(rules.length).toBeGreaterThan(2);
    for (const sel of rules) for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^(html|:root)\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
  });
});
