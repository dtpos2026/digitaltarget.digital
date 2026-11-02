// ============================================================
// The customer's own bill, on the Customer Display, while it is being rung up.
//
// Customer-facing only: what they ordered, how much, and the totals in the same
// words as their receipt. It reads only the LiveBill contract (lib/liveBill.ts),
// which carries no staff, kitchen, table-note, phone or address data at all.
// Colours come from the display template's CSS variables, sizes from clamp(),
// so it fits a counter monitor as well as a TV.
// ============================================================
import { useEffect, useRef } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { LiveBill } from '@/lib/liveBill';
import { scaledFont } from '@/lib/displayTemplates';

interface Props {
  bill: LiveBill;
  /** Settings → Display → Show Live Order Items. */
  showItems: boolean;
  /** Settings → Display → Show Total Amount. */
  showTotal: boolean;
  currency?: string;
  template: { typeScale: number };
  /** Full width (small screens): the board steps aside while a customer is being served. */
  full?: boolean;
}

const TYPE_LABEL: Record<LiveBill['orderType'], string> = {
  dining: 'Dine-In', takeaway: 'Takeaway', delivery: 'Delivery', other: '',
};

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-PK') : n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function LiveBillPanel({ bill, showItems, showTotal, currency = 'Rs', template, full = false }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // The item just added is the one the customer is looking for: keep the end of the list in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bill.lines.length, bill.at]);

  const cur = currency.trim() || 'Rs';
  const row = (label: string, value: string, opts: { strong?: boolean; tone?: string } = {}) => (
    <div className="flex items-baseline justify-between gap-3" style={{ fontWeight: opts.strong ? 800 : 600, color: opts.tone }}>
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );

  return (
    <aside
      data-testid="live-bill"
      aria-label="Your order"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{
        width: full ? undefined : 'clamp(300px, 34vw, 620px)',
        flex: full ? '1 1 auto' : '0 0 auto',
        margin: '1.2vw',
        marginLeft: full ? '1.2vw' : 0,
        borderRadius: 'var(--dt-radius)',
        background: 'var(--dt-panel)',
        color: 'var(--dt-on-panel)',
        boxShadow: '0 10px 30px -12px rgba(0,0,0,.35)',
      }}
    >
      <div
        className="m-[0.6vw] flex shrink-0 items-center gap-3 px-[1.2vw] py-[1.2vh]"
        style={{ borderRadius: 'calc(var(--dt-radius) * 0.8)', background: 'var(--dt-accent)', color: 'var(--dt-on-accent)' }}
      >
        <ShoppingBag style={{ width: '1.4em', height: '1.4em' }} />
        <h2 className="font-black tracking-wide" style={{ fontSize: scaledFont(1.4, template.typeScale, 0.6) }}>Your order</h2>
        <span className="ml-auto font-bold opacity-85" style={{ fontSize: scaledFont(0.95, template.typeScale, 0.4) }}>
          {TYPE_LABEL[bill.orderType]}{TYPE_LABEL[bill.orderType] ? ' · ' : ''}{qtyFmt(bill.itemCount)} item{bill.itemCount === 1 ? '' : 's'}
        </span>
      </div>

      {showItems ? (
        <div ref={listRef} data-testid="live-bill-lines" className="min-h-0 flex-1 overflow-y-auto px-[1.2vw]" style={{ fontSize: scaledFont(1.05, template.typeScale, 0.42) }}>
          {bill.lines.map((l, i) => (
            <div key={i} className="flex items-baseline gap-3 border-b py-[0.9vh] last:border-b-0" style={{ borderColor: 'var(--dt-panel-border)' }}>
              <span className="shrink-0 font-black tabular-nums" style={{ minWidth: '2.6em' }}>{qtyFmt(l.qty)} ×</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
              <span className="shrink-0 font-bold tabular-nums">{fmt(l.amount)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {showTotal && (
        <div className="m-[0.6vw] shrink-0 space-y-[0.5vh] px-[0.8vw] pb-[0.6vh] pt-[1vh]" style={{ borderTop: '2px solid var(--dt-panel-border)', fontSize: scaledFont(1, template.typeScale, 0.4) }}>
          {row('Subtotal', fmt(bill.subtotal))}
          {bill.discount > 0 && row(bill.discountLabel || 'Discount', `-${fmt(bill.discount)}`)}
          {bill.serviceCharge > 0 && row(bill.serviceChargeLabel || 'Service Charge', fmt(bill.serviceCharge))}
          {bill.tax > 0 && row('Tax', fmt(bill.tax))}
          {bill.delivery > 0 && row('Delivery', fmt(bill.delivery))}
          <div
            data-testid="live-bill-total"
            className="mt-[0.8vh] flex items-baseline justify-between gap-3 px-[1vw] py-[1.2vh] font-black"
            style={{ borderRadius: 'calc(var(--dt-radius) * 0.7)', background: 'var(--dt-accent)', color: 'var(--dt-on-accent)', fontSize: scaledFont(2, template.typeScale, 0.8) }}
          >
            <span>TOTAL</span>
            <span className="tabular-nums">{cur} {fmt(bill.total)}</span>
          </div>
          {bill.received != null && (
            <div className="flex justify-between gap-3 pt-[0.4vh] font-bold" style={{ fontSize: scaledFont(1.1, template.typeScale, 0.45) }}>
              <span>Paid {fmt(bill.received)}</span>
              <span>Change {fmt(bill.change || 0)}</span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
