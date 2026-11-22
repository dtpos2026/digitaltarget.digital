// ============================================================
// v1.11.0 — Shift / Cash Drawer management
//
// Captures the events the client's Shift Report needs and could not
// previously produce: who was on shift, when it started and ended, the
// counted cash at open and close, and every mid-shift cash movement.
// The Cash drawer report is derived live so a manager can see the
// expected figure BEFORE counting, and the variance immediately after.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Wallet, LogIn, LogOut, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Banknote, Calculator, Check, Landmark, Lock, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from '@/lib/hash-router';
import { useThemeId, useUiStyle } from '@/lib/uiStyle';
import { isRefinedTheme } from '@/lib/uiThemes';
import { denominationsFor, countedTotal, hasCounted, varianceOf, lineTotal, type DenomCounts } from '@/lib/cashCount';
import { isOpenBill } from '@/lib/ordersView';
import { getLastBackupAt } from '@/lib/updateSafety';
import { getSettings } from '@/lib/store';
import { cn } from '@/lib/utils';
import Kpi from '@/components/ui-kit/KpiCard';
import {
  getOpenShift, openShift, closeShift, addCashMovement, getShifts,
  getOrders, getCurrentUser, onDataChange,
} from '@/lib/store';
import { getAllHistoricalOrders } from '@/lib/orderArchive';
import { buildCashDrawerReport, formatShiftDuration, ordersInShift, type Shift } from '@/lib/shifts';
import { money } from '@/lib/currency';
import { PageTitle } from '@/components/layout/PageFrame';

export default function ShiftPage() {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);
  useEffect(() => onDataChange(() => refresh()), []);

  const shift = useMemo(() => getOpenShift(), [tick]);
  // v1.15.1 — a shift that spans a Day Close (or whose orders were cleared
  // by a Day Close on another device) used to report zero. The archive keeps
  // the settled bills, so the drawer report stays correct either way.
  const orders = useMemo(() => getAllHistoricalOrders(getOrders()), [tick]);
  const drawer = useMemo(
    () => (shift ? buildCashDrawerReport(shift, orders) : null),
    [shift, orders],
  );

  // open form
  const [startCash, setStartCash] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  // close form
  const [endCash, setEndCash] = useState('');
  // movement form
  const [moveAmt, setMoveAmt] = useState('');
  const [moveReason, setMoveReason] = useState('');

  // v1.134.0 — DT Refined draws the design's Shift & cash drawer (SW-24): four figures, Count the drawer, Close the business day
  const refined = useUiStyle() === 'modern' && isRefinedTheme(useThemeId());
  const navigate = useNavigate();
  const [counts, setCounts] = useState<DenomCounts>({});
  const [otherCash, setOtherCash] = useState('');
  const [typedTotal, setTypedTotal] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const denoms = useMemo(() => denominationsFor(getSettings().currencyCode), []);
  const countedAny = typedTotal.trim() !== '' || hasCounted(counts, otherCash);
  const counted = typedTotal.trim() !== '' ? (Number(typedTotal) || 0) : countedTotal(counts, otherCash);

  const doOpen = () => {
    const r = openShift({
      startingCash: Number(startCash) || 0,
      staffName: getCurrentUser()?.name || 'Staff',
      staffEmail: staffEmail.trim() || undefined,
    });
    if (!r.ok) { toast.error(r.error || 'Could not open the shift'); return; }
    setStartCash('');
    toast.success('Shift opened');
    refresh();
  };

  const doClose = () => {
    if (endCash.trim() === '') { toast.error('Enter the counted cash'); return; }
    finishClose(Number(endCash) || 0);
  };
  const finishClose = (amount: number) => {
    const r = closeShift(amount);
    if (!r.ok) { toast.error(r.error || 'Could not close the shift'); return; }
    const d = r.shift ? buildCashDrawerReport(r.shift, getAllHistoricalOrders(getOrders())) : null;
    setEndCash('');
    setCounts({}); setOtherCash(''); setTypedTotal('');
    refresh();
    if (d && d.variance !== undefined && Math.abs(d.variance) > 0.009) {
      toast.warning(
        d.variance > 0
          ? `Shift closed — drawer is OVER by ${money(d.variance)}`
          : `Shift closed — drawer is SHORT by ${money(Math.abs(d.variance))}`,
      );
    } else {
      toast.success('Shift closed — drawer balances exactly ✅');
    }
  };

  const doMove = (kind: 'payIn' | 'payOut') => {
    const r = addCashMovement(kind, Number(moveAmt) || 0, moveReason.trim());
    if (!r.ok) { toast.error(r.error || 'Not recorded'); return; }
    setMoveAmt(''); setMoveReason('');
    toast.success(kind === 'payIn' ? 'Cash in recorded' : 'Cash out recorded');
    refresh();
  };

  const past: Shift[] = useMemo(
    () => getShifts().filter(s => s.status === 'closed')
      .sort((a, b) => new Date(b.closedAt || b.openedAt).getTime() - new Date(a.closedAt || a.openedAt).getTime())
      .slice(0, 10),
    [tick],
  );

  if (refined) {
    const variance = drawer && countedAny ? varianceOf(counted, drawer.expectedCash) : null;
    const openBills = getOrders().filter(o => isOpenBill(o)).length;
    const lastBackup = getLastBackupAt();
    const backedUpToday = !!lastBackup && new Date(lastBackup).toDateString() === new Date().toDateString();
    const checks: Array<{ key: string; label: string; ok: boolean; note?: string }> = [
      { key: 'bills', label: 'All bills paid or archived', ok: openBills === 0, note: openBills > 0 ? `${openBills} open` : undefined },
      { key: 'shifts', label: 'Shifts closed', ok: !shift },
      { key: 'cash', label: 'Cash counted', ok: countedAny },
      { key: 'backup', label: 'Backup of today taken', ok: backedUpToday },
    ];
    const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v))}`;
    const moves = shift ? [...shift.payIns.map(m => ({ ...m, kind: 'in' as const })), ...shift.payOuts.map(m => ({ ...m, kind: 'out' as const }))] : [];
    return (
      <div className="space-y-4 p-4 lg:p-6" data-shift-screen>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle icon={Wallet} subtitle={shift ? `${shift.staffName} · opened ${new Date(shift.openedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'No shift is open on this till'}>Shift &amp; cash drawer</PageTitle>
          {shift && (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="h-11 rounded-xl px-4" onClick={() => setMoveOpen(true)} data-shift-cash-move><ArrowLeftRight className="mr-2 h-4 w-4" /> Cash in / out</Button>
              <Button className="h-11 rounded-xl px-4" data-shift-close
                onClick={() => { if (!countedAny) { toast.error('Count the drawer first'); return; } finishClose(counted); }}><Lock className="mr-2 h-4 w-4" /> Close shift</Button>
            </div>
          )}
        </div>

        {!shift ? (
          <div className="max-w-2xl rounded-2xl border bg-card p-5 shadow-card" data-shift-open-card>
            <h2 className="flex items-center gap-2 text-[17px] font-extrabold"><LogIn className="h-4 w-4 text-[hsl(var(--dt-ok))]" /> Open shift</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Count the cash in the drawer and enter it — the closing totals are worked out from it.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><Label className="mb-1 block text-[12px] font-bold" htmlFor="shift-start">Starting cash *</Label>
                <Input id="shift-start" className="h-11 rounded-xl" type="number" inputMode="decimal" value={startCash} onChange={e => setStartCash(e.target.value)} placeholder="0.00" /></div>
              <div><Label className="mb-1 block text-[12px] font-bold" htmlFor="shift-email">Staff email (printed on the report)</Label>
                <Input id="shift-email" className="h-11 rounded-xl" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} placeholder="staff@example.com" /></div>
            </div>
            <Button className="mt-4 h-11 rounded-xl px-5" onClick={doOpen} disabled={startCash.trim() === ''}>Open shift</Button>
          </div>
        ) : drawer && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-shift-kpis>
              <Kpi label="Starting cash" value={money(drawer.startingCash)} icon={Landmark} />
              <Kpi label="Cash sales" value={money(drawer.orderIncome)} icon={Banknote} />
              <Kpi label="Expected in drawer" value={money(drawer.expectedCash)} icon={Calculator}
                caption={[drawer.payIn > 0 ? `+${money(drawer.payIn)} in` : '', drawer.payOut > 0 ? `−${money(drawer.payOut)} out` : '', drawer.refund > 0 ? `−${money(drawer.refund)} refunds` : ''].filter(Boolean).join(' · ') || undefined} />
              <Kpi label="Variance so far" value={variance === null ? '—' : signed(variance)} icon={TriangleAlert}
                caption={variance === null ? 'Count the drawer' : variance === 0 ? 'The drawer balances' : variance > 0 ? 'Over' : 'Short'} captionTone={variance === 0 ? 'ok' : 'bad'} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <section className="rounded-2xl border bg-card p-5 shadow-card" data-shift-count>
                <h2 className="text-[16px] font-extrabold">Count the drawer</h2>
                <div className="mt-4 space-y-2.5">
                  {denoms.map(d => (
                    <div key={d} className="grid grid-cols-[5.5rem_1rem_6rem_1fr] items-center gap-2 text-[14px]" data-denom={d}>
                      <span className="font-extrabold">{money(d)}</span>
                      <span className="text-muted-foreground">×</span>
                      <Input aria-label={`${money(d)} notes`} className="h-10 rounded-xl" type="number" inputMode="numeric" min={0} placeholder="0" value={counts[String(d)] ?? ''}
                        onChange={e => setCounts(c => ({ ...c, [String(d)]: e.target.value }))} />
                      <span className="text-right font-extrabold tabular-nums">{money(lineTotal(d, counts[String(d)]))}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-[5.5rem_1rem_6rem_1fr] items-center gap-2 text-[14px]">
                    <span className="font-extrabold">Other</span><span />
                    <Input aria-label="Other loose cash" className="col-span-2 h-10 rounded-xl" type="number" inputMode="decimal" min={0} placeholder="Coins, loose cash" value={otherCash} onChange={e => setOtherCash(e.target.value)} />
                  </div>
                </div>
                <div className="mt-4 flex items-baseline justify-between border-t pt-4"><span className="text-[18px] font-extrabold">Counted</span><span className="text-[20px] font-extrabold tabular-nums" data-shift-counted>{money(counted)}</span></div>
                <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <label htmlFor="shift-typed" className="shrink-0">Or type the total</label>
                  <Input id="shift-typed" className="h-9 max-w-[10rem] rounded-xl" type="number" inputMode="decimal" min={0} placeholder="0" value={typedTotal} onChange={e => setTypedTotal(e.target.value)} />
                </div>
              </section>

              <section className="rounded-2xl border bg-card p-5 shadow-card" data-shift-day>
                <h2 className="text-[16px] font-extrabold">Close the business day</h2>
                <ul className="mt-4 space-y-3">
                  {checks.map(c => (
                    <li key={c.key} data-check={c.key} data-ok={c.ok} className="flex items-center gap-3 text-[14px]">
                      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border-2', c.ok ? 'border-primary bg-primary text-primary-foreground' : 'border-border')} aria-hidden>{c.ok && <Check className="h-3.5 w-3.5" />}</span>
                      <span className="flex-1">{c.label}</span>
                      {c.note && <span className="text-[12px] font-semibold text-[hsl(var(--dt-warn))]">{c.note}</span>}
                      <span className="sr-only">{c.ok ? 'done' : 'not done'}</span>
                    </li>
                  ))}
                </ul>
                <Button className="mt-5 h-11 w-full rounded-xl" onClick={() => navigate('/day-close')} data-shift-close-day>Close day</Button>
                <p className="mt-2 text-[12px] italic text-muted-foreground">Closing archives the day; nothing is deleted.</p>
              </section>
            </div>
          </>
        )}

        {past.length > 0 && (
          <section className="rounded-2xl border bg-card p-5 shadow-card" data-shift-history>
            <h2 className="mb-3 text-[16px] font-extrabold">Past shifts</h2>
            <div className="divide-y">
              {past.map(sh => {
                const d = buildCashDrawerReport(sh, orders);
                return (
                  <div key={sh.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13.5px]">
                    <span className="font-extrabold">{sh.staffName}</span>
                    <span className="text-muted-foreground">{new Date(sh.openedAt).toLocaleDateString('en-GB')} · {formatShiftDuration(sh.openedAt, sh.closedAt)}</span>
                    <span className="ml-auto tabular-nums">Expected {money(d.expectedCash)} · Counted {money(d.actualEndingCash ?? 0)}</span>
                    {d.variance !== undefined && Math.abs(d.variance) > 0.009 && (
                      <span className={cn('font-extrabold tabular-nums', d.variance > 0 ? 'text-[hsl(var(--dt-info))]' : 'text-[hsl(var(--dt-bad))]')}>{d.variance > 0 ? '+' : '−'}{money(Math.abs(d.variance))}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Cash in / out</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input type="number" inputMode="decimal" className="h-11 rounded-xl" placeholder="Amount" aria-label="Amount" value={moveAmt} onChange={e => setMoveAmt(e.target.value)} />
              <Input className="h-11 rounded-xl" placeholder="Reason (e.g. bank drop, float)" aria-label="Reason" value={moveReason} onChange={e => setMoveReason(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => doMove('payIn')} data-shift-pay-in><ArrowDownToLine className="mr-2 h-4 w-4" /> Pay in</Button>
                <Button variant="outline" className="h-11 rounded-xl" onClick={() => doMove('payOut')} data-shift-pay-out><ArrowUpFromLine className="mr-2 h-4 w-4" /> Pay out</Button>
              </div>
              {moves.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-auto border-t pt-2 text-[13px]">
                  {moves.map(m => (
                    <li key={m.id} className={cn('flex gap-2', m.kind === 'in' ? 'text-[hsl(var(--dt-ok))]' : 'text-[hsl(var(--dt-bad))]')}>
                      <span className="flex-1 truncate">{m.kind === 'in' ? '+' : '−'} {m.reason}</span><span className="tabular-nums">{money(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <PageTitle icon={Wallet} subtitle="Open and close your shift and the cash drawer">Shift &amp; Cash Drawer</PageTitle>

      {!shift ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-green-600" />
            <h3 className="text-sm font-bold">Open shift</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Count the cash currently in the drawer and enter it — this is what the
            the closing totals are calculated from it.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Starting cash *</Label>
              <Input type="number" inputMode="decimal" value={startCash}
                onChange={e => setStartCash(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs">Staff email (printed on the report)</Label>
              <Input value={staffEmail} onChange={e => setStaffEmail(e.target.value)}
                placeholder="staff@example.com" />
            </div>
          </div>
          <Button onClick={doOpen} disabled={startCash.trim() === ''}>Shift Open</Button>
        </Card>
      ) : (
        <>
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold">{shift.staffName}</h3>
                {shift.staffEmail && <p className="text-[11px] text-muted-foreground">{shift.staffEmail}</p>}
              </div>
              <Badge className="bg-green-600 text-white">OPEN</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div><span className="text-muted-foreground">Start</span><br />
                <span className="font-mono">{new Date(shift.openedAt).toLocaleString('en-GB')}</span></div>
              <div><span className="text-muted-foreground">Duration</span><br />
                <span className="font-mono">{formatShiftDuration(shift.openedAt)}</span></div>
              <div><span className="text-muted-foreground">Orders</span><br />
                <span className="font-mono">{ordersInShift(shift, orders).length}</span></div>
            </div>
          </Card>

          {/* Live cash drawer report — same maths as the printed report */}
          {drawer && (
            <Card className="p-4">
              <h3 className="text-sm font-bold mb-2">Cash drawer report (live)</h3>
              <div className="font-mono text-xs space-y-0.5">
                <Row k="Starting cash" v={money(drawer.startingCash)} />
                <Row k="Order income" v={money(drawer.orderIncome)} />
                <Row k="Pay in" v={money(drawer.payIn)} />
                <Row k="Refund" v={`-${money(drawer.refund)}`} />
                <Row k="Pay out" v={`-${money(drawer.payOut)}`} />
                <div className="border-t pt-0.5 font-bold">
                  <Row k="Expected cash" v={money(drawer.expectedCash)} />
                </div>
              </div>
            </Card>
          )}

          {/* Pay in / Pay out */}
          <Card className="p-4 space-y-2">
            <h3 className="text-sm font-bold">Cash movement</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input type="number" inputMode="decimal" placeholder="Amount"
                value={moveAmt} onChange={e => setMoveAmt(e.target.value)} />
              <Input placeholder="Wajah (e.g. bank drop, float)"
                value={moveReason} onChange={e => setMoveReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => doMove('payIn')}>
                <ArrowDownToLine className="h-3.5 w-3.5 mr-1" /> Pay In
              </Button>
              <Button size="sm" variant="outline" onClick={() => doMove('payOut')}>
                <ArrowUpFromLine className="h-3.5 w-3.5 mr-1" /> Pay Out
              </Button>
            </div>
            {(shift.payIns.length > 0 || shift.payOuts.length > 0) && (
              <div className="text-[11px] space-y-0.5 pt-1 max-h-32 overflow-auto">
                {shift.payIns.map(m => (
                  <div key={m.id} className="flex gap-2 text-green-700">
                    <span className="flex-1 truncate">+ {m.reason}</span>
                    <span className="font-mono">{money(m.amount)}</span>
                  </div>
                ))}
                {shift.payOuts.map(m => (
                  <div key={m.id} className="flex gap-2 text-red-700">
                    <span className="flex-1 truncate">− {m.reason}</span>
                    <span className="font-mono">{money(m.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Close */}
          <Card className="p-4 space-y-2 border-amber-300/60">
            <div className="flex items-center gap-2">
              <LogOut className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-bold">Close shift</h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Count the drawer and enter the actual amount. The variance is calculated for you.
            </p>
            <div className="flex gap-2">
              <Input type="number" inputMode="decimal" placeholder="Actual ending cash"
                value={endCash} onChange={e => setEndCash(e.target.value)} />
              <Button onClick={doClose} variant="destructive">Close Shift</Button>
            </div>
            {endCash.trim() !== '' && drawer && (
              <p className="text-xs font-bold">
                Variance:{' '}
                <span className={Number(endCash) - drawer.expectedCash === 0 ? 'text-green-700'
                  : Number(endCash) - drawer.expectedCash > 0 ? 'text-blue-700' : 'text-red-700'}>
                  {money(Number(endCash) - drawer.expectedCash)}
                </span>
              </p>
            )}
          </Card>
        </>
      )}

      {/* History */}
      {past.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2">Pichhli shifts</h3>
          <div className="space-y-1">
            {past.map(s => {
              const d = buildCashDrawerReport(s, orders);
              return (
                <div key={s.id} className="text-[11px] border rounded px-2 py-1 flex flex-wrap gap-2">
                  <span className="font-bold">{s.staffName}</span>
                  <span className="text-muted-foreground">
                    {new Date(s.openedAt).toLocaleDateString('en-GB')} · {formatShiftDuration(s.openedAt, s.closedAt)}
                  </span>
                  <span className="ml-auto font-mono">
                    Expected {money(d.expectedCash)} · Actual {money(d.actualEndingCash ?? 0)}
                  </span>
                  {d.variance !== undefined && Math.abs(d.variance) > 0.009 && (
                    <span className={`font-bold ${d.variance > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {d.variance > 0 ? '+' : ''}{money(d.variance)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex">
      <span className="flex-1">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
