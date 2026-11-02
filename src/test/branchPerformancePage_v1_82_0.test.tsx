// v1.82.0 — the Branch Performance page, through the real page and store; and who gets to see it.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import BranchPerformancePage from '@/pages/BranchPerformancePage';
import { deleteBranch, deleteOrder, deleteTransaction, getBranches, getOrders, getTransactions, saveBranch, saveOrder, saveTransaction } from '@/lib/store';
import { visiblePagesForUser, MULTI_BRANCH_ONLY_PAGES, PAGES } from '@/lib/permissions';
import { featureEnabled } from '@/lib/plans';
import type { Order, Transaction, User } from '@/lib/types';

// An hour ago: always inside the default 7-day window, whatever the clock says (a fixed hour of "today" is in the
// future just after midnight, which is how this test first failed).
const today = (_h = 11) => new Date(Date.now() - 3600_000).toISOString();
const bill = (o: Partial<Order>): Order => ({
  id: Math.random().toString(36).slice(2), orderNumber: 1, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
  items: [{ id: 'i', menuItemId: 'm', name: 'Karahi', quantity: 1, lineTotal: 1000 } as any], subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0,
  grandTotal: 1000, createdAt: today(8), paidAt: today(8), ...o,
} as Order);

function reset() {
  getOrders().forEach(o => deleteOrder(o.id));
  getTransactions().forEach(t => deleteTransaction(t.id));
  getBranches().forEach(b => deleteBranch(b.id));
  localStorage.clear();
  localStorage.setItem('pos-user-role', 'admin');
}
const mount = () => render(<HashRouter><BranchPerformancePage /></HashRouter>);

beforeEach(() => { cleanup(); reset(); });

describe('a restaurant with one branch', () => {
  it('sees an explanation, not a half-empty comparison', () => {
    saveBranch({ id: 'A', name: 'Main' } as any);
    mount();
    expect(screen.getByText(/needs two or more branches/i)).toBeInTheDocument();
    expect(screen.queryByTestId('compare-table')).toBeNull();
  });
});

describe('a restaurant with several branches', () => {
  const seed = () => {
    saveBranch({ id: 'A', name: 'Gulberg' } as any);
    saveBranch({ id: 'B', name: 'DHA' } as any);
    saveBranch({ id: 'C', name: 'Johar Town' } as any);
    saveOrder(bill({ branchId: 'A', grandTotal: 6000, subtotal: 6000 }));
    saveOrder(bill({ branchId: 'A', grandTotal: 2000, subtotal: 2000 }));
    saveOrder(bill({ branchId: 'B', grandTotal: 3000, subtotal: 3000 }));
    saveTransaction({ id: 'x1', date: today(9), type: 'expense', categoryId: 'c', categoryName: 'Gas', amount: 1000, paymentMethod: 'cash', description: '', branchId: 'A' } as Transaction);
    saveTransaction({ id: 'x2', date: today(9), type: 'expense', categoryId: 'c', categoryName: 'Gas', amount: 500, paymentMethod: 'cash', description: '', branchId: 'B' } as Transaction);
  };

  it('shows the group, one row per branch (including one that sold nothing) and the group row', () => {
    seed();
    mount();
    const t = screen.getByTestId('compare-table');
    for (const n of ['Gulberg', 'DHA', 'Johar Town']) expect(within(t).getByText(n)).toBeInTheDocument();
    expect(within(screen.getByTestId('row-A')).getByText(/Rs\.8,000/)).toBeInTheDocument();
    expect(within(screen.getByTestId('row-B')).getAllByText(/Rs\.3,000/).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('row-C')).getAllByText(/Rs\.0/).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('row-group')).getByText(/Rs\.11,000/)).toBeInTheDocument();
  });

  it('the group cards agree with the table', () => {
    seed();
    mount();
    const k = screen.getByTestId('group-kpis');
    expect(within(k).getByText('Rs.11,000')).toBeInTheDocument();        // sales
    expect(within(k).getByText('Rs.9,500')).toBeInTheDocument();         // profit = 11,000 − 1,500
    expect(within(k).getByText('3')).toBeInTheDocument();                // orders
  });

  it('names the leader and the weakest branch, and re-ranks when the measure changes', () => {
    seed();
    mount();
    expect(screen.getByTestId('rank-note')).toHaveTextContent(/Gulberg.*leads/);
    expect(screen.getByTestId('rank-note')).toHaveTextContent(/DHA.*weakest/);
    fireEvent.change(screen.getByLabelText('Rank by'), { target: { value: 'expenses' } });
    // lower expenses is better: DHA (500) beats Gulberg (1,000)
    expect(screen.getByTestId('rank-note')).toHaveTextContent(/DHA.*leads/);
  });

  it('shares of the business add up to 100 %', () => {
    seed();
    mount();
    const text = screen.getByTestId('share-list').textContent || '';
    const shares = [...text.matchAll(/(\d+(?:\.\d)?)%/g)].map(m => Number(m[1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it('bills saved without a branch are listed on their own row, for an owner', () => {
    seed();
    saveOrder(bill({ grandTotal: 400, subtotal: 400, branchId: undefined }));
    mount();
    // with no current branch the order stays unstamped: it gets its own row and is part of the group
    expect(within(screen.getByTestId('row-__none__')).getByText('No branch recorded')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-group')).getByText(/Rs\.11,400/)).toBeInTheDocument();
  });
});

describe('who sees the page', () => {
  const admin = { id: 'u', name: 'Owner', role: 'admin', isActive: true } as User;
  const settings = { costTrackingEnabled: true } as any;

  it('is registered, for admins, and on the business plan', () => {
    expect(PAGES.find(p => p.key === 'branch-performance')).toMatchObject({ path: '/branch-performance', group: 'Reports', defaultRoles: ['admin'] });
    expect(MULTI_BRANCH_ONLY_PAGES).toContain('branch-performance');
    expect(featureEnabled('business', 'branch-performance')).toBe(true);
    expect(featureEnabled('trial', 'branch-performance')).toBe(false);
  });
  it('a single-branch restaurant never sees it', () => {
    localStorage.setItem('pos-tenant-plan', 'enterprise');
    const keys = (n: number | undefined) => visiblePagesForUser(admin, true, settings, n === undefined ? undefined : { branchCount: n }).map(p => p.key);
    expect(keys(1)).not.toContain('branch-performance');
    expect(keys(0)).not.toContain('branch-performance');
  });
  it('two or more branches, or a caller that does not say, keeps it', () => {
    localStorage.setItem('pos-tenant-plan', 'enterprise');
    const keys = (c?: { branchCount: number }) => visiblePagesForUser(admin, true, settings, c).map(p => p.key);
    expect(keys({ branchCount: 2 })).toContain('branch-performance');
    expect(keys()).toContain('branch-performance');
  });
  it('and leaves every other page exactly as it was', () => {
    localStorage.setItem('pos-tenant-plan', 'enterprise');
    // v1.87.0 — Branch Management joined Branch Performance as a page only a multi-branch restaurant sees.
    const base = visiblePagesForUser(admin, true, settings).map(p => p.key).filter(k => !MULTI_BRANCH_ONLY_PAGES.includes(k));
    const single = visiblePagesForUser(admin, true, settings, { branchCount: 1 }).map(p => p.key);
    expect(single).toEqual(base);
  });
});
