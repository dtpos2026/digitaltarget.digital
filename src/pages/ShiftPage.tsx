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
import { Wallet, LogIn, LogOut, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import {
  getOpenShift, openShift, closeShift, addCashMovement, getShifts,
  getOrders, getCurrentUser, onDataChange,
} from '@/lib/store';
import { getAllHistoricalOrders } from '@/lib/orderArchive';
import { buildCashDrawerReport, formatShiftDuration, ordersInShift, type Shift } from '@/lib/shifts';
import { money } from '@/lib/currency';

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
    const r = closeShift(Number(endCash) || 0);
    if (!r.ok) { toast.error(r.error || 'Could not close the shift'); return; }
    const d = r.shift ? buildCashDrawerReport(r.shift, getAllHistoricalOrders(getOrders())) : null;
    setEndCash('');
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

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Wallet className="h-5 w-5" /> Shift &amp; Cash Drawer
      </h2>

      {!shift ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <LogIn className="h-4 w-4 text-green-600" />
            <h3 className="text-sm font-bold">Open shift</h3>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Count the cash currently in the drawer and enter it — this is what the
            shift ke aakhir me hisaab milega.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Starting cash *</Label>
              <Input type="number" inputMode="decimal" value={startCash}
                onChange={e => setStartCash(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs">Staff email (report par chhapega)</Label>
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
