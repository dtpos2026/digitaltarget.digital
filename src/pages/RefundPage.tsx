// ============================================================
// v1.15.0 — Refund screen
//
// Find a completed bill, choose what is coming back, state a reason,
// choose how the money is returned, and optionally restock. The engine
// enforces the money rules; this screen only collects the decision and
// shows the consequences before anything is committed.
// ============================================================
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, RotateCcw, Undo2 } from 'lucide-react';
import { getOrders, getRefundsForOrder, createRefund, getSettings } from '@/lib/store';
import { buildRefund, refundableQty, maxRefundable } from '@/lib/refunds';
import { money } from '@/lib/currency';
import type { Order } from '@/lib/types';

export default function RefundPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [restock, setRestock] = useState(true);
  const [tick, setTick] = useState(0);

  const settings = getSettings();
  const customTypes: string[] = (settings as any).customPaymentTypesEnabled
    ? ((settings as any).customPaymentTypes || [])
    : [];

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return getOrders()
      .filter(o => ['paid', 'partial', 'credit_received'].includes(String(o.status)))
      .filter(o => String(o.orderNumber).includes(q)
        || String(o.customer?.name || '').toLowerCase().includes(q)
        || String(o.customer?.phone || '').includes(q))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }, [query, tick]);

  const prior = useMemo(() => (selected ? getRefundsForOrder(selected.id) : []), [selected, tick]);
  const cap = useMemo(() => (selected ? maxRefundable(selected, prior) : 0), [selected, prior]);

  const preview = useMemo(() => {
    if (!selected) return null;
    const total = Object.entries(qty).reduce((s, [lineId, n]) => {
      const line = selected.items.find(l => l.id === lineId);
      if (!line || n <= 0) return s;
      return s;
    }, 0);
    void total;
    // Ask the engine for the authoritative preview (money rules live there).
    const check = buildRefund(selected, prior, {
      quantities: qty,
      reason: reason || 'preview',
      by: 'preview',
      payments: [],
      restock,
    });
    return check.preview || null;
  }, [selected, qty, prior, reason, restock]);

  const doRefund = () => {
    if (!selected || !preview) return;
    const res = createRefund(selected.id, {
      quantities: qty,
      reason,
      by: 'staff',
      payments: [{ method, amount: preview.total }],
      restock,
    });
    if (!res.ok) {
      toast.error(res.errors?.join(' · ') || 'Refund nahi hui');
      return;
    }
    toast.success(`Refund ${money(res.refund!.total)} — Order #${selected.orderNumber}`);
    setQty({});
    setReason('');
    setTick(t => t + 1);
    setSelected(getOrders().find(o => o.id === selected.id) || null);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Undo2 className="h-5 w-5" /> Refund
      </h2>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Bill number, customer ka naam ya phone…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="mt-2 space-y-1 max-h-56 overflow-auto">
            {results.map(o => (
              <button
                key={o.id}
                onClick={() => { setSelected(o); setQty({}); setQuery(''); }}
                className="w-full text-left text-xs border rounded px-2 py-1.5 hover:bg-accent flex gap-2"
              >
                <span className="font-bold">#{o.orderNumber}</span>
                <span className="text-muted-foreground">
                  {new Date(o.createdAt).toLocaleString('en-GB')}
                </span>
                <span className="ml-auto font-mono">{money(o.grandTotal)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <>
          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-bold">Order #{selected.orderNumber}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(selected.createdAt).toLocaleString('en-GB')} · {money(selected.grandTotal)}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                Refund limit {money(cap)}
              </Badge>
            </div>

            {prior.length > 0 && (
              <div className="text-[11px] text-amber-700 border-t pt-1">
                Pehle {prior.length} refund ho chuki hain — kul {money(prior.reduce((s, r) => s + r.total, 0))}
              </div>
            )}

            <div className="space-y-1 pt-1">
              {selected.items.map(line => {
                const available = refundableQty(line, prior);
                const chosen = qty[line.id] || 0;
                return (
                  <div key={line.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                    <span className="flex-1 truncate">{line.name}</span>
                    <span className="text-muted-foreground">
                      {available} / {line.quantity} available
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        className="h-6 w-6 rounded border font-bold disabled:opacity-30"
                        disabled={chosen <= 0}
                        onClick={() => setQty(q => ({ ...q, [line.id]: Math.max(0, chosen - 1) }))}
                      >−</button>
                      <span className="w-6 text-center font-bold">{chosen}</span>
                      <button
                        className="h-6 w-6 rounded border font-bold disabled:opacity-30"
                        disabled={chosen >= available}
                        onClick={() => setQty(q => ({ ...q, [line.id]: Math.min(available, chosen + 1) }))}
                      >+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label className="text-xs">Refund ki wajah *</Label>
              <Input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. item was spoiled, customer cancelled"
              />
            </div>

            <div>
              <Label className="text-xs">Paisa kis tareeqe se wapas hua</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {['cash', 'card', ...customTypes].map(m => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold capitalize ${
                      method === m ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                    }`}
                  >{m}</button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={restock}
                onChange={e => setRestock(e.target.checked)}
              />
              Items wapas stock me daalein (retail items ke liye)
            </label>

            {preview && preview.total > 0 && (
              <div className="rounded-md bg-muted p-2 text-xs space-y-0.5 font-mono">
                <div className="flex"><span className="flex-1">Goods</span><span>{money(preview.subtotal)}</span></div>
                <div className="flex"><span className="flex-1">Tax</span><span>{money(preview.tax)}</span></div>
                <div className="flex font-bold border-t pt-0.5">
                  <span className="flex-1">Refund total</span><span>{money(preview.total)}</span>
                </div>
                <div className="text-[10px] text-muted-foreground pt-0.5">
                  {preview.kind === 'full' ? 'The full bill is being refunded' : 'Aanshik (partial) refund'}
                </div>
              </div>
            )}

            <Button
              onClick={doRefund}
              disabled={!preview || preview.total <= 0 || !reason.trim()}
              variant="destructive"
              className="w-full"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {preview && preview.total > 0 ? `Refund ${money(preview.total)}` : 'Select items'}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
