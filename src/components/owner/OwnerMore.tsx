// ============================================================
// OWNER APP — More (OWN-19), Low stock (OWN-14) and Expenses (OWN-15), v1.86.0
//
// More lists what this account may open — the permission system decides every row. Low stock shows what is about
// to run out and who last delivered it. Expenses records a cost on the spot, as the same record Accounts → Expense
// saves, and shows where the month's money went.
// ============================================================
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Bike, Boxes, ChefHat, ChevronRight, CircleCheck, Globe, IdCard, LayoutDashboard, LogOut, Phone, Plus,
  Receipt, Settings, Smartphone, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';
import {
  genId, getAccountCategories, getInventory, getOrders, getParties, getReceivingEntries, getSettings, getTransactions,
  saveAccountCategory, saveTransaction,
} from '@/lib/store';
import { buildExpense, localYmd, lowStockRows, monthExpenses } from '@/lib/ownerApp';
import { resolveRestaurantIdentity } from '@/lib/restaurantIdentity';
import { cn } from '@/lib/utils';
import { Badge, Bar, Card, Empty, Label, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useLiveTick } from './ownerHooks';

export interface MoreCaps { can: (pageKey: string) => boolean; userName: string; role: string; onLogout: () => void }

function Row({ icon: Icon, label, to, onClick, badge, testId }: { icon: typeof Bike; label: string; to?: string; onClick?: () => void; badge?: ReactNode; testId?: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid={testId} onClick={onClick || (() => to && navigate(to))} className="flex w-full items-center gap-3 border-b px-1 py-3.5 text-left text-[15.5px] last:border-0">
      <Icon className="h-5 w-5 shrink-0 text-foreground/80" />
      <span className="flex-1">{label}</span>
      {badge}
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

export function OwnerMore({ caps }: { caps: MoreCaps }) {
  const tick = useLiveTick(['orders']);
  const approvals = useMemo(() => (caps.can('online-approval') ? getOrders().filter(o => o.status === 'pending_approval').length : 0), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = getSettings();
  // The workspace code staff type into the apps — the same resolver the header chip and Settings use.
  const [workspaceCode, setWorkspaceCode] = useState<string | undefined>();
  useEffect(() => { let off = false; resolveRestaurantIdentity().then(id => { if (!off) setWorkspaceCode(id.workspaceCode || undefined); }).catch(() => { /* offline */ }); return () => { off = true; }; }, []);
  const initials = (caps.userName || caps.role || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const ops = [
    caps.can('delivery') && <Row key="d" icon={Bike} label="Delivery and riders" to="/delivery" />,
    caps.can('kitchen') && <Row key="k" icon={ChefHat} label="Kitchen" to="/kitchen" />,
    caps.can('online-approval') && <Row key="a" icon={CircleCheck} label="Online approvals" to="/online-approval" badge={approvals > 0 ? <Badge tone="warning">{approvals}</Badge> : undefined} />,
  ].filter(Boolean);
  const money = [
    (caps.can('customers') || caps.can('credits')) && <Row key="c" icon={Users} label="Customers and credit" to={caps.can('credits') ? '/credits' : '/customers'} />,
    (caps.can('hr') || caps.can('users')) && <Row key="s" icon={IdCard} label="Staff" to={caps.can('hr') ? '/hr' : '/users'} />,
    caps.can('accounts') && <Row key="e" icon={Receipt} label="Expenses" to={`${OWNER_BASE}/expenses`} testId="own-more-expenses" />,
    caps.can('inventory') && <Row key="i" icon={Boxes} label="Inventory and low stock" to={`${OWNER_BASE}/stock`} testId="own-more-stock" />,
  ].filter(Boolean);
  const admin = [
    caps.can('online-portal') && <Row key="w" icon={Globe} label="Website and app switches" to="/online-portal" />,
    caps.can('devices') && <Row key="v" icon={Smartphone} label="Devices" to="/devices" />,
    caps.can('settings') && <Row key="t" icon={Settings} label="Settings" to="/settings" />,
    <Row key="f" icon={LayoutDashboard} label="Open the full software" to="/dashboard" />,
  ].filter(Boolean);

  return (
    <div className="space-y-4" data-testid="owner-more">
      <ScreenHeader title="More" />
      <Card className="flex items-center gap-3.5">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-muted text-[18px] font-extrabold text-primary">{initials || '?'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold">{caps.userName || caps.role}</div>
          <div className="truncate text-[13px] text-muted-foreground">{[settings.name, workspaceCode].filter(Boolean).join(' · ')}</div>
        </div>
        <Badge tone="accent" className="capitalize">{caps.role}</Badge>
      </Card>
      {ops.length > 0 && <div><Label>Operations</Label><Card className="py-1">{ops}</Card></div>}
      {money.length > 0 && <div><Label>People and money</Label><Card className="py-1">{money}</Card></div>}
      <div><Label>Admin</Label><Card className="py-1">{admin}</Card></div>
      <button type="button" onClick={caps.onLogout} className="flex w-full items-center justify-center gap-2 rounded-2xl border bg-card py-3.5 text-[15px] font-semibold text-[hsl(var(--own-bad))]">
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </div>
  );
}

export function OwnerStock() {
  const tick = useLiveTick(['inventory', 'receivingEntries', 'parties']);
  const rows = useMemo(() => lowStockRows(getInventory(), getReceivingEntries(), getParties()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3" data-testid="owner-stock">
      <ScreenHeader title="Low stock" back={OWNER_BASE} />
      {rows.length === 0 ? <Empty>Everything is above its reorder level.</Empty> : (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[14.5px] font-semibold text-[hsl(var(--own-warn))]" data-testid="own-stock-banner">
            <AlertTriangle className="h-5 w-5 shrink-0" /> {rows.length} item{rows.length === 1 ? ' is' : 's are'} at or below the reorder level.
          </div>
          <div className="space-y-2.5" data-testid="own-stock-list">
            {rows.map(r => (
              <Card key={r.id} className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[15.5px] font-bold">{r.name}{r.unit && ` (${r.unit})`}</div>
                  <div className="shrink-0 text-[15px] tabular-nums"><b className="text-[hsl(var(--own-bad))]">{r.qty}</b><span className="text-[hsl(var(--own-bad))]"> / {r.min}</span></div>
                </div>
                <Bar value={r.level * 100} />
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13.5px] text-muted-foreground">{r.supplier?.name || 'No supplier recorded yet'}</span>
                  {r.supplier?.phone && (
                    <a href={`tel:${r.supplier.phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border bg-card px-3.5 text-[14px] font-semibold" aria-label={`Call ${r.supplier.name}`}>
                      <Phone className="h-4 w-4" /> Call
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">The supplier is the one who last delivered the item (Receiving). Stock adjustments and purchasing stay in the full software.</p>
    </div>
  );
}

export function OwnerExpenses({ userName }: { userName: string }) {
  const tick = useLiveTick(['transactions', 'accountCategories']);
  // Re-read after this screen saves (version) as well as when another device changes the rows (tick).
  const [version, bump] = useState(0);
  const month = useMemo(() => monthExpenses(getTransactions(), new Date()), [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const categories = useMemo(() => getAccountCategories().filter(c => c.type === 'expense'), [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', categoryId: '', note: '', date: localYmd(), paymentMethod: 'cash' });
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const cats = getAccountCategories();
    let categoryId = form.categoryId;
    if (!categoryId && newCat.trim()) {
      const existing = cats.find(c => c.type === 'expense' && c.name.trim().toLowerCase() === newCat.trim().toLowerCase());
      if (existing) categoryId = existing.id;
      else {
        const c = { id: genId(), name: newCat.trim(), type: 'expense' as const };
        try { saveAccountCategory(c); } catch { setError('Could not save — check the connection and try again'); return; }
        categoryId = c.id;
      }
    }
    const built = buildExpense({ ...form, categoryId }, getAccountCategories(), { id: genId(), createdBy: userName, today: localYmd() });
    if (!built.ok) { setError(built.error); return; }
    try {
      saveTransaction(built.txn);
    } catch {
      setError('Could not save — check the connection and try again');
      return;
    }
    toast.success(`Expense added: ${rs(built.txn.amount)}`);
    setOpen(false);
    setError('');
    setNewCat('');
    setForm({ amount: '', categoryId: '', note: '', date: localYmd(), paymentMethod: 'cash' });
    bump(x => x + 1);
  };

  return (
    <div className="space-y-3 pb-20" data-testid="owner-expenses">
      <ScreenHeader title="Expenses" back={OWNER_BASE} />
      <Card className="bg-muted">
        <div className="text-[13.5px] text-muted-foreground">{month.month}</div>
        <div className="text-[30px] font-extrabold tabular-nums tracking-tight" data-testid="own-expense-total">{rs(month.total)}</div>
      </Card>
      {month.days.length === 0 ? <Empty>No expenses this month</Empty> : (
        <div className="space-y-4" data-testid="own-expense-list">
          {month.days.map(d => (
            <div key={d.key}>
              <Label right={rs(d.total)}>{d.label}</Label>
              <div className="space-y-2.5">
                {d.rows.map(t => (
                  <Card key={t.id} className="flex items-center gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15.5px] font-bold">{t.description || t.categoryName || 'Expense'}</div>
                      <div className="truncate text-[13px] text-muted-foreground">{[t.description ? t.categoryName : '', t.paymentMethod !== 'cash' ? String(t.paymentMethod) : '', t.createdBy].filter(Boolean).join(' · ') || d.label}</div>
                    </div>
                    <div className="shrink-0 text-[15.5px] font-extrabold tabular-nums">{rs(t.amount)}</div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[560px] px-4 md:bottom-6">
        <button type="button" onClick={() => { setOpen(true); setError(''); }} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-bold text-primary-foreground shadow-lg" data-testid="own-add-expense">
          <Plus className="h-5 w-5" /> Add expense
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" role="dialog" aria-modal="true" aria-label="Add expense">
          <div className="w-full max-w-[560px] space-y-3 rounded-t-3xl bg-background p-5 md:rounded-3xl" data-testid="own-expense-sheet">
            <div className="flex items-center justify-between">
              <h2 className="text-[19px] font-extrabold">Add expense</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl border bg-card"><X className="h-5 w-5" /></button>
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[14px] font-semibold text-[hsl(var(--own-bad))]" role="alert">{error}</div>}
            <label className="block text-[13px] font-semibold text-muted-foreground">Amount
              <input inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="e.g. 1500" aria-label="Amount" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[18px] font-bold tabular-nums text-foreground outline-none" />
            </label>
            {categories.length > 0 ? (
              <label className="block text-[13px] font-semibold text-muted-foreground">Category
                <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))} aria-label="Category" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold text-foreground">
                  <option value="">Choose…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="block text-[13px] font-semibold text-muted-foreground">Category (first one — e.g. Utilities)
                <input value={newCat} onChange={e => setNewCat(e.target.value)} aria-label="New category" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[15px] text-foreground outline-none" />
              </label>
            )}
            <label className="block text-[13px] font-semibold text-muted-foreground">Note
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. Gas cylinders" aria-label="Note" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[15px] text-foreground outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[13px] font-semibold text-muted-foreground">Date
                <input type="date" value={form.date} max={localYmd()} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} aria-label="Date" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[15px] text-foreground" />
              </label>
              <label className="block text-[13px] font-semibold text-muted-foreground">Paid by
                <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} aria-label="Paid by" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold text-foreground">
                  <option value="cash">Cash</option><option value="card">Card</option><option value="online">Online</option>
                </select>
              </label>
            </div>
            <button type="button" onClick={save} className={cn('h-13 flex w-full items-center justify-center rounded-2xl bg-primary py-3.5 text-[16px] font-bold text-primary-foreground')} data-testid="own-save-expense">Save expense</button>
          </div>
        </div>
      )}
    </div>
  );
}
