import { Order } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Printer, History, ChefHat, Receipt, Clock, ShieldCheck, FileText } from 'lucide-react';
import { enqueueKot, enqueueKotUpdate } from '@/lib/printQueue';
import { logOrderReprint } from '@/lib/store';
import { toast } from 'sonner';

interface Props {
  order: Order | null;
  onClose: () => void;
}

function fmtTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PK', { hour12: true });
}

function revTypeBadge(type: string) {
  const map: Record<string, string> = {
    NEW: 'bg-status-info/15 text-status-info border-status-info/30',
    ADD_ITEMS: 'bg-status-success/15 text-status-success border-status-success/30',
    QTY_UPDATE: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    CANCEL_ITEM: 'bg-destructive/15 text-destructive border-destructive/30',
    MIXED: 'bg-primary/15 text-primary border-primary/30',
  };
  return map[type] || 'bg-muted text-muted-foreground';
}

export default function OrderDetailDialog({ order, onClose }: Props) {
  if (!order) return null;
  const revisions = order.kotRevisions || [];
  const editLogs = order.editLogs || [];
  const CANCEL_ACTIONS = new Set(['CANCEL', 'CANCEL_ORDER', 'VOID', 'QTY_DOWN', 'QTY_DECREASE']);
  const cancelLogs = editLogs.filter(l => CANCEL_ACTIONS.has(l.action));
  const nonCancelEdits = editLogs.filter(l => !CANCEL_ACTIONS.has(l.action));

  const reprintOriginal = () => {
    if (revisions[0]) {
      enqueueKot(order, { force: true });
      logOrderReprint(order.id, 'kot');
      toast.success('Original KOT reprinted');
    } else {
      enqueueKot(order, { force: true });
      toast.success('KOT sent');
    }
  };
  const reprintLatest = () => {
    enqueueKotUpdate(order) || enqueueKot(order, { force: true });
    logOrderReprint(order.id, 'kot');
    toast.success('Latest KOT reprinted');
  };
  const reprintFull = () => {
    enqueueKot(order, { force: true });
    logOrderReprint(order.id, 'kot');
    toast.success('Full Order KOT printed');
  };

  return (
    <Dialog open={!!order} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Order #{order.orderNumber}
            <Badge variant="outline" className="capitalize">{order.orderType}</Badge>
            <Badge variant="outline" className="capitalize">{order.status}</Badge>
            {order.tableName && <Badge variant="secondary">{order.tableName}</Badge>}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="current">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="current"><FileText className="h-3.5 w-3.5 mr-1" />Current Bill</TabsTrigger>
            <TabsTrigger value="kot"><ChefHat className="h-3.5 w-3.5 mr-1" />KOT History</TabsTrigger>
            <TabsTrigger value="edits"><History className="h-3.5 w-3.5 mr-1" />Edit History</TabsTrigger>
            <TabsTrigger value="cancels"><History className="h-3.5 w-3.5 mr-1" />Cancel History</TabsTrigger>
            <TabsTrigger value="payment"><Receipt className="h-3.5 w-3.5 mr-1" />Payment</TabsTrigger>
            <TabsTrigger value="timeline"><Clock className="h-3.5 w-3.5 mr-1" />Kitchen Timeline</TabsTrigger>
            <TabsTrigger value="audit"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Audit Logs</TabsTrigger>
          </TabsList>

          {/* ====== CURRENT BILL ====== */}
          <TabsContent value="current" className="space-y-2 mt-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Created:</span> {fmtTime(order.createdAt)}</div>
              <div><span className="text-muted-foreground">Cashier:</span> {order.cashierName || '—'}</div>
              {order.waiterName && <div><span className="text-muted-foreground">Waiter:</span> {order.waiterName}</div>}
              {order.riderName && <div><span className="text-muted-foreground">Rider:</span> {order.riderName}</div>}
              {order.customer?.name && <div><span className="text-muted-foreground">Customer:</span> {order.customer.name}</div>}
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr><th className="text-left p-2">Item</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Price</th><th className="text-right p-2">Total</th></tr>
                </thead>
                <tbody>
                  {(order.items || []).map(it => (
                    <tr key={it.id} className="border-t">
                      <td className="p-2">{it.name}{it.note ? <div className="text-[10px] text-muted-foreground">{it.note}</div> : null}</td>
                      <td className="p-2 text-right">{it.quantity}</td>
                      <td className="p-2 text-right">{it.price}</td>
                      <td className="p-2 text-right">{it.lineTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-right text-sm font-bold">Grand Total: PKR {order.grandTotal.toLocaleString()}</div>
          </TabsContent>

          {/* ====== KOT HISTORY ====== */}
          <TabsContent value="kot" className="space-y-2 mt-3">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={reprintOriginal}><Printer className="h-3 w-3 mr-1" />Reprint Original KOT</Button>
              <Button size="sm" variant="outline" onClick={reprintLatest}><Printer className="h-3 w-3 mr-1" />Reprint Latest KOT</Button>
              <Button size="sm" variant="outline" onClick={reprintFull}><Printer className="h-3 w-3 mr-1" />Print Full Order KOT</Button>
            </div>
            {revisions.length === 0 ? (
              <p className="text-xs text-muted-foreground">No KOT printed yet.</p>
            ) : revisions.map(rev => (
              <div key={rev.kotNo} className="border rounded-md p-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap text-sm font-semibold">
                  <span>KOT #{rev.kotNo}</span>
                  <Badge className={`text-[10px] ${revTypeBadge(rev.type)}`}>{rev.type}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{fmtTime(rev.createdAt)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">By: {rev.createdByName || '—'} ({rev.createdByRole || '—'}) · {rev.deviceName || ''}</div>
                <ul className="text-xs list-disc pl-5">
                  {rev.lines.map((l, i) => (
                    <li key={i} className={l.deltaQty < 0 ? 'text-destructive' : ''}>
                      {l.deltaQty > 0 ? '+' : ''}{l.deltaQty} × {l.name}
                      {l.note ? <span className="text-muted-foreground"> — {l.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </TabsContent>

          {/* ====== EDIT HISTORY ====== */}
          <TabsContent value="edits" className="mt-3">
            {nonCancelEdits.length === 0 ? (
              <p className="text-xs text-muted-foreground">No edit history.</p>
            ) : (
              <ol className="relative border-l border-muted pl-4 space-y-3">
                {nonCancelEdits.map((l, i) => (
                  <li key={i} className="text-xs">
                    <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(l.at)}</div>
                    <div className="font-semibold">{l.action.replace(/_/g, ' ')}{l.itemName ? `: ${l.itemName}` : ''}</div>
                    {(l.oldValue !== undefined || l.newValue !== undefined) && (
                      <div>{l.oldValue !== undefined ? `${l.oldValue}` : ''}{l.oldValue !== undefined && l.newValue !== undefined ? ' → ' : ''}{l.newValue !== undefined ? `${l.newValue}` : ''}</div>
                    )}
                    {l.reason && <div className="text-muted-foreground">Reason: {l.reason}</div>}
                    <div className="text-[10px] text-muted-foreground">By: {l.userName || '—'} ({l.userRole || '—'}) · {l.deviceName || ''}</div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>

          {/* ====== CANCEL HISTORY ====== */}
          <TabsContent value="cancels" className="mt-3">
            {cancelLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cancellations.</p>
            ) : (
              <ol className="relative border-l border-destructive/40 pl-4 space-y-3">
                {cancelLogs.map((l, i) => (
                  <li key={i} className="text-xs">
                    <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(l.at)}</div>
                    <div className="font-semibold text-destructive">
                      {l.action.replace(/_/g, ' ')}{l.itemName ? `: ${l.itemName}` : ''}
                    </div>
                    {(l.oldValue !== undefined || l.newValue !== undefined) && (
                      <div>Qty: {l.oldValue ?? '—'} → {l.newValue ?? '—'}</div>
                    )}
                    {l.reason && <div className="text-muted-foreground">Reason: {l.reason}</div>}
                    <div className="text-[10px] text-muted-foreground">By: {l.userName || '—'} ({l.userRole || '—'}) · {l.deviceName || ''}</div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>


          {/* ====== PAYMENT ====== */}
          <TabsContent value="payment" className="mt-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Status:</span> {order.status}</div>
              <div><span className="text-muted-foreground">Method:</span> {order.paymentMethod || '—'}</div>
              <div><span className="text-muted-foreground">Account:</span> {order.paymentAccountName || '—'}</div>
              <div><span className="text-muted-foreground">Paid At:</span> {fmtTime(order.paidAt)}</div>
              <div><span className="text-muted-foreground">Cash Received:</span> {order.cashReceived ?? '—'}</div>
              <div><span className="text-muted-foreground">Change:</span> {order.changeReturned ?? '—'}</div>
              <div><span className="text-muted-foreground">Discount:</span> {order.discount || 0}{order.discountTitle ? ` (${order.discountTitle})` : ''}</div>
              <div><span className="text-muted-foreground">Grand Total:</span> PKR {order.grandTotal.toLocaleString()}</div>
            </div>
            {(order.reprintLog && order.reprintLog.length > 0) && (
              <div className="mt-2">
                <div className="font-semibold mb-1">Reprints</div>
                <ul className="space-y-0.5">
                  {order.reprintLog.map((r, i) => (
                    <li key={i}>{fmtTime(r.at)} — {r.type} by {r.by || '—'}</li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          {/* ====== KITCHEN TIMELINE ====== */}
          <TabsContent value="timeline" className="mt-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Order Created:</span> {fmtTime(order.createdAt)}</div>
              <div><span className="text-muted-foreground">Cooking Started:</span> {fmtTime(order.cookingStartedAt)}</div>
              <div><span className="text-muted-foreground">Ready At:</span> {fmtTime(order.readyAt)}</div>
              <div><span className="text-muted-foreground">Kitchen Status:</span> {order.kitchenStatus || '—'} ({fmtTime(order.kitchenStatusAt)})</div>
              {order.orderType === 'delivery' && (
                <>
                  <div><span className="text-muted-foreground">Dispatched:</span> {fmtTime(order.dispatchedAt)}</div>
                  <div><span className="text-muted-foreground">Delivered:</span> {fmtTime(order.deliveredAt)}</div>
                </>
              )}
            </div>
            <div className="mt-3 font-semibold">Per-KOT Timeline</div>
            <div className="space-y-1">
              {revisions.length === 0 && <p className="text-muted-foreground">No KOT yet.</p>}
              {revisions.map(rev => (
                <div key={rev.kotNo} className="border rounded p-2">
                  <div className="font-semibold">KOT #{rev.kotNo} ({rev.type})</div>
                  <div className="grid grid-cols-2 gap-x-2 text-[11px]">
                    <div>Created: {fmtTime(rev.createdAt)}</div>
                    <div>Printed: {fmtTime(rev.printedAt)}</div>
                    <div>Accepted: {fmtTime(rev.acceptedAt)}</div>
                    <div>Prepared: {fmtTime(rev.preparedAt)}</div>
                    <div>Served: {fmtTime(rev.servedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ====== AUDIT LOGS ====== */}
          <TabsContent value="audit" className="mt-3">
            {editLogs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No audit entries.</p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-1.5">Time</th>
                      <th className="text-left p-1.5">Action</th>
                      <th className="text-left p-1.5">Item</th>
                      <th className="text-left p-1.5">Old</th>
                      <th className="text-left p-1.5">New</th>
                      <th className="text-left p-1.5">Reason</th>
                      <th className="text-left p-1.5">User</th>
                      <th className="text-left p-1.5">Role</th>
                      <th className="text-left p-1.5">Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editLogs.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-1.5 font-mono">{fmtTime(l.at)}</td>
                        <td className="p-1.5">{l.action}</td>
                        <td className="p-1.5">{l.itemName || '—'}</td>
                        <td className="p-1.5">{l.oldValue ?? '—'}</td>
                        <td className="p-1.5">{l.newValue ?? '—'}</td>
                        <td className="p-1.5">{l.reason || '—'}</td>
                        <td className="p-1.5">{l.userName || '—'}</td>
                        <td className="p-1.5">{l.userRole || '—'}</td>
                        <td className="p-1.5">{l.deviceName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
