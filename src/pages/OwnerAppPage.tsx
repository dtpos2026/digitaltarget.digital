// ============================================================
// OWNER APP (v1.86.0) — the design package's phone app for owners (design-project/06-owner-app), at #/owner-app.
//
//   Overview · Orders · Menu · Reports · More   (a bottom tab bar on a phone, a left rail from 820 px)
//
// It is rendered outside the till's shell (see App.tsx): the owner's phone runs no KOT printer, kitchen timer or
// order beeps. Who may open what is the permission system's decision (lib/permissions.ts): the Owner app page itself
// (owners and managers, plan permitting), and per tab the module behind it (menu, reports, inventory, accounts…).
// The DT Android "Owner" app opens this route (capacitor.owner.config.json).
// ============================================================
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { BarChart3, LayoutGrid, Menu as MenuIcon, ReceiptText, UtensilsCrossed } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from '@/lib/hash-router';
import { ownerAppAccess } from '@/lib/ownerAccess';
import { cn } from '@/lib/utils';
import DtMark from '@/components/DtMark';
import { OWNER_BASE } from '@/components/owner/ownerHooks';
import { OwnerBranch, OwnerOverview } from '@/components/owner/OwnerOverview';
import { OwnerOrderDetail, OwnerOrders } from '@/components/owner/OwnerOrders';
import { OwnerReports } from '@/components/owner/OwnerReports';
import { OwnerMenu } from '@/components/owner/OwnerMenu';
import { OwnerExpenses, OwnerMore, OwnerStock } from '@/components/owner/OwnerMore';
import { OwnerCompare, OwnerTransfers } from '@/components/owner/OwnerBranches';
import { OwnerApprovals, OwnerCustomers, OwnerDelivery, OwnerKitchen, OwnerProfile, OwnerStaff } from '@/components/owner/OwnerOps';
import { OwnerDevices, OwnerProfit, OwnerSwitches } from '@/components/owner/OwnerAdmin';
import { OfflineBanner, PermissionDenied } from '@/components/owner/ownerUi';
import { getBranches } from '@/lib/store';
import { isBranchAllowed } from '@/lib/branchAccess';

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid, to: OWNER_BASE, match: (p: string) => p === OWNER_BASE || p === `${OWNER_BASE}/` || p.startsWith(`${OWNER_BASE}/branch`) || p.startsWith(`${OWNER_BASE}/compare`) },
  { key: 'orders', label: 'Orders', icon: ReceiptText, to: `${OWNER_BASE}/orders`, match: (p: string) => p.startsWith(`${OWNER_BASE}/orders`) },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, to: `${OWNER_BASE}/menu`, match: (p: string) => p.startsWith(`${OWNER_BASE}/menu`) },
  { key: 'reports', label: 'Reports', icon: BarChart3, to: `${OWNER_BASE}/reports`, match: (p: string) => p.startsWith(`${OWNER_BASE}/reports`) },
  { key: 'more', label: 'More', icon: MenuIcon, to: `${OWNER_BASE}/more`, match: (p: string) => /^\/owner-app\/(more|stock|expenses|transfers|approvals|kitchen|delivery|customers|staff|profile|profit|switches|devices)/.test(p) },
] as const;

export default function OwnerAppPage({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, can, allowed } = useMemo(() => ownerAppAccess(), []);
  // OWN-24 — the owner's choice of look, kept on this phone.
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('owner-theme') === 'dark'; } catch { return false; } });
  const chooseDark = (v: boolean) => { setDark(v); try { localStorage.setItem('owner-theme', v ? 'dark' : 'light'); } catch { /* lasts this session */ } };
  // OWN-23 — offline: what is on screen is the last data this phone loaded.
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  /** A screen the account may not open says so, instead of quietly going somewhere else (OWN-23). */
  const guard = (ok: boolean, what: string, el: ReactElement) => ok ? el : <PermissionDenied what={what} onBack={() => navigate(OWNER_BASE)} />;
  const canReports = can('reports') || can('owner-management');
  // v1.87.0 — comparing and moving stock need two branches or more.
  const multi = getBranches().filter(b => b.isActive !== false).length > 1;
  const tabs = TABS.filter(t => (t.key === 'menu' ? can('menu') : t.key === 'reports' ? canReports : true));

  if (!allowed) {
    return (
      <div className="dt-owner flex min-h-screen items-center justify-center p-6" data-testid="owner-app-blocked" data-theme={dark ? 'dark' : 'light'}>
        <div className="max-w-sm space-y-4 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary p-3 text-primary-foreground"><DtMark size={36} title={null} /></div>
          <h1 className="text-[22px] font-extrabold">DT Owner</h1>
          <p className="text-[15px] text-muted-foreground">
            {user && (user.role === 'admin' || user.role === 'manager')
              ? 'The Owner app is not part of this restaurant’s plan yet. Ask Digital Target to switch it on.'
              : 'The Owner app is for the owner and managers. Sign in with an owner or manager account.'}
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => navigate('/')} className="rounded-2xl bg-primary py-3 text-[15px] font-bold text-primary-foreground">Open the software</button>
            <button type="button" onClick={onLogout} className="rounded-2xl border bg-card py-3 text-[15px] font-semibold">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  const nav = (
    <nav aria-label="Owner app" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] min-[820px]:inset-y-0 min-[820px]:left-0 min-[820px]:right-auto min-[820px]:w-[96px] min-[820px]:border-r min-[820px]:border-t-0 min-[820px]:pb-0">
      <div className="hidden items-center justify-center py-5 min-[820px]:flex">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary p-2 text-primary-foreground"><DtMark size={26} title={null} /></div>
      </div>
      <ul className="mx-auto flex max-w-[560px] min-[820px]:flex-col min-[820px]:gap-1">
        {tabs.map(t => {
          const on = t.match(location.pathname);
          return (
            <li key={t.key} className="flex-1">
              <button type="button" onClick={() => navigate(t.to)} aria-current={on ? 'page' : undefined} data-testid={`own-tab-${t.key}`}
                className={cn('flex w-full flex-col items-center gap-1 py-2.5 text-[12px] font-semibold', on ? 'text-primary' : 'text-muted-foreground')}>
                <t.icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.4 : 1.8} />
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="dt-owner min-h-screen" data-testid="owner-app" data-theme={dark ? 'dark' : 'light'}>
      <main className="mx-auto w-full max-w-[560px] px-4 pb-28 pt-[max(0.5rem,env(safe-area-inset-top))] min-[820px]:max-w-[1100px] min-[820px]:pb-10 min-[820px]:pl-[124px] min-[820px]:pr-8">
        {!online && <div className="pb-3 pt-1"><OfflineBanner /></div>}
        <Routes>
          <Route path="/" element={<OwnerOverview caps={{ approvals: can('online-approval'), stock: can('inventory') }} />} />
          <Route path="/branch/:id" element={<OwnerBranch caps={{ targets: can('branches'), stock: can('inventory'), by: user?.name || '' }} />} />
          {multi && <Route path="/compare" element={<OwnerCompare />} />}
          {multi && <Route path="/transfers" element={<OwnerTransfers caps={{ can: id => isBranchAllowed(id), stock: can('inventory'), by: user?.name || '' }} />} />}
          <Route path="/orders" element={<OwnerOrders />} />
          <Route path="/orders/:id" element={<OwnerOrderDetail />} />
          <Route path="/reports" element={guard(canReports, 'Reports', <OwnerReports />)} />
          <Route path="/menu" element={guard(can('menu'), 'Menu', <OwnerMenu />)} />
          <Route path="/more" element={<OwnerMore caps={{ can, userName: user?.name || '', role: user?.role || '', onLogout, multiBranch: multi }} />} />
          <Route path="/stock" element={guard(can('inventory'), 'Inventory', <OwnerStock />)} />
          <Route path="/expenses" element={guard(can('accounts'), 'Expenses', <OwnerExpenses userName={user?.name || ''} />)} />
          {/* v1.90.0 — the operations screens (OWN-08/09/10/16/17/22), each behind its module's permission */}
          <Route path="/approvals" element={guard(can('online-approval'), 'Online approvals', <OwnerApprovals by={{ userId: user?.id, userName: user?.name }} />)} />
          <Route path="/kitchen" element={guard(can('kitchen'), 'Kitchen', <OwnerKitchen />)} />
          <Route path="/delivery" element={guard(can('delivery'), 'Delivery and riders', <OwnerDelivery />)} />
          <Route path="/customers" element={guard(can('customers') || can('credits'), 'Customers and credit', <OwnerCustomers credit={can('credits')} />)} />
          <Route path="/staff" element={guard(can('hr') || can('users'), 'Staff', <OwnerStaff />)} />
          {/* v1.91.0 — OWN-12 / OWN-20 / OWN-21 */}
          <Route path="/profit" element={guard(can('financials'), 'Profit', <OwnerProfit />)} />
          <Route path="/switches" element={guard(can('online-portal'), 'Website and app switches', <OwnerSwitches />)} />
          <Route path="/devices" element={guard(can('devices'), 'Devices', <OwnerDevices />)} />
          <Route path="/profile" element={<OwnerProfile userName={user?.name || ''} role={user?.role || ''} onLogout={onLogout} dark={dark} onDark={chooseDark} />} />
          <Route path="*" element={<Navigate to={OWNER_BASE} replace />} />
        </Routes>
      </main>
      {nav}
    </div>
  );
}
