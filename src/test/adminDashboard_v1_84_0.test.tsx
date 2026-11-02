// v1.84.0 — the Super Admin dashboard (reference layout: brand sidebar, cards, waiting list, renewals, + New invoice).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import AdminDashboard from '@/components/superadmin/AdminDashboard';

afterEach(() => cleanup());
const now = Date.now();
const day = (n: number) => new Date(now + n * 86400000).toISOString();
const tenants = [
  { id: 'a', name: 'Gold Kitchen', approved: true, planExpiryAt: day(40), plan: 'business' },
  { id: 'b', name: 'Chai Corner', approved: true, planExpiryAt: day(3), plan: 'starter' },
  { id: 'c', name: 'Pizza Point', approved: true, planExpiryAt: day(-5), plan: 'business' },
  { id: 'd', name: 'New Biryani', email: 'owner@nb.pk', approved: false, createdAt: day(-2) },
];
const devices = [
  { tenantId: 'a', approved: true, blocked: false, lastSeenMs: now - 30_000 },
  { tenantId: 'b', approved: false, blocked: false, lastSeenMs: null },
  { tenantId: 'c', approved: true, blocked: true, lastSeenMs: null },
];
const money = async () => ({
  invoices: [{ tenantId: 'a', total: 12000, paidTotal: 5000, status: 'partial' }, { tenantId: 'c', total: 9000, paidTotal: 0, status: 'void' }],
  payments: [{ amount: 5000, receivedAt: new Date().toISOString() }],
});
const props = (over: Record<string, unknown> = {}) => ({
  tenants, devices, onApprove: vi.fn(), onOpenBilling: vi.fn(), onGo: vi.fn(), onRefresh: vi.fn(), loadMoney: money, ...over,
});
const value = (id: string) => screen.getByTestId(`${id}-value`).textContent;

describe('the cards', () => {
  it('show every figure the console can know', async () => {
    render(<AdminDashboard {...(props() as any)} />);
    await waitFor(() => expect(value('k-collected')).toBe('Rs 5,000'));
    expect(value('k-restaurants')).toBe('4');
    expect(value('k-waiting')).toBe('1');
    expect(value('k-devices-new')).toBe('1');
    expect(value('k-active')).toBe('2');
    expect(value('k-expired')).toBe('1');
    expect(value('k-expiring')).toBe('1');
    expect(value('k-blocked')).toBe('1');
    expect(value('k-online')).toBe('1');
    expect(value('k-outstanding')).toBe('Rs 7,000');
    expect(value('k-payment-pending')).toBe('1');
  });
  it('do not invent a figure the console cannot read (sales of every restaurant today)', () => {
    render(<AdminDashboard {...(props() as any)} />);
    expect(screen.queryByText(/sales today/i)).toBeNull();
    expect(screen.getByText(/Not shown on purpose/)).toBeInTheDocument();
  });
  it('when the money cannot be loaded, money cards show a dash and a warning, never a wrong zero', async () => {
    render(<AdminDashboard {...(props({ loadMoney: async () => { throw new Error('denied'); } }) as any)} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/));
    expect(value('k-collected')).toBe('—');
    expect(value('k-outstanding')).toBe('—');
    expect(value('k-payment-pending')).toBe('—');
  });
  it('take you to the section behind them', () => {
    const p = props();
    render(<AdminDashboard {...(p as any)} />);
    fireEvent.click(screen.getByTestId('k-devices-new'));
    expect(p.onGo).toHaveBeenCalledWith('devices');
    fireEvent.click(screen.getByTestId('k-expired'));
    expect(p.onGo).toHaveBeenCalledWith('clients');
  });
});

describe('the lists', () => {
  it('waiting for approval, with an Approve button for each', () => {
    const p = props();
    render(<AdminDashboard {...(p as any)} />);
    const list = screen.getByTestId('waiting-list');
    expect(within(list).getByText('New Biryani')).toBeInTheDocument();
    expect(within(list).getByText(/owner@nb\.pk/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Approve' }));
    expect(p.onApprove).toHaveBeenCalledWith('d');
  });
  it('renewals due: expired first, then expiring, with badges and an Invoice button', () => {
    const p = props();
    render(<AdminDashboard {...(p as any)} />);
    const list = screen.getByTestId('renewals-list');
    const names = within(list).getAllByText(/Pizza Point|Chai Corner/).map(n => n.textContent);
    expect(names).toEqual(['Pizza Point', 'Chai Corner']);
    expect(within(list).getByText('Expired')).toBeInTheDocument();
    expect(within(list).getByText('Expiring soon')).toBeInTheDocument();
    expect(within(list).queryByText('Gold Kitchen')).toBeNull();      // 40 days away
    fireEvent.click(within(list).getAllByRole('button', { name: 'Invoice' })[0]);
    expect(p.onOpenBilling).toHaveBeenCalledWith('c');
  });
  it('empty states when nothing is waiting or due', () => {
    render(<AdminDashboard {...(props({ tenants: [{ id: 'x', name: 'Fine', approved: true, planExpiryAt: day(90) }] }) as any)} />);
    expect(screen.getByText('Nobody is waiting')).toBeInTheDocument();
    expect(screen.getByText('No renewals due')).toBeInTheDocument();
  });
});

describe('+ New invoice', () => {
  it('asks which restaurant, then opens its billing', () => {
    const p = props();
    render(<AdminDashboard {...(p as any)} />);
    fireEvent.click(screen.getByTestId('new-invoice'));
    const dlg = screen.getByTestId('invoice-picker');
    const open = within(dlg).getByRole('button', { name: 'Open billing' });
    expect(open).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText('Restaurant'), { target: { value: 'b' } });
    fireEvent.click(open);
    expect(p.onOpenBilling).toHaveBeenCalledWith('b');
  });
});

describe('the console layout', () => {
  const src = readFileSync('src/pages/SuperAdminPage.tsx', 'utf8');
  it('opens on the Dashboard, which is first in the section list', () => {
    expect(src).toMatch(/useState<'dashboard' \| 'restaurants'[^>]*>\('dashboard'\)/);
    expect(src).toMatch(/const tabItems = \(\[\s*\{ id: 'dashboard', label: 'Dashboard'/);
  });
  it('has the brand sidebar on large screens and keeps the pill strip on small ones', () => {
    expect(src).toContain('data-testid="admin-sidebar"');
    expect(src).toMatch(/overflow-x-auto pos-scrollbar lg:hidden/);
    expect(src.match(/tabItems\.map\(t => \(/g)?.length).toBe(2);
  });
  it('every section that existed is still reachable', () => {
    for (const id of ['restaurants', 'clients', 'messages', 'reports', 'packages', 'plans', 'customerApps', 'devices', 'map', 'team', 'monitor', 'releases', 'cleanup']) {
      expect(src).toContain(`id: '${id}'`);
    }
  });
});
