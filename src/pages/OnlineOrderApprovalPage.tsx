// ============================================================
// Online Order Approval — review / approve / reject incoming orders
// from website, QR, order taker, and delivery channels.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getSettings, saveSettings, onDataChange } from '@/lib/store';
import { approveOrder, rejectOrder, sourceKeyForOrder, REJECT_REASONS, SOURCE_LABELS, resolveApprovalMode } from '@/lib/onlineApproval';
import type { Order, OnlineSourceKey, ApprovalMode, ApprovalModeSetting } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Phone, MessageCircle, Check, X, Clock, Globe, QrCode, ClipboardList, Truck, ShoppingBag, AlertCircle, UserX } from 'lucide-react';
import { blockCustomer } from '@/lib/blocklist';
import { toast } from 'sonner';

const SOURCE_TABS: { key: OnlineSourceKey; label: string; Icon: typeof Globe }[] = [
  { key: 'website', label: 'Website', Icon: Globe },
  { key: 'takeaway_qr', label: 'Takeaway QR', Icon: ShoppingBag },
  { key: 'qr', label: 'Table QR', Icon: QrCode },
  { key: 'order_taker', label: 'Order Taker', Icon: ClipboardList },
  { key: 'delivery', label: 'Delivery', Icon: Truck },
];

function fmtTime(iso?: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); } catch { return iso; }
}

function whatsappLink(phone: string, orderNo?: number) {
  const num = (phone || '').replace(/\D/g, '');
  if (!num) return '';
  const msg = encodeURIComponent(`Hello! I would like to talk about your order #${orderNo || ''}.`);
  return `https://wa.me/${num.startsWith('0') ? '92' + num.slice(1) : num}?text=${msg}`;
}

export default function OnlineOrderApprovalPage() {
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [tab, setTab] = useState<OnlineSourceKey>('website');
  const [showHistory, setShowHistory] = useState(false);
  const [rejectFor, setRejectFor] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState<string>(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const [settingsTick, setSettingsTick] = useState(0);

  useEffect(() => {
    const off = onDataChange(c => { if (c === 'orders' || c === '*') setOrders(getOrders()); });
    return off;
  }, []);

  const settings = getSettings();
  const globalMode: ApprovalMode = settings.onlineOrderApprovalMode || 'auto';

  const buckets = useMemo(() => {
    const out: Record<OnlineSourceKey, { pending: Order[]; history: Order[] }> = {
      website: { pending: [], history: [] }, qr: { pending: [], history: [] }, takeaway_qr: { pending: [], history: [] },
      order_taker: { pending: [], history: [] }, delivery: { pending: [], history: [] },
    };
    for (const o of orders) {
      const k = sourceKeyForOrder(o);
      if (!k) continue;
      if (o.status === 'pending_approval') out[k].pending.push(o);
      else if (o.status === 'rejected' || o.approvedAt) out[k].history.push(o);
    }
    return out;
  }, [orders]);

  const currentUser = (() => {
    try { const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null'); return { userId: u?.id as string | undefined, userName: (u?.name || u?.username) as string | undefined }; }
    catch { return { userId: undefined as string | undefined, userName: undefined as string | undefined }; }
  })();

  const handleApprove = (o: Order) => {
    approveOrder(o.id, currentUser);
    toast.success(`Order #${o.orderNumber} approved — KOT sent`);
  };

  const submitReject = () => {
    if (!rejectFor) return;
    const reason = rejectNote.trim() ? `${rejectReason} — ${rejectNote.trim()}` : rejectReason;
    rejectOrder(rejectFor.id, reason, currentUser);
    toast.success(`Order #${rejectFor.orderNumber} rejected`);
    setRejectFor(null); setRejectNote(''); setRejectReason(REJECT_REASONS[0]);
  };

  const setGlobalMode = (m: ApprovalMode) => {
    saveSettings({ ...getSettings(), onlineOrderApprovalMode: m });
    setSettingsTick(t => t + 1);
    toast.success(`Global mode: ${m === 'auto' ? 'Auto Processing' : 'Manual Approval'}`);
  };

  const setSourceMode = (key: OnlineSourceKey, m: ApprovalModeSetting) => {
    const s = getSettings();
    saveSettings({ ...s, sourceApprovalMode: { ...(s.sourceApprovalMode || {}), [key]: m } });
    setSettingsTick(t => t + 1);
  };

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><AlertCircle className="w-6 h-6 text-primary" /> Online Order Approval</h1>
          <p className="text-sm text-muted-foreground">Review &amp; approve incoming orders before they reach the kitchen</p>
        </div>
        <button onClick={() => setShowHistory(h => !h)} className="text-xs border rounded px-3 py-1.5 hover:bg-muted">
          {showHistory ? 'Show Pending' : 'Show History'}
        </button>
      </div>

      {/* Mode settings */}
      <div className="border rounded-lg p-4 bg-card space-y-3" key={settingsTick}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-sm">Processing Mode</div>
            <div className="text-xs text-muted-foreground">Manual = cashier review required • Auto = straight to kitchen</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setGlobalMode('auto')} className={`px-3 py-1.5 text-xs rounded border ${globalMode === 'auto' ? 'bg-status-success text-white border-status-success' : 'hover:bg-muted'}`}>Auto Processing</button>
            <button onClick={() => setGlobalMode('manual')} className={`px-3 py-1.5 text-xs rounded border ${globalMode === 'manual' ? 'bg-status-warning text-white border-status-warning' : 'hover:bg-muted'}`}>Manual Approval</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t">
          {SOURCE_TABS.map(s => {
            const cur = settings.sourceApprovalMode?.[s.key] || 'inherit';
            return (
              <div key={s.key} className="text-xs">
                <div className="font-medium mb-1 flex items-center gap-1"><s.Icon className="w-3 h-3" /> {s.label}</div>
                <select value={cur} onChange={e => setSourceMode(s.key, e.target.value as ApprovalModeSetting)} className="w-full border rounded px-2 py-1 bg-background">
                  <option value="inherit">Inherit (Global)</option>
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as OnlineSourceKey)}>
        <TabsList className="w-full justify-start flex-wrap h-auto">
          {SOURCE_TABS.map(s => {
            const count = buckets[s.key].pending.length;
            return (
              <TabsTrigger key={s.key} value={s.key} className="gap-2">
                <s.Icon className="w-3.5 h-3.5" /> {s.label}
                {count > 0 && <span className="bg-status-warning text-white text-[10px] rounded-full px-1.5 min-w-[18px] text-center">{count}</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SOURCE_TABS.map(s => {
          const list = showHistory ? buckets[s.key].history : buckets[s.key].pending;
          return (
            <TabsContent key={s.key} value={s.key} className="mt-4">
              {list.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12 border-2 border-dashed rounded-lg">
                  {showHistory ? 'No history yet for this source.' : `No pending ${SOURCE_LABELS[s.key]} orders.`}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map(o => (
                    <OrderCard key={o.id} o={o} historyMode={showHistory} onApprove={() => handleApprove(o)} onReject={() => setRejectFor(o)} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Reject modal */}
      {rejectFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRejectFor(null)}>
          <div className="bg-card border rounded-lg max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold">Reject Order #{rejectFor.orderNumber}</h3>
            <div className="space-y-2 text-sm">
              <label className="block text-xs font-semibold">Reason</label>
              <select value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border rounded px-2 py-2 bg-background">
                {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <label className="block text-xs font-semibold pt-2">Additional Note (optional)</label>
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} className="w-full border rounded px-2 py-2 bg-background" rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setRejectFor(null)} className="flex-1 border rounded py-2 text-sm hover:bg-muted">Cancel</button>
              <button onClick={submitReject} className="flex-1 bg-status-danger text-white rounded py-2 text-sm font-semibold hover:opacity-90">Reject Order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, onApprove, onReject, historyMode }: { o: Order; onApprove: () => void; onReject: () => void; historyMode: boolean }) {
  const phone = o.customer?.phone || '';
  const isRejected = o.status === 'rejected';
  const isApproved = !!o.approvedAt;
  return (
    <div className={`border-2 rounded-lg bg-card p-4 space-y-3 ${isRejected ? 'border-status-danger/40' : isApproved ? 'border-status-success/40' : 'border-status-warning/40'}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-base">#{o.orderNumber} <span className="text-xs font-normal text-muted-foreground">• {SOURCE_LABELS[sourceKeyForOrder(o) || 'website']}</span></div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtTime(o.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-lg">{money(o.grandTotal)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{o.paymentMethod || '—'}</div>
        </div>
      </div>

      <div className="text-sm space-y-1 bg-muted/30 rounded p-2">
        <div><b>{o.customer?.name || o.tableName || 'Walk-in'}</b></div>
        {phone && <div className="text-xs text-muted-foreground">📞 {phone}</div>}
        {o.customer?.address && <div className="text-xs text-muted-foreground">📍 {o.customer.address}</div>}
        {o.tableName && <div className="text-xs">🪑 {o.tableName}</div>}
        {o.notes && <div className="text-xs italic">💬 {o.notes}</div>}
      </div>

      <div className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
        {o.items.map(it => (
          <div key={it.id} className="flex justify-between">
            <span>{it.quantity}× {it.name}</span>
            <span className="text-muted-foreground">{money(it.lineTotal)}</span>
          </div>
        ))}
      </div>

      {historyMode ? (
        <div className="text-xs border-t pt-2">
          {isRejected ? (
            <div className="text-status-danger"><b>Rejected:</b> {o.rejectedReason} • by {o.rejectedByName || '—'} • {fmtTime(o.rejectedAt)}</div>
          ) : (
            <div className="text-status-success"><b>Approved</b> by {o.approvedByName || '—'} • {fmtTime(o.approvedAt)}</div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <button onClick={onApprove} className="flex-1 min-w-[120px] bg-status-success text-white text-xs font-semibold py-2 rounded flex items-center justify-center gap-1 hover:opacity-90">
            <Check className="w-3.5 h-3.5" /> Approve &amp; Send
          </button>
          <button onClick={onReject} className="flex-1 min-w-[80px] bg-status-danger text-white text-xs font-semibold py-2 rounded flex items-center justify-center gap-1 hover:opacity-90">
            <X className="w-3.5 h-3.5" /> Reject
          </button>
          {phone && (
            <>
              <a href={`tel:${phone}`} className="px-3 py-2 border rounded text-xs hover:bg-muted flex items-center gap-1"><Phone className="w-3 h-3" /> Call</a>
              <a href={whatsappLink(phone, o.orderNumber)} target="_blank" rel="noreferrer" className="px-3 py-2 border rounded text-xs hover:bg-muted flex items-center gap-1"><MessageCircle className="w-3 h-3" /> WhatsApp</a>
              <button
                onClick={() => {
                  const reason = window.prompt(`Block customer ${o.customer?.name || phone}?\n\nReason:`, 'Repeat fake orders');
                  if (!reason) return;
                  blockCustomer({ name: o.customer?.name || 'Unknown', phone, reason });
                  toast.success('Customer blocked');
                }}
                className="px-3 py-2 border rounded text-xs hover:bg-status-danger/10 hover:text-status-danger flex items-center gap-1"
                title="Block this customer"
              ><UserX className="w-3 h-3" /> Block</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
