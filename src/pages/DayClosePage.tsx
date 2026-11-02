// ============================================================
// DAY CLOSE — the focused end-of-day screen (v1.96.0, from the offline POS's Day Close).
//
// Day Close used to be a tab at the bottom of Settings. Choosing "Day Close" in the sidebar now opens this page, which
// walks through it in order and shows what will happen BEFORE anything does:
//
//   1. Shift report   print today's (or any dates') report, set the drawer float
//   2. What it clears the admin's choices: bills, tables, order number, backup, and the modules to reset to 00
//   3. Close the day  the confirmation lists exactly how many bills leave the live lists
//
// The work itself is the cloud's own (v1.27.1 and later), moved here unchanged: it stops while bills have not reached
// the server, archives instead of deleting, waits for the server before clearing anything on the till, resets the order
// counter on the cloud, reports what the server confirmed, and writes the audit entry.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck2, FileBarChart2, Moon, Printer, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from '@/lib/hash-router';
import { printShiftReport } from '@/components/ShiftReport';
import {
  getSettings, saveSettings, getTables, saveTable, getOrders, exportData, getCurrentUser,
  archiveOrdersBulk, resetOrderCounter, clearCollectionsForDayClose,
} from '@/lib/store';
import {
  getDayCloseConfig, saveDayCloseConfig, DAY_CLOSE_MODULES, getPendingDayCloseRequests, addPendingDayCloseRequest,
  clearPendingDayCloseRequests, planDayClose, type DayCloseConfig, type PendingDayCloseRequest,
} from '@/lib/dayCloseConfig';
import { buildDayClosePreflight, countUnsyncedOrders, type DayClosePreflight } from '@/lib/dayClosePreflight';
import { userHasAccess } from '@/lib/permissions';
import { archiveOrders } from '@/lib/orderArchive';
import { releasedTable } from '@/lib/tableRelease';
import { saveBackupToCloud, logDayCloseEvent } from '@/lib/dayCloseBackup';
import { formatMoney } from '@/lib/currency';

const CLEAR_OPTIONS: { k: keyof DayCloseConfig; label: string }[] = [
  { k: 'clearPaidOrders', label: 'Paid / closed bills (today\'s sales)' },
  { k: 'clearRunningHoldBills', label: 'Running and HOLD — UNPAID bills' },
  { k: 'clearVoidComp', label: 'Void / complimentary / cancelled bills' },
  { k: 'clearCreditOrders', label: 'Credit / Udhaar orders' },
  { k: 'resetTables', label: 'Set every table to Free' },
  { k: 'resetOrderNumber', label: 'Restart the daily order number' },
  { k: 'autoBackup', label: 'Download a JSON backup first (recommended)' },
];

const sod = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const eod = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

export default function DayClosePage() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const canDayClose = isAdmin || userHasAccess(currentUser, 'day-close');

  const [dcFrom, setDcFrom] = useState('');
  const [dcTo, setDcTo] = useState('');
  const [startingCash, setStartingCash] = useState<number>(() => Number((getSettings() as { startingCash?: number }).startingCash || 0));
  const [showDayClose, setShowDayClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cfg, setCfg] = useState<DayCloseConfig>(() => getDayCloseConfig());
  const [preflight, setPreflight] = useState<DayClosePreflight | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingDayCloseRequest[]>(() => getPendingDayCloseRequests());
  const [version, setVersion] = useState(0);

  // Selections stick — saved the moment a box is ticked.
  useEffect(() => { saveDayCloseConfig(cfg); }, [cfg]);

  const orders = useMemo(() => getOrders(), [version, showDayClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const openBills = orders.filter(o => o.status === 'running' || o.status === 'hold' || o.status === 'partial');
  const heldBills = orders.filter(o => o.status === 'hold');
  const plan = useMemo(() => planDayClose(orders, cfg), [orders, cfg]);

  // What the confirmation says about the server: asked when it opens, so the button can be blocked.
  useEffect(() => {
    if (!showDayClose) { setPreflight(null); return; }
    let cancelled = false;
    void countUnsyncedOrders().then(pending => {
      if (!cancelled) setPreflight(buildDayClosePreflight(getOrders(), pending));
    });
    return () => { cancelled = true; };
  }, [showDayClose]);

  const saveStartingCash = (v: number) => {
    const value = Number.isFinite(v) && v >= 0 ? v : 0;
    setStartingCash(value);
    saveSettings({ ...getSettings(), startingCash: value } as never);
  };

  const printReport = async (from: Date, to: Date, label: string) => {
    toast.info(`Printing the ${label} shift report…`);
    const r = await printShiftReport({ from, to, label, startingCash });
    if (r.success) toast.success('Shift report sent to the printer.');
    else toast.error('The shift report could not be printed: ' + (r.error || 'unknown error'));
  };

  const printPreset = (k: 'today' | 'yesterday' | 'week' | 'month' | 'year') => {
    const now = new Date();
    let from = sod(now), to = eod(now), label = 'Today';
    if (k === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); from = sod(y); to = eod(y); label = 'Yesterday'; }
    if (k === 'week') { const f = new Date(now); f.setDate(f.getDate() - 6); from = sod(f); label = 'Last 7 Days'; }
    if (k === 'month') { from = sod(new Date(now.getFullYear(), now.getMonth(), 1)); label = 'This Month'; }
    if (k === 'year') { from = sod(new Date(now.getFullYear(), 0, 1)); label = 'This Year'; }
    void printReport(from, to, label);
  };

  // ===== The Day Close itself — moved unchanged from the Settings page (v1.27.1 and later) =====
  const handleDayClose = async () => {
    if (!isAdmin) { toast.error('Only Admin can finalize Day Close'); return; }
    setClosing(true);
    try {
      // A bill taken and paid on this till that has not reached the server exists NOWHERE else. Clearing it from the
      // till before the queue drains is how a real sale disappears, so this stops rather than warns.
      const pendingOrders = await countUnsyncedOrders();
      if (pendingOrders !== 0) {
        toast.error(
          pendingOrders < 0
            ? 'Cannot close the day: the offline queue could not be read. Try again in a moment.'
            : `Cannot close the day: ${pendingOrders} bill(s) have not reached the server yet. They would be lost. Wait for sync to finish.`,
        );
        return;
      }

      const closeId = `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const dateStr = new Date().toISOString().slice(0, 10);
      let backupBytes = 0;
      let cloudOk = false;

      // 1. Backup snapshot — local download (admin safety) + cloud copy (survives device loss)
      if (cfg.autoBackup) {
        const backupJson = exportData();
        backupBytes = new TextEncoder().encode(backupJson).length;
        const blob = new Blob([backupJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `day-close-backup-${dateStr}-${closeId.slice(-6)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        try { cloudOk = await saveBackupToCloud(backupJson, `${dateStr}__${closeId.slice(-6)}`); } catch { cloudOk = false; }
      }

      // 2. Always archive the full snapshot so admin can view weekly/monthly history.
      const all = getOrders();
      archiveOrders(all);

      // 3. Archive (never delete) the groups the admin ticked. The rule is planDayClose's, the one shown on screen.
      const { toClear, cleared } = planDayClose(all, cfg);
      const delResult = await archiveOrdersBulk(toClear);
      if (delResult.offline) {
        toast.error('No internet — Day Close stopped. Nothing was changed. Try again once you are online.');
        return;
      }
      if (delResult.failed > 0) {
        toast.error(`${delResult.failed} orders could not be archived on the server — they may reappear. ${delResult.error || ''}`);
      }

      // 4. Reset tables (optional) — every table, released properly.
      if (cfg.resetTables) getTables().forEach(t => saveTable(releasedTable(t, undefined, 'free')));

      // 5. Reset the daily order counter (optional), on the cloud too.
      if (cfg.resetOrderNumber) {
        const counterOk = await resetOrderCounter(0);
        if (!counterOk) toast.error('The order-number counter did not reset on the cloud — please try again');
      }

      // 5b. Reset every ticked module to 00 (local + cloud).
      const modCols = Object.entries(cfg.modules || {}).filter(([, v]) => v).map(([k]) => k);
      let modCleared = 0;
      if (modCols.length) {
        try {
          const counts = await clearCollectionsForDayClose(modCols);
          modCleared = Object.values(counts).reduce((a, b) => a + b, 0);
        } catch {
          toast.error('Some modules could not be reset — please try again');
        }
      }

      // 6. Audit log — who closed, what cleared, backup status.
      try {
        await logDayCloseEvent({
          id: closeId,
          closedAt: new Date().toISOString(),
          closedByUid: currentUser?.id || 'unknown',
          closedByName: currentUser?.name || 'Unknown',
          orderCount: all.length,
          cleared: { paid: cleared.paid, runningHold: cleared.runningHold, voidComp: cleared.voidComp, credit: cleared.credit },
          config: { ...cfg } as never,
          backupBytes,
        });
      } catch { /* the audit entry is best effort */ }

      // 7. Clear pending cashier requests — admin has now actioned them.
      clearPendingDayCloseRequests();
      setPendingRequests([]);
      setShowDayClose(false);
      setVersion(v => v + 1);
      const cloudMsg = cfg.autoBackup ? (cloudOk ? ' · Cloud backup saved ☁️' : ' · Cloud backup FAILED (local OK)') : '';
      const modMsg = modCleared ? ` · ${modCleared} module records reset to 0` : '';
      // Report what the SERVER actually confirmed, not what we intended.
      toast.success(`Day closed. ${delResult.archived} bills moved to history (nothing deleted).${modMsg}${cloudMsg}`);
    } finally {
      setClosing(false);
    }
  };

  const handleRequestDayClose = () => {
    if (!currentUser) { toast.error('Login required'); return; }
    addPendingDayCloseRequest({ by: currentUser.id, byName: currentUser.name });
    setPendingRequests(getPendingDayCloseRequests());
    toast.success('Day Close request sent — an Admin will confirm it');
  };

  const handleDismissRequest = (id: string) => {
    const remaining = getPendingDayCloseRequests().filter(r => r.id !== id);
    clearPendingDayCloseRequests();
    remaining.forEach(r => addPendingDayCloseRequest({ by: r.by, byName: r.byName, note: r.note, at: r.at }));
    setPendingRequests(getPendingDayCloseRequests());
  };

  const setAllBills = (on: boolean) => {
    setCfg(c => {
      const next = { ...c };
      (['clearPaidOrders', 'clearRunningHoldBills', 'clearVoidComp', 'clearCreditOrders', 'resetTables', 'resetOrderNumber'] as const)
        .forEach(k => { next[k] = on; });
      if (on) next.autoBackup = true;
      return next;
    });
  };

  const businessDate = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  const who = isAdmin ? 'Full control' : canDayClose ? 'Can request a day close' : 'No Day Close access';

  return (
    <div className="p-4 lg:p-6 max-w-5xl space-y-4" data-testid="day-close-page">
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary text-primary-foreground grid place-items-center"><Moon className="h-6 w-6" /></div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Day Close</h1>
          <p className="text-xs text-muted-foreground">{businessDate} · {currentUser?.name || '—'} ({currentUser?.role || 'guest'}) · {who}</p>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Open bills" value={openBills.length} tone={openBills.length ? 'warn' : 'ok'} />
        <Tile label="On HOLD — UNPAID" value={heldBills.length} tone={heldBills.length ? 'warn' : 'ok'} />
        <Tile label="Bills in the live list" value={orders.length} />
        <Tile label="Cashier requests" value={pendingRequests.length} tone={pendingRequests.length ? 'warn' : 'ok'} />
      </div>

      {openBills.length > 0 && (
        <div className="rounded-xl border border-status-warning/50 bg-status-warning/10 p-3 text-sm flex flex-wrap items-center gap-2" role="status">
          <AlertTriangle className="h-4 w-4 text-status-warning" />
          <span>
            {openBills.length} bill{openBills.length === 1 ? ' is' : 's are'} still open
            {heldBills.length ? ` (${heldBills.length} on HOLD — UNPAID)` : ''}. Collect payment or check them before closing.
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => navigate('/bills')}>Open running bills</Button>
        </div>
      )}

      {/* Step 1 — report */}
      <section className="bg-card border rounded-xl p-4 space-y-3" aria-labelledby="dc-step1">
        <h2 id="dc-step1" className="text-sm font-extrabold flex items-center gap-2"><FileBarChart2 className="h-4 w-4 text-primary" /> Step 1 · Shift report</h2>
        <p className="text-xs text-muted-foreground">Sales summary by category, product and payment method, on the thermal printer.</p>
        <div className="flex flex-wrap gap-1.5">
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['year', 'This year']] as const).map(([k, lbl]) => (
            <Button key={k} size="sm" variant={k === 'today' ? 'default' : 'outline'} onClick={() => printPreset(k)}>
              <Printer className="h-3.5 w-3.5 mr-1" /> {lbl}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => navigate('/reports')}>Full sales report</Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">Custom dates:</span>
          <Input type="date" className="h-8 w-40" value={dcFrom} onChange={e => setDcFrom(e.target.value)} aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="h-8 w-40" value={dcTo} onChange={e => setDcTo(e.target.value)} aria-label="To date" />
          <Button size="sm" variant="outline" disabled={!dcFrom} onClick={() => {
            void printReport(sod(new Date(dcFrom)), eod(new Date(dcTo || dcFrom)), `${dcFrom} → ${dcTo || dcFrom}`);
          }}>Print</Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="dc-float" className="text-xs font-medium text-muted-foreground">Starting cash (drawer float)</label>
          <Input id="dc-float" type="number" min={0} className="h-8 w-32" value={startingCash}
            onChange={e => setStartingCash(Number(e.target.value))}
            onBlur={e => saveStartingCash(Number(e.target.value))} />
          <span className="text-[11px] text-muted-foreground">Saved when you leave the field.</span>
        </div>
        <p className="text-[11px] text-muted-foreground">Reports for past dates stay available after a Day Close — every bill goes to the permanent archive.</p>
      </section>

      {/* Step 2 — what gets cleared (admin) */}
      {isAdmin && (
        <section className="bg-card border rounded-xl p-4 space-y-3" aria-labelledby="dc-step2">
          <h2 id="dc-step2" className="text-sm font-extrabold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Step 2 · What Day Close clears</h2>
          <p className="text-[11px] text-muted-foreground">
            Only the ticked groups leave the live lists — your choice is saved automatically. The archive (admin history) always keeps every bill.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setAllBills(true)}>Select all</Button>
            <Button size="sm" variant="outline" onClick={() => setAllBills(false)}>Clear all</Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {CLEAR_OPTIONS.map(row => (
              <label key={row.k} className="flex items-center gap-2 text-xs cursor-pointer rounded-md border px-3 py-2">
                <Checkbox checked={!!cfg[row.k]} onCheckedChange={v => setCfg(c => ({ ...c, [row.k]: !!v }))} />
                <span>{row.label}</span>
              </label>
            ))}
          </div>

          <div className="pt-2 border-t space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold">Modules to reset to 00</h3>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                  onClick={() => setCfg(c => ({ ...c, modules: Object.fromEntries(DAY_CLOSE_MODULES.map(m => [m.col, true])) }))}>Select all</Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setCfg(c => ({ ...c, modules: {} }))}>Clear all</Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Every ticked module is emptied (device and cloud) when the day is closed.</p>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {DAY_CLOSE_MODULES.map(m => (
                <label key={m.col} className="flex items-center gap-2 text-xs cursor-pointer rounded-md border px-3 py-2">
                  <Checkbox checked={!!cfg.modules?.[m.col]}
                    onCheckedChange={v => setCfg(c => ({ ...c, modules: { ...(c.modules || {}), [m.col]: !!v } }))} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Which cashiers may request a Day Close is set with the "Day Close" permission in Users &amp; Roles.</p>
        </section>
      )}

      {isAdmin && pendingRequests.length > 0 && (
        <section className="bg-status-warning/10 border border-status-warning/40 rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold">Cashier Day Close requests ({pendingRequests.length})</h2>
          {pendingRequests.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-background rounded p-2">
              <span><b>{r.byName}</b> — {new Date(r.at).toLocaleString()}</span>
              <Button variant="ghost" size="sm" onClick={() => handleDismissRequest(r.id)}>Dismiss</Button>
            </div>
          ))}
        </section>
      )}

      {/* Step 3 — close */}
      <section className="bg-card border rounded-xl p-4 space-y-3" aria-labelledby="dc-step3">
        <h2 id="dc-step3" className="text-sm font-extrabold flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-primary" /> Step 3 · Close the day</h2>
        {canDayClose ? (
          isAdmin ? (
            <Button size="lg" className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-bold"
              onClick={() => { setVersion(v => v + 1); setShowDayClose(true); }}>
              Close the day (Admin)
            </Button>
          ) : (
            <>
              <Button size="lg" className="w-full text-sm font-bold" onClick={handleRequestDayClose}>Request Day Close (the admin confirms)</Button>
              <p className="text-[11px] text-muted-foreground text-center">Nothing is cleared by a request. The admin confirms it here, and only then are bills cleared.</p>
            </>
          )
        ) : (
          <p className="text-xs text-center text-muted-foreground">You do not have Day Close access. Ask the admin for the "Day Close" permission.</p>
        )}
      </section>

      <Dialog open={showDayClose} onOpenChange={o => { if (!closing) setShowDayClose(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Confirm Day Close
          </DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Every bill is copied to the archive first — nothing is deleted. Then these leave the live lists:</p>
            <ul className="space-y-1 text-xs" data-testid="day-close-plan">
              <li>Paid bills: <b>{plan.cleared.paid}</b></li>
              <li>Running and HOLD — UNPAID bills: <b>{plan.cleared.runningHold}</b></li>
              <li>Void / complimentary / cancelled: <b>{plan.cleared.voidComp}</b></li>
              <li>Credit orders: <b>{plan.cleared.credit}</b></li>
              <li>Staying in the live lists: <b>{plan.kept}</b></li>
            </ul>
            {plan.unpaidCleared > 0 && (
              <p className="rounded-md border border-status-warning/50 bg-status-warning/10 p-2 text-xs font-semibold">
                {plan.unpaidCleared} unpaid bill{plan.unpaidCleared === 1 ? '' : 's'}
                {plan.heldCleared ? ` (${plan.heldCleared} on HOLD — UNPAID)` : ''} will be removed from the running list.
                Untick "Running and HOLD — UNPAID bills" in Step 2 to keep them open.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {cfg.resetTables ? 'Every table is set to Free. ' : ''}
              {cfg.resetOrderNumber ? 'The daily order number restarts. ' : ''}
              {Object.values(cfg.modules || {}).some(Boolean) ? `${Object.values(cfg.modules).filter(Boolean).length} module(s) are reset to 00. ` : ''}
              {cfg.autoBackup ? 'A JSON backup is downloaded first.' : 'No backup is downloaded.'}
            </p>

            {preflight && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-xs" data-testid="day-close-preflight">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{preflight.total} bill(s) in the live lists</span>
                  <span className="font-bold text-primary">{formatMoney(preflight.value)}</span>
                </div>
                {preflight.paidWithoutPaymentRecord > 0 && (
                  <div className="rounded border border-status-warning/50 bg-status-warning/10 p-2 text-[11px]">
                    <b>{preflight.paidWithoutPaymentRecord} paid bill(s) have no payment record.</b>{' '}
                    Their money counts in the sales total but nothing says how it was received, so cash-vs-card will not reconcile. Worth checking now.
                  </div>
                )}
                {!preflight.safe && (
                  <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-[11px]" role="alert">
                    <b>
                      {preflight.unsyncedOrders < 0
                        ? 'The offline queue could not be read.'
                        : `${preflight.unsyncedOrders} bill(s) have not reached the server.`}
                    </b>{' '}
                    Day Close is blocked until they sync — closing now would lose them.
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowDayClose(false)} disabled={closing}>Cancel</Button>
              <Button className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDayClose} disabled={closing || (!!preflight && !preflight.safe)}>
                {closing ? 'Closing…' : 'Confirm Day Close'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'warn' ? 'border-status-warning/50 bg-status-warning/10' : 'bg-card'}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
    </div>
  );
}
