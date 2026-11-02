// DT Order Taker — Running bills (OTK-08) and Bill detail (OTK-09), v1.92.0.
//
// The order taker's own page for the Bills tab. The cashier's Running Bills page (RunningBillsPage) stays what it is for
// cashiers and managers: it carries payment, void and reprint, none of which an order taker may do. This one lists the
// open bills, shows one in full with what the kitchen has been told, and offers the two things an order taker does with
// a bill: add items (the POS opens the bill, as before) and call the cashier. Void, discount and payment stay with the
// cashier and the manager.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChefHat, Clock, FileText, Phone, Plus, Search } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { getOrders, getSettings, onDataChange, refreshOrdersFromCloud } from '@/lib/store';
import { scopeOrders } from '@/lib/cashierScope';
import { startVisiblePoll } from '@/lib/visiblePoll';
import { money } from '@/lib/currency';
import { ageText, billLines, cashierPhone, openBills, type BillRow, type BillState } from '@/lib/orderTakerBills';
import { Banner, EmptyState, RBadge, RButton, RCard, Sheet, Skeleton } from '@/components/rider/riderUi';
import type { StageTone } from '@/lib/riderApp';

const TONE: Record<BillState, StageTone> = { new: 'info', cooking: 'warn', ready: 'ok', served: 'neutral', waiting: 'accent', hold: 'neutral' };

export default function OrderTakerBills() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState(() => scopeOrders(getOrders()));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      try { await refreshOrdersFromCloud(); if (!cancel) setFailed(false); } catch { if (!cancel) setFailed(true); }
      if (!cancel) { setOrders(scopeOrders(getOrders())); setNow(Date.now()); setLoading(false); }
    };
    void pull();
    const stop = startVisiblePoll(pull, 10000);
    const off = onDataChange(c => { if (!cancel && c === 'orders') { setOrders(scopeOrders(getOrders())); setNow(Date.now()); } });
    return () => { cancel = true; stop(); off(); };
  }, []);

  const rows = useMemo(() => openBills(orders, q, now), [orders, q, now]);
  const shown = rows.find(r => r.id === open) || null;
  const phone = cashierPhone(getSettings());

  return (
    <div className="mx-auto max-w-[620px] space-y-3 p-4" data-otk-screen="bills">
      <label className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search table, order number or name" aria-label="Search bills" className="h-full flex-1 bg-transparent text-[15px] outline-none" />
      </label>
      {failed && <Banner tone="warn" icon={Clock}>Could not refresh. Showing the bills this phone already has.</Banner>}
      {loading && rows.length === 0 ? (
        <div className="space-y-2" aria-label="Loading">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[72px] w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={q ? 'No bill matches' : 'No open bills'} action={!q ? <RButton variant="primary" onClick={() => navigate('/')}>Take an order</RButton> : undefined}>
          {q ? 'Try another table or number.' : 'Bills you take appear here until the cashier closes them.'}
        </EmptyState>
      ) : (
        <div className="space-y-2" data-otk-bills>
          {rows.map(r => (
            <button key={r.id} type="button" className="block w-full text-left" onClick={() => setOpen(r.id)} data-otk-bill={r.id}>
              <RCard className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-extrabold">{r.label} · #{r.orderNumber}</div>
                  <div className="text-[13px] text-muted-foreground">{r.items} item{r.items === 1 ? '' : 's'} · {ageText(r.age)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15.5px] font-extrabold">{money(r.total)}</div>
                  <RBadge tone={TONE[r.state]} className="mt-0.5">{r.stateLabel}</RBadge>
                </div>
              </RCard>
            </button>
          ))}
        </div>
      )}
      <BillSheet row={shown} phone={phone} onClose={() => setOpen(null)} onAdd={(r: BillRow) => navigate('/?retrieve=' + r.id)} />
    </div>
  );
}

/** OTK-09 — what a table has ordered, whether the kitchen has it, and the two things to do about it. */
function BillSheet({ row, phone, onClose, onAdd }: { row: BillRow | null; phone: string | null; onClose: () => void; onAdd: (r: BillRow) => void }) {
  if (!row) return null;
  const lines = billLines(row.order);
  const notSent = lines.filter(l => !l.sent).length;
  return (
    <Sheet open onClose={onClose} label={`Bill #${row.orderNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[19px] font-extrabold">{row.label} · #{row.orderNumber}</h2>
        <RBadge tone={TONE[row.state]}>{row.stateLabel}</RBadge>
      </div>
      <ul className="max-h-[40dvh] divide-y overflow-y-auto" data-otk-lines>
        {lines.map(l => (
          <li key={l.key} className="flex items-start gap-3 py-2.5 text-[15px]">
            <span className={l.sent ? 'mt-0.5 text-[hsl(var(--rd-ok))]' : 'mt-0.5 text-[hsl(var(--rd-warn))]'} title={l.sent ? 'The kitchen has it' : 'Not sent to the kitchen yet'}>
              {l.sent ? <Check className="h-4 w-4" /> : <ChefHat className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">{l.text}{l.note && <span className="block text-[13px] text-muted-foreground">{l.note}</span>}</span>
            <span className="shrink-0 text-muted-foreground">{money(l.total)}</span>
          </li>
        ))}
      </ul>
      {notSent > 0 && <Banner tone="warn" icon={ChefHat}>{notSent} item{notSent === 1 ? ' is' : 's are'} not sent to the kitchen yet. Open the bill and send it.</Banner>}
      <div className="flex items-center justify-between border-t pt-3 text-[16px]"><span className="text-muted-foreground">Total</span><b className="text-[20px]">{money(row.total)}</b></div>
      <RButton variant="primary" size="lg" className="w-full" icon={Plus} onClick={() => onAdd(row)}>Add items</RButton>
      {phone
        ? <a href={`tel:${phone}`} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-card text-[15px] font-bold"><Phone className="h-4 w-4" />Call the cashier</a>
        : <RButton className="w-full" icon={Phone} disabled>No cashier number set</RButton>}
      <p className="text-center text-[12.5px] text-muted-foreground">Payment, discounts and void stay with the cashier and the manager.</p>
    </Sheet>
  );
}
