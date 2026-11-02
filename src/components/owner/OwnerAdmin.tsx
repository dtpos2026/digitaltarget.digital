// ============================================================
// OWNER APP — Profit (OWN-12), Website and app switches (OWN-20), Devices (OWN-21), v1.91.0
//
// The last rows of More that opened the till's full pages. Rules: lib/ownerAdmin.ts. Profit reads the same engine as the
// till's Financial Statements (lib/financials.ts), so the two never disagree; the switches write the same settings as the
// Customer Portal page; devices write the same table as the Devices page, through lib/ownerCloud.ts.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Copy, ExternalLink, Globe, Monitor, Share2, ShieldCheck, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAccountCategories, getBranches, getCreditPayments, getInventory, getOrders, getPayslips, getRecipes, getSettings, getTransactions,
  getWastages, saveSettings,
} from '@/lib/store';
import { buildProfitAndLoss, defaultExcludedCategories } from '@/lib/financials';
import { rangeOf, PRESETS, type RangePreset } from '@/lib/ownerApp';
import {
  SWITCHES, approvalMode, canActOn, groupDevices, portalLinks, profitView, switchDisabled, switchOn,
  type ApprovalChoice, type DeviceAction, type SwitchDef,
} from '@/lib/ownerAdmin';
import { actOnDevice } from '@/lib/ownerCloud';
import { loadDevices, clearBranchCloudCache } from '@/lib/branchCloud';
import type { DeviceRow } from '@/lib/branchHub';
import { getTenantId, getDeviceId } from '@/lib/tenant';
import { authorizedBranchIds, filterAllowedBranches, hasAllBranchAccess } from '@/lib/branchAccess';
import { cn } from '@/lib/utils';
import { Badge, Bar, Card, Empty, Label, PresetChips, RetryBanner, ScreenHeader, Skeletons } from './ownerUi';
import { OWNER_BASE, rs, useBranchVisibility, useLiveTick } from './ownerHooks';

// ------------------------------------------------------------------ OWN-12
export function OwnerProfit() {
  const tick = useLiveTick(['orders', 'transactions', 'wastages', 'recipes', 'inventory', 'payslips']);
  const [preset, setPreset] = useState<RangePreset>('month');
  const branches = useMemo(() => filterAllowedBranches(getBranches()).filter(b => b.isActive !== false), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // An owner sees the whole business; a manager limited to some branches only ever sees those, one at a time.
  useBranchVisibility();   // re-render once the branch access has loaded
  // Same rule as everywhere else: unrestricted when the account is an all-branch one, or no restriction is known.
  const all = hasAllBranchAccess() || authorizedBranchIds() === null;
  // null = the owner has not chosen yet: the whole business for an owner, the first allowed branch for a limited manager.
  const [choice, setChoice] = useState<string | null>(null);
  const branch = all ? (choice === null || choice === 'all' ? null : choice) : (choice && branches.some(b => b.id === choice) ? choice : branches[0]?.id || null);

  const view = useMemo(() => {
    const r = rangeOf(preset);
    const categories = getAccountCategories();
    const payslips = getPayslips();
    const input = { orders: getOrders(), transactions: getTransactions(), wastages: getWastages(), payslips, recipes: getRecipes(), inventory: getInventory(), creditPayments: getCreditPayments() };
    const pnl = buildProfitAndLoss(input, { fromMs: r.from.getTime(), toMs: r.to.getTime() + 1 }, {
      branchId: branch, excludeExpenseCategoryIds: defaultExcludedCategories(categories, payslips.length > 0),
    });
    return profitView(pnl);
  }, [preset, branch, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...view.bars.map(b => Math.abs(b.value)));
  const TONE: Record<string, string> = { revenue: 'bg-primary', cost: 'bg-[hsl(var(--own-warn))]', expenses: 'bg-[hsl(var(--own-info))]', profit: 'bg-[hsl(var(--own-ok))]' };

  return (
    <div className="space-y-3" data-testid="owner-profit">
      <ScreenHeader title="Profit and expenses" back={`${OWNER_BASE}/reports`} />
      <PresetChips value={preset} onChange={setPreset} presets={PRESETS} />
      {(all ? branches.length > 1 : branches.length > 0) && (
        <div className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1" role="tablist" aria-label="Branch">
          {all && <button type="button" role="tab" aria-selected={branch === null} data-own-chip onClick={() => setChoice('all')}>All branches</button>}
          {branches.map(b => <button key={b.id} type="button" role="tab" aria-selected={branch === b.id} data-own-chip onClick={() => setChoice(b.id)}>{b.name}</button>)}
        </div>
      )}

      {view.state === 'empty' ? <Empty>No data for this period.</Empty> : (
        <>
          {view.state !== 'complete' && (
            <div role="status" data-testid="own-profit-incomplete" className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--own-warn)/.35)] bg-[hsl(var(--own-warn-bg))] px-4 py-3 text-[14px] font-semibold text-[hsl(var(--own-warn))]">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                Costs incomplete.{' '}
                {view.state === 'unknown'
                  ? 'None of the items sold has a recipe, so the cost of food is missing and no profit is shown.'
                  : `${view.coverage}% of item sales have a recipe; the profit below is at most this much, and the real one is lower.`}
                {' '}Add recipes in Stock → Recipes.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5" data-testid="own-profit-tiles">
            <Card><div className="text-[13px] text-muted-foreground">Revenue</div><div className="text-[21px] font-extrabold">{rs(view.revenue)}</div></Card>
            <Card><div className="text-[13px] text-muted-foreground">Cost of goods</div><div className="text-[21px] font-extrabold">{rs(view.costOfGoods)}</div></Card>
            <Card><div className="text-[13px] text-muted-foreground">Expenses</div><div className="text-[21px] font-extrabold">{rs(view.expenses)}</div></Card>
            <Card className={cn(view.profit != null && view.profit < 0 && 'border-[hsl(var(--own-bad))]')}>
              <div className="text-[13px] text-muted-foreground">{view.state === 'partial' ? 'Profit, at most' : 'Profit'}</div>
              <div className={cn('text-[21px] font-extrabold', view.profit == null ? 'text-muted-foreground' : view.profit < 0 ? 'text-[hsl(var(--own-bad))]' : 'text-[hsl(var(--own-ok))]')} data-testid="own-profit-value">
                {view.profit == null ? '—' : rs(view.profit)}
              </div>
              {view.margin != null && <div className="text-[12.5px] text-muted-foreground">{view.margin}% of revenue</div>}
            </Card>
          </div>
          <Card className="space-y-3" data-testid="own-profit-bars">
            {view.bars.map(b => (
              <div key={b.key} className="space-y-1">
                <div className="flex justify-between text-[13.5px]"><span className="text-muted-foreground">{b.label}</span><b className="tabular-nums">{rs(b.value)}</b></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', TONE[b.key])} style={{ width: `${Math.max(2, (Math.abs(b.value) / max) * 100)}%` }} /></div>
              </div>
            ))}
          </Card>
          {view.topExpenses.length > 0 && (
            <div>
              <Label>Biggest expenses</Label>
              <Card className="divide-y py-1" data-testid="own-profit-expenses">
                {view.topExpenses.map(e => (
                  <div key={e.label} className="py-3">
                    <div className="flex justify-between gap-3 text-[15px]"><span className="min-w-0 truncate font-semibold">{e.label}</span><b className="tabular-nums">{rs(e.amount)}</b></div>
                    <Bar value={e.share} className="mt-1.5" />
                  </div>
                ))}
              </Card>
            </div>
          )}
        </>
      )}
      <p className="px-1 text-[12px] text-muted-foreground">The same figures as Financial Statements at the till: sales by bill date, food cost from recipes at average cost, expenses without stock purchases (already in food cost). Not an accounting ledger.</p>
    </div>
  );
}

// ------------------------------------------------------------------ OWN-20
export function OwnerSwitches() {
  const tick = useLiveTick(['settings']);
  const [settings, setSettings] = useState(() => getSettings());
  useEffect(() => { setSettings(getSettings()); }, [tick]);
  const tid = getTenantId();
  const origin = typeof window !== 'undefined' && window.location.origin && !window.location.origin.startsWith('file:') ? window.location.origin : 'https://digitaltarget.digital';
  const links = useMemo(() => portalLinks(origin, tid), [origin, tid]);

  // A change is applied at once and put back, with a message, if it could not be saved.
  const change = (patch: Record<string, unknown>, label: string) => {
    const before = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    try { saveSettings(next); toast.success(label); }
    catch { setSettings(before); toast.error('Could not save. Nothing was changed.'); }
  };
  const toggle = (def: SwitchDef) => change({ [def.key]: !switchOn(settings, def.key) }, `${def.label} ${switchOn(settings, def.key) ? 'off' : 'on'}`);
  const mode = approvalMode(settings);
  const masterOn = switchOn(settings, 'onlineOrderEnabled');

  const copy = async (url: string, label: string) => {
    try { await navigator.clipboard.writeText(url); toast.success(`${label} link copied`); } catch { toast.error('Could not copy. Press and hold the link instead.'); }
  };
  const share = async (url: string, label: string) => {
    try {
      if (navigator.share) await navigator.share({ title: label, url });
      else await copy(url, label);
    } catch { /* closed the share sheet */ }
  };

  return (
    <div className="space-y-3" data-testid="owner-switches">
      <ScreenHeader title="Website and app switches" back={`${OWNER_BASE}/more`} />
      <Card className="flex items-center gap-3 py-3" data-testid="own-switch-status">
        <span className={cn('h-3 w-3 shrink-0 rounded-full', masterOn ? 'bg-[hsl(var(--own-ok))]' : 'bg-muted-foreground/40')} />
        <span className="flex-1 text-[15px] font-semibold">{masterOn ? 'Customers can order online' : 'Online ordering is stopped'}</span>
        <Badge tone={masterOn ? 'success' : 'neutral'}>{masterOn ? 'Live' : 'Off'}</Badge>
      </Card>
      <Card className="divide-y py-1" data-testid="own-switch-list">
        {SWITCHES.map(def => {
          const on = switchOn(settings, def.key);
          const off = switchDisabled(settings, def);
          return (
            <div key={def.key} className={cn('flex items-center gap-3 py-3.5', off && 'opacity-50')}>
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold">{def.label}</div>
                <div className="text-[13px] text-muted-foreground">{def.help}</div>
              </div>
              <button type="button" role="switch" aria-checked={on} aria-label={def.label} disabled={off} onClick={() => toggle(def)}
                className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed', on ? 'bg-primary' : 'bg-border')}>
                <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
              </button>
            </div>
          );
        })}
      </Card>

      <div>
        <Label>Online orders are</Label>
        <div className="flex gap-2" role="radiogroup" aria-label="Online order approval">
          {([['auto', 'Accepted at once'], ['manual', 'Held for approval']] as [ApprovalChoice, string][]).map(([id, text]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} data-own-chip aria-selected={mode === id}
              onClick={() => mode !== id && change({ onlineOrderApprovalMode: id }, id === 'manual' ? 'New online orders wait for approval' : 'New online orders are accepted at once')}>{text}</button>
          ))}
        </div>
        <p className="px-1 pt-2 text-[12.5px] text-muted-foreground">Held orders appear in Online approvals. A source with its own rule in Settings keeps it.</p>
      </div>

      <div>
        <Label>Links</Label>
        <Card className="divide-y py-1" data-testid="own-links">
          {links.map(l => (
            <div key={l.key} className="space-y-2 py-3">
              <div className="flex items-center gap-2 text-[15px] font-semibold"><Globe className="h-4 w-4 text-muted-foreground" />{l.label}</div>
              <div className="break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11.5px] text-muted-foreground">{l.url}</div>
              {l.note && <div className="text-[12.5px] text-muted-foreground">{l.note}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void copy(l.url, l.label)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border bg-card text-[14px] font-semibold"><Copy className="h-4 w-4" />Copy</button>
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border bg-card text-[14px] font-semibold"><ExternalLink className="h-4 w-4" />Open</a>
                <button type="button" onClick={() => void share(l.url, l.label)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border bg-card text-[14px] font-semibold"><Share2 className="h-4 w-4" />Share</button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div>
        <Label>Coming</Label>
        <Card className="divide-y py-1 opacity-70">
          {['Opening hours', 'Banners and offers'].map(n => (
            <div key={n} className="flex items-center gap-3 py-3.5"><Clock className="h-5 w-5 text-muted-foreground" /><span className="flex-1 text-[15px]">{n}</span><Badge tone="neutral">Coming</Badge></div>
          ))}
        </Card>
        <p className="px-1 pt-2 text-[12.5px] text-muted-foreground">These need new storage on the server and are not part of the software yet.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ OWN-21
const seen = (iso: string | null | undefined, now = Date.now()) => {
  const m = Math.floor((now - Date.parse(iso || '')) / 60000);
  if (!iso || !Number.isFinite(m)) return 'never seen';
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export function OwnerDevices() {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'ready'; rows: DeviceRow[] } | { phase: 'failed'; message: string; rows: DeviceRow[] }>({ phase: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ d: DeviceRow; action: DeviceAction } | null>(null);
  const [message, setMessage] = useState('');
  const thisDevice = useMemo(() => { try { return getDeviceId(); } catch { return ''; } }, []);

  const load = useCallback(async (force = false) => {
    const r = await loadDevices(force);
    setState(prev => r.ok ? { phase: 'ready', rows: r.rows } : { phase: 'failed', message: r.error, rows: prev.phase === 'loading' ? [] : prev.rows });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (d: DeviceRow, action: DeviceAction) => {
    setBusy(d.id); setMessage('');
    const res = await actOnDevice(d.id, action);
    setBusy(null); setConfirm(null);
    if (!res.ok) { setMessage(res.error); return; }
    clearBranchCloudCache();
    toast.success({ approve: 'Device approved', block: 'Device blocked', unblock: 'Device unblocked', reject: 'Request removed' }[action]);
    await load(true);
  };
  const ask = (d: DeviceRow, action: DeviceAction) => (action === 'approve' || action === 'unblock' ? void act(d, action) : setConfirm({ d, action }));

  const g = useMemo(() => groupDevices(state.phase === 'loading' ? [] : state.rows), [state]);
  const Btn = ({ d, action, children, tone }: { d: DeviceRow; action: DeviceAction; children: React.ReactNode; tone?: 'primary' | 'danger' }) => (
    <button type="button" disabled={busy === d.id || !canActOn(d, thisDevice, action)} onClick={() => ask(d, action)}
      title={!canActOn(d, thisDevice, action) ? 'This is the phone you are holding' : undefined}
      className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-bold disabled:opacity-40',
        tone === 'primary' ? 'bg-primary text-primary-foreground' : tone === 'danger' ? 'border bg-card text-[hsl(var(--own-bad))]' : 'border bg-card')}>{children}</button>
  );
  const Row = ({ d, sub, right }: { d: DeviceRow; sub: React.ReactNode; right: React.ReactNode }) => (
    <div className="flex items-center gap-3 py-3" data-testid={`own-device-${d.id}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">{/phone|android|ios/i.test(d.platform || '') ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{d.label}{d.id === thisDevice && <span className="ml-1.5 text-[12px] font-bold text-primary">this phone</span>}</div>
        <div className="truncate text-[13px] text-muted-foreground">{d.platform || 'Device'} · {sub}</div>
      </div>
      <div className="flex shrink-0 gap-1.5">{right}</div>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="owner-devices">
      <ScreenHeader title="Devices" back={`${OWNER_BASE}/more`} sub={g.pending.length ? `${g.pending.length} waiting for approval` : undefined} />
      {state.phase === 'failed' && <RetryBanner onRetry={() => void load(true)}>{state.message}</RetryBanner>}
      {message && <RetryBanner onRetry={() => setMessage('')}>{message}</RetryBanner>}
      {state.phase === 'loading' ? <Skeletons rows={4} height="h-[68px]" /> : (
        <>
          {g.pending.length > 0 && (
            <div>
              <Label>Waiting for approval</Label>
              <Card className="divide-y border-[hsl(var(--own-warn)/.45)] py-1" data-testid="own-devices-pending">
                {g.pending.map(d => (
                  <Row key={d.id} d={d} sub={`asked ${seen(d.lastSeenAt)}`} right={<><Btn d={d} action="approve" tone="primary"><Check className="h-4 w-4" />Approve</Btn><Btn d={d} action="reject" tone="danger"><X className="h-4 w-4" /></Btn></>} />
                ))}
              </Card>
            </div>
          )}
          <div>
            <Label right={`${g.approved.filter(d => d.online).length} online`}>Approved</Label>
            {g.approved.length === 0 ? <Empty>No other devices.</Empty> : (
              <Card className="divide-y py-1" data-testid="own-devices-approved">
                {g.approved.map(d => (
                  <Row key={d.id} d={d} sub={<span className={d.online ? 'font-semibold text-[hsl(var(--own-ok))]' : ''}>{d.online ? 'Online' : `seen ${seen(d.lastSeenAt)}`}</span>} right={<Btn d={d} action="block" tone="danger">Block</Btn>} />
                ))}
              </Card>
            )}
          </div>
          {g.blocked.length > 0 && (
            <div>
              <Label>Blocked</Label>
              <Card className="divide-y py-1" data-testid="own-devices-blocked">
                {g.blocked.map(d => <Row key={d.id} d={d} sub={`seen ${seen(d.lastSeenAt)}`} right={<Btn d={d} action="unblock">Unblock</Btn>} />)}
              </Card>
            </div>
          )}
        </>
      )}
      <p className="flex items-start gap-2 px-1 text-[12.5px] text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />A new phone or till must be approved once before it can open this restaurant. Blocking cuts a device off at once.</p>

      {confirm && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={`${confirm.action === 'block' ? 'Block' : 'Remove'} ${confirm.d.label}`}>
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setConfirm(null)} />
          <div className="relative mx-auto w-full max-w-[560px] space-y-3 rounded-t-3xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="text-[18px] font-extrabold">{confirm.action === 'block' ? 'Block' : 'Remove the request from'} “{confirm.d.label}”?</div>
            <p className="text-[14px] text-muted-foreground">{confirm.action === 'block' ? 'It stops syncing at once and cannot open this restaurant until you unblock it.' : 'The request is deleted. The device can ask again.'}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirm(null)} className="h-11 flex-1 rounded-xl border bg-card text-[15px] font-semibold">Cancel</button>
              <button type="button" onClick={() => void act(confirm.d, confirm.action)} className="h-11 flex-1 rounded-xl bg-[hsl(var(--own-bad))] text-[15px] font-bold text-[hsl(var(--primary-foreground))]">{confirm.action === 'block' ? 'Block device' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
