// ============================================================================
// "Customer order site ya APK se order POS me nahi aata."
//
// They arrive. The till is looking at the wrong branch.
//
// Measured on the live database: of this restaurant's website orders, 7 landed
// on "burewala", 2 on "hafiz", 2 on "multan" and 9 on "Main Branch". The till
// works at Main Branch and reads orders with pull_orders_delta(p_branch, …),
// which is branch-scoped by design — correctly so for a real chain. So an
// order placed against another branch is in the database, the customer is
// waiting, and the owner's screen shows NOTHING. That silence is the bug.
//
// It also explains the order number: each branch has its own counter, so the
// order reads #23 while this till is at #1052, which looks like a different
// system rather than a missed sale.
//
// Widening the pull would put another branch's bills on this till, which is
// what branch scoping exists to prevent. So the till is TOLD instead, and
// offered the switch. Nothing is hidden; nothing leaks.
// ============================================================================
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCurrentBranchId, setCurrentBranchId } from '@/lib/store';

interface WaitingBranch {
  branchId: string;
  branchName: string;
  waiting: number;
  oldestAt: string | null;
  total: number;
}

const money = (n: number) => `Rs ${Math.round(Number(n) || 0).toLocaleString()}`;

function howLong(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} day${h < 48 ? '' : 's'}`;
}

export default function OrdersWaitingElsewhere() {
  const [rows, setRows] = useState<WaitingBranch[]>([]);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    try {
      const { sb, isSupabaseConfigured } = await import('@/lib/supabase');
      if (!isSupabaseConfigured()) return;
      const { data, error } = await sb().rpc('orders_waiting_by_branch' as never, {} as never);
      if (error) return;                       // staff PIN session, offline — stay quiet
      const res = data as { ok?: boolean; branches?: WaitingBranch[] } | null;
      if (!res?.ok || !Array.isArray(res.branches)) return;

      // Only OTHER branches. Orders on this one already show on the till.
      const here = getCurrentBranchId();
      setRows(res.branches.filter(b => b.branchId !== here && Number(b.waiting) > 0));
    } catch { /* never block the POS on this */ }
  };

  useEffect(() => {
    void look();
    const t = window.setInterval(() => void look(), 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (rows.length === 0) return null;

  const switchTo = (b: WaitingBranch) => {
    setBusy(true);
    setCurrentBranchId(b.branchId);
    // A reload is the honest way to do this: the orders pull, the realtime
    // listener and the counters are all bound to the branch at start-up, so
    // swapping it underneath them would leave half the screen on the old one.
    window.location.reload();
  };

  const total = rows.reduce((s, b) => s + Number(b.waiting || 0), 0);

  return (
    <div className="mx-3 mt-3 rounded-xl border-2 border-status-warning bg-status-warning/10 p-3">
      <div className="flex items-start gap-3 flex-wrap">
        <AlertTriangle className="h-5 w-5 text-status-warning shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">
            {total} online order{total === 1 ? '' : 's'} waiting at another branch
          </div>
          <p className="text-xs text-muted-foreground">
            A customer ordered against a different branch, so this till does not show it.
            Switch branch to take it.
          </p>
          <div className="mt-2 space-y-1.5">
            {rows.map(b => (
              <div key={b.branchId} className="flex items-center gap-2 flex-wrap text-xs bg-background/70 rounded-lg px-2.5 py-1.5 border">
                <span className="font-bold">{b.branchName.trim()}</span>
                <span className="text-muted-foreground">
                  {b.waiting} order{Number(b.waiting) === 1 ? '' : 's'} · {money(b.total)}
                  {b.oldestAt && ` · oldest ${howLong(b.oldestAt)} ago`}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => switchTo(b)}
                >
                  Switch <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void look()} title="Check again">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
