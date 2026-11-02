// ============================================================
// OWNER APP — Overview (OWN-04) and Branch detail (OWN-05), v1.86.0
//
// "Which of my branches is doing what, right now?" Five figures for the business, then every branch side by side
// with its share of the business; a branch opens hour by hour with its payment split, order types and open bills.
// Read-only: every figure comes from lib/ownerApp.ts (the arithmetic Owner Management uses on the desktop).
// ============================================================
import { useMemo, useState } from 'react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { AlertTriangle, Banknote, BellRing, ChevronRight, Clock, Receipt, TrendingUp, Wallet, XCircle } from 'lucide-react';
import { useNavigate, useParams } from '@/lib/hash-router';
import { getBranches, getInventory, getOrders, getSettings } from '@/lib/store';
import {
  UNASSIGNED, branchFigures, lowStockRows, moneySeries, ofBranch, openNowList, orderBadge, orderSubtitle, orderTitle,
  paymentSplit, rangeOf, typeSplit, type RangePreset,
} from '@/lib/ownerApp';
import { cn } from '@/lib/utils';
import { Badge, Bar, Card, Empty, IconButton, Label, PresetChips, ScreenHeader } from './ownerUi';
import { BranchStaffPanel, BranchStockPanel, BranchTargetsPanel, BranchTillsPanel } from '@/components/branches/BranchPanels';
import { TransferList } from '@/components/branches/Transfers';
import { OWNER_BASE, rs, useBranchVisibility, useLiveTick } from './ownerHooks';

const SPLIT_COLOURS = ['hsl(var(--primary))', 'hsl(173 80% 26%)', 'hsl(17 88% 40%)', 'hsl(224 76% 48%)', 'hsl(330 65% 45%)'];

export interface OwnerCaps { approvals: boolean; stock: boolean }

function Tile({ icon: Icon, label, value, tone, testId, wide }: { icon: typeof Banknote; label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; testId: string; wide?: boolean }) {
  return (
    <Card className={cn('min-w-0 px-4 py-3.5', wide && 'flex items-center justify-between gap-3 py-3 lg:block lg:py-3.5')} data-testid={testId}>
      <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground"><Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{label}</span></div>
      <div className={cn('truncate font-extrabold tabular-nums tracking-tight', wide ? 'text-[20px] lg:mt-1 lg:text-[24px]' : 'mt-1 text-[24px]',
        tone === 'ok' && 'text-[hsl(var(--own-ok))]', tone === 'warn' && 'text-[hsl(var(--own-warn))]', tone === 'bad' && 'text-[hsl(var(--own-bad))]')}
      data-testid={`${testId}-value`}>{value}</div>
    </Card>
  );
}

export function OwnerOverview({ caps }: { caps: OwnerCaps }) {
  const navigate = useNavigate();
  const tick = useLiveTick(['orders', 'branches', 'inventory']);
  const [preset, setPreset] = useState<RangePreset>('today');
  const vis = useBranchVisibility();
  const orders = useMemo(() => getOrders(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const branches = useMemo(() => getBranches(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = getSettings();
  const { rows, totals } = useMemo(() => branchFigures(orders, branches, rangeOf(preset), vis), [orders, branches, preset, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const approvals = caps.approvals ? orders.filter(o => o.status === 'pending_approval' && (!o.branchId || vis.allowed(String(o.branchId)))).length : 0;
  const low = useMemo(() => (caps.stock ? lowStockRows(getInventory()).length : 0), [tick, caps.stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  // A restaurant that never set up branches is one place: its bills carry no branch, and the card is the restaurant.
  const nameOf = (r: (typeof rows)[number]) => (r.unassigned && branches.length === 0 ? settings.name || 'Your restaurant' : r.name);

  return (
    <div className="space-y-4" data-testid="owner-overview">
      <ScreenHeader
        sub={greeting}
        title={settings.name || 'Your restaurant'}
        right={caps.approvals ? <IconButton label="Online approvals" badge={approvals} onClick={() => navigate(`${OWNER_BASE}/approvals`)}><BellRing className="h-5 w-5" /></IconButton> : undefined}
      />
      <PresetChips value={preset} onChange={setPreset} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile icon={TrendingUp} label="Money taken" value={rs(totals.revenue)} tone="ok" testId="own-kpi-revenue" />
        <Tile icon={Receipt} label="Bills" value={String(totals.bills)} testId="own-kpi-bills" />
        <Tile icon={Wallet} label="Still owed" value={rs(totals.owed)} tone={totals.owed > 0 ? 'warn' : undefined} testId="own-kpi-owed" />
        <Tile icon={Clock} label="Open now" value={String(totals.openNow)} tone={totals.openNow > 0 ? 'warn' : undefined} testId="own-kpi-open" />
        <div className="col-span-2 lg:col-span-1">
          <Tile icon={XCircle} label="Void / cancelled" value={String(totals.voided)} tone={totals.voided > 0 ? 'bad' : undefined} testId="own-kpi-void" wide />
        </div>
      </div>

      {(approvals > 0 || low > 0) && (
        <div className="space-y-2" data-testid="own-shortcuts">
          {approvals > 0 && (
            <button type="button" onClick={() => navigate(`${OWNER_BASE}/approvals`)} className="flex w-full items-center gap-3 rounded-2xl border border-[hsl(var(--own-warn)/.35)] bg-[hsl(var(--own-warn-bg))] px-4 py-3 text-left text-[14px] font-semibold text-[hsl(var(--own-warn))]">
              <BellRing className="h-4 w-4 shrink-0" /><span className="flex-1">{approvals} online order{approvals === 1 ? '' : 's'} waiting for approval</span><ChevronRight className="h-4 w-4" />
            </button>
          )}
          {low > 0 && (
            <button type="button" onClick={() => navigate(`${OWNER_BASE}/stock`)} className="flex w-full items-center gap-3 rounded-2xl border border-[hsl(var(--own-bad)/.3)] bg-[hsl(var(--own-bad-bg))] px-4 py-3 text-left text-[14px] font-semibold text-[hsl(var(--own-bad))]">
              <AlertTriangle className="h-4 w-4 shrink-0" /><span className="flex-1">{low} item{low === 1 ? ' is' : 's are'} at or below the reorder level</span><ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div>
        <Label right={branches.length > 1
          ? <button type="button" onClick={() => navigate(`${OWNER_BASE}/compare`)} className="font-semibold text-primary" data-testid="own-compare-link">Compare {rows.length} branches</button>
          : `${rows.length} ${branches.length === 0 ? 'place' : 'branch'}`}>By branch</Label>
        {rows.length === 0 ? (
          <Empty>No branches set up yet — add them in Settings → Branches.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="own-branches">
            {rows.map(r => (
              <button key={r.id} type="button" onClick={() => navigate(`${OWNER_BASE}/branch/${encodeURIComponent(r.id)}`)} className="text-left" data-testid={`own-branch-${r.id}`}>
                <Card className="space-y-3 p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 truncate text-[16px] font-bold">{nameOf(r)}</div>
                    {r.openNow > 0 && <Badge tone="warning">{r.openNow} open now</Badge>}
                  </div>
                  <div className="grid grid-cols-[1.4fr_0.8fr_1fr] gap-2">
                    <div className="min-w-0"><div className="text-[13px] text-muted-foreground">Money taken</div><div className="truncate text-[20px] font-extrabold tabular-nums">{rs(r.revenue)}</div></div>
                    <div><div className="text-[13px] text-muted-foreground">Bills</div><div className="text-[20px] font-extrabold tabular-nums">{r.bills}</div></div>
                    <div className="min-w-0 text-right"><div className="text-[13px] text-muted-foreground">Still owed</div><div className={cn('truncate text-[20px] font-extrabold tabular-nums', r.owed > 0 && 'text-[hsl(var(--own-warn))]')}>{rs(r.owed)}</div></div>
                  </div>
                  <Bar value={r.share} />
                  <div className="text-[13px] text-muted-foreground">
                    {r.share}% of the business{r.voided > 0 && ` · ${r.voided} void / cancelled`}
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">
        Money taken counts paid bills and part-payments; still owed is the unpaid part of part-paid and credit bills. Void,
        complimentary and cancelled bills are never added to the takings. The same figures as Owner Management on the
        desktop.
      </p>
    </div>
  );
}

export interface BranchCaps { targets: boolean; stock: boolean; by: string }
type BranchTab = 'today' | 'stock' | 'staff' | 'tills' | 'targets' | 'transfers';
const BRANCH_TABS: { id: BranchTab; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'stock', label: 'Stock' }, { id: 'staff', label: 'Staff' },
  { id: 'tills', label: 'Tills' }, { id: 'targets', label: 'Targets' }, { id: 'transfers', label: 'Transfers' },
];

export function OwnerBranch({ caps = { targets: false, stock: false, by: '' } }: { caps?: BranchCaps }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<BranchTab>('today');
  const { id = '' } = useParams<{ id: string }>();
  const branchId = decodeURIComponent(id);
  const tick = useLiveTick(['orders', 'branches']);
  const [preset, setPreset] = useState<RangePreset>('today');
  const vis = useBranchVisibility();
  const branches = useMemo(() => getBranches(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const settings = getSettings();
  const mine = useMemo(() => ofBranch(getOrders(), branchId), [tick, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const range = rangeOf(preset);
  const series = useMemo(() => moneySeries(mine, range, preset), [mine, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = useMemo(() => paymentSplit(mine, range), [mine, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const types = useMemo(() => typeSplit(mine, range), [mine, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => openNowList(mine), [mine]);
  const total = series.reduce((s, p) => s + p.value, 0);
  const allowed = branchId === UNASSIGNED ? vis.showUnassigned : vis.allowed(branchId);
  const name = branchId === UNASSIGNED ? (branches.length === 0 ? settings.name || 'Your restaurant' : 'No branch recorded') : branches.find(b => b.id === branchId)?.name || 'Unknown branch';
  const single = preset === 'today' || preset === 'yesterday';

  if (!allowed) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="Branch" back={OWNER_BASE} />
        <Empty>This branch is not part of your account.</Empty>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="owner-branch">
      <ScreenHeader title={name} back={OWNER_BASE} />
      {/* v1.87.0 — the branch, A to Z: today's trading, its stock, staff, tills, targets and stock transfers. */}
      {branchId !== UNASSIGNED && (
        <div role="tablist" aria-label="Branch" className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1" data-testid="own-branch-tabs">
          {BRANCH_TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-own-chip onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
      )}
      {tab === 'stock' && <BranchStockPanel branchId={branchId} />}
      {tab === 'staff' && <BranchStaffPanel branchId={branchId} />}
      {tab === 'tills' && <BranchTillsPanel branchId={branchId} />}
      {tab === 'targets' && <BranchTargetsPanel branchId={branchId} canEdit={caps.targets} by={caps.by} />}
      {tab === 'transfers' && <TransferList caps={{ can: id => vis.allowed(id), stock: caps.stock, by: caps.by }} branchId={branchId} compact />}
      {tab === 'today' && <>
      <PresetChips value={preset} onChange={setPreset} />

      <Card>
        <div className="text-[13.5px] text-muted-foreground">{single ? 'Sales by hour' : 'Sales'}</div>
        <div className="text-[26px] font-extrabold tabular-nums tracking-tight" data-testid="own-branch-total">{rs(total)}</div>
        {series.length === 0 || total === 0 ? (
          <div className="mt-3"><Empty>No sales in this period</Empty></div>
        ) : (
          <div className="mt-2 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="own-branch-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <Tooltip formatter={(v: number) => rs(v)} labelFormatter={l => (single ? `${l}:00` : String(l))} />
                <Area type="linear" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#own-branch-fill)" dot={{ r: 3, fill: 'hsl(var(--primary))', strokeWidth: 0 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="own-scroll-x -mx-4 flex gap-3 px-4 md:mx-0 md:grid md:grid-cols-2 md:px-0">
        <Card className="min-w-[260px] flex-1">
          <div className="mb-2 text-[13.5px] text-muted-foreground">Payment</div>
          {pay.length === 0 ? <div className="py-6 text-center text-[13px] text-muted-foreground">No payments in this period</div> : (
            <div className="flex items-center gap-4" data-testid="own-branch-pay">
              <div className="h-[96px] w-[96px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pay} dataKey="amount" innerRadius="62%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                      {pay.map((p, i) => <Cell key={p.key} fill={SPLIT_COLOURS[i % SPLIT_COLOURS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5 text-[14px]">
                {pay.map((p, i) => (
                  <li key={p.key} className="flex items-center gap-2" title={rs(p.amount)}>
                    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: SPLIT_COLOURS[i % SPLIT_COLOURS.length] }} />
                    <span className="flex-1 truncate">{p.name}</span><span className="font-bold tabular-nums">{p.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card className="min-w-[220px] flex-1">
          <div className="mb-2 text-[13.5px] text-muted-foreground">Order type</div>
          {types.length === 0 ? <div className="py-6 text-center text-[13px] text-muted-foreground">No sales in this period</div> : (
            <ul className="space-y-2.5" data-testid="own-branch-types">
              {types.map(t => (
                <li key={t.key}>
                  <div className="flex justify-between text-[14px]"><span>{t.name}</span><span className="tabular-nums text-muted-foreground">{t.pct}%</span></div>
                  <Bar value={t.pct} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div>
        <Label>Open now ({open.length})</Label>
        {open.length === 0 ? <Empty>Nothing is open in this branch right now.</Empty> : (
          <div className="space-y-2.5" data-testid="own-branch-open">
            {open.map(o => {
              const b = orderBadge(o);
              return (
                <button key={o.id} type="button" onClick={() => navigate(`${OWNER_BASE}/orders/${encodeURIComponent(o.id)}`)} className="block w-full text-left">
                  <Card className="flex items-center gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-bold">{orderTitle(o)}</div>
                      <div className="truncate text-[13px] text-muted-foreground">{orderSubtitle(o)}</div>
                    </div>
                    <Badge tone={b.tone}>{b.label}</Badge>
                    <div className="shrink-0 text-[15px] font-extrabold tabular-nums">{rs(o.grandTotal)}</div>
                  </Card>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
