// ============================================================================
// v1.64.0 — Owner Management
//
// REQUESTED: "ak owner kelyi app hoga, apka manage kr sky, or web b ho uska",
// and "multi branch wala b check krna ky data wgara owner me show ho konsi
// bransh ye fla, a to z".
//
// The POS answers "what is happening at this till, right now". An owner asks
// something else — "which of my branches is actually earning, and what is tied
// up". Different question, different shape: the branch breakdown is the first
// thing on the page, not a dropdown to hunt for.
//
// TWO RULES THIS PAGE LIVES BY, both of which these tests pin:
//
//  1. It NEVER computes its own totals. Every figure comes from
//     src/lib/sales.ts — the same helpers the POS, Reports and Day Close use.
//     A second set of totals here is how two screens start disagreeing about
//     the day's money, and then nobody trusts either.
//
//  2. It is read-only. An owner reviewing last week must not be one mis-click
//     from editing a bill. The POS already owns that.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES } from '@/lib/permissions';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const page  = stripTs(read('src/pages/OwnerManagementPage.tsx'));
// v1.86.0 — the arithmetic moved to lib/ownerApp.ts so the Owner app on the phone and this page share it; the rules
// below are pinned where they now live (and exercised with real orders in ownerApp_v1_86_0.test.ts).
const lib   = stripTs(read('src/lib/ownerApp.ts'));
const app   = stripTs(read('src/App.tsx'));
const plans = stripTs(read('src/lib/plans.ts'));

describe('the page is reachable and gated', () => {
  it('is registered as a page', () => {
    const m = PAGES.find(x => x.key === 'owner-management');
    expect(m, 'owner-management is not in PAGES').toBeTruthy();
    expect(m!.path).toBe('/owner');
  });

  it('is admin only — not a shift manager screen', () => {
    // This is every branch's takings in one place.
    const m = PAGES.find(x => x.key === 'owner-management')!;
    expect(m.defaultRoles).toEqual(['admin']);
    expect(m.defaultRoles).not.toContain('manager');
    expect(m.defaultRoles).not.toContain('cashier');
  });

  it('has a route', () => {
    expect(app).toContain('<Route path="/owner" element={<OwnerManagementPage />} />');
  });

  it('is lazy-loaded like every other page', () => {
    expect(app).toContain('lazy(() => import("@/pages/OwnerManagementPage"))');
  });

  it('ships with the plans that have more than one branch', () => {
    expect(plans).toContain("'branches', 'owner-management'");
  });
});

describe('the numbers agree with the till', () => {
  it('uses the shared sales helpers, not its own arithmetic', () => {
    expect(page).toContain("from '@/lib/ownerApp'");
    expect(page).toContain('branchFigures(allOrders, branches, rangeOf(preset)');
    expect(lib).toContain("from './sales'");
    for (const fn of ['isPaidSale', 'isPartialSale', 'paidRevenue', 'balanceDue', 'isVoidish', 'isOpen']) {
      expect(lib, `${fn} is not used — the owner figures must not invent their own totals`).toContain(fn);
    }
  });

  it('counts part-payments as money taken, like the POS does', () => {
    expect(lib).toContain('isPaidSale(o) || isPartialSale(o)');
    expect(lib).toContain('paidRevenue(o)');
  });

  it('never adds a void or cancelled bill to takings', () => {
    // `continue` before revenue is the whole point.
    expect(lib).toContain('if (isVoidish(o)) { b.voided += 1; continue; }');
  });

  it('uses the shared date ranges rather than rolling its own', () => {
    expect(lib).toContain("from './salesReport'");
    expect(lib).toContain('presetRange(preset, now)');
    expect(lib).toContain('revenueTimestamp(o)');
    expect(page).toContain('rangeOf(preset)');
  });
});

describe('a branch is never quietly dropped', () => {
  it('shows a branch that took nothing', () => {
    // An empty branch is information. Hiding it reads as "all fine".
    expect(lib).toContain('for (const b of branches) if (allowed(b.id)) buckets.set(b.id, blank(b.id, b.name));');
  });

  it('shows orders with no branch under their own heading', () => {
    // Usually rows predating branch stamping. Dropping them makes the totals
    // fail to add up with no explanation.
    expect(lib).toContain("export const UNASSIGNED = '__unassigned__';");
    expect(lib).toContain("'No branch recorded'");
  });

  it('counts what is open now regardless of the date filter', () => {
    // An owner checking last month still wants to know what is open today.
    expect(lib).toContain('if (isOpen(o)) b.openNow += 1;');
  });
});

describe('it stays a report', () => {
  it('writes nothing', () => {
    for (const w of ['saveOrder', 'saveEntity', 'deleteEntity', 'saveSettings', 'enqueue']) {
      expect(page, `${w} must not appear — this screen is read-only`).not.toContain(w);
    }
  });

  it('reads the store once, not on every render', () => {
    // The CRM page stalled by calling the store in the render body.
    expect(page).toContain('useState<Order[]>(() => getOrders())');
    expect(page).toContain('useState(() => getBranches())');
  });
});
