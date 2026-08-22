// ============================================================
// Manager / Admin Bill Editor.
// Search any order, change qty, soft-void items with reason, add
// new items from menu, void / cancel the whole order — every
// mutation flows through saveOrder() so the audit trail is
// captured automatically in editLogs. Right panel shows the live
// timeline for that order.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Edit3, Search, Plus, Minus, Trash2, Ban, Save, FileText, History,
  ShoppingBag, Printer, X, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getOrders, saveOrder, getMenuItems, getCategories, getCurrentUser, logOrderReprint,
  getSettings,
} from '@/lib/store';
import { userHasAccess } from '@/lib/permissions';
import ManagerAuthDialog from '@/components/ManagerAuthDialog';
import { enqueueReceipt, enqueueKot, computeKotDiff, enqueueKotUpdate } from '@/lib/printQueue';
import { makeEditLog } from '@/lib/orderHistory';
import type { Order, CartItem, MenuItem, OrderEditAction } from '@/lib/types';

const ACTION_LABEL: Record<OrderEditAction, string> = {
  CREATE: 'Created', ADD: 'Item Added', QTY_UP: 'Qty +', QTY_DOWN: 'Qty −',
  QTY_INCREASE: 'Qty Increased', QTY_DECREASE: 'Qty Decreased', REPLACE: 'Item Replaced',
  CANCEL: 'Item Cancelled', DISCOUNT: 'Discount', PAYMENT: 'Paid',
  VOID: 'Voided', COMPLIMENTARY: 'Complimentary', CANCEL_ORDER: 'Order Cancelled',
  STATUS: 'Status', REPRINT: 'Reprint', NOTE: 'Note',
};

export default function BillEditorPage() {
  const user = getCurrentUser();
  const canEdit = userHasAccess(user as any, 'bill-editor') || ['admin', 'manager'].includes((user?.role || '').toLowerCase());

  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // working copy of selected order — dirty until saved
  const [draft, setDraft] = useState<Order | null>(null);
  const [dirty, setDirty] = useState(false);

  // dialogs
  const [voidItemId, setVoidItemId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidOrderOpen, setVoidOrderOpen] = useState(false);
  const [voidOrderReason, setVoidOrderReason] = useState('');
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [menuCat, setMenuCat] = useState<string>('all');

  const reload = () => setOrders(getOrders());

  const selected = useMemo(() => orders.find(o => o.id === selectedId) || null, [orders, selectedId]);
  useEffect(() => {
    if (selected) { setDraft(JSON.parse(JSON.stringify(selected))); setDirty(false); }
    else { setDraft(null); setDirty(false); }
  }, [selectedId, selected?.id]);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders
      .filter(o => {
        if (statusFilter === 'open' && !['running', 'pending', 'hold', 'partial', 'pending_approval', 'credit_pending'].includes(o.status)) return false;
        if (statusFilter === 'paid' && o.status !== 'paid') return false;
        if (statusFilter === 'void' && !['void', 'cancelled'].includes(o.status)) return false;
        if (!q) return true;
        return String(o.orderNumber).includes(q)
          || (o.customer?.phone || '').toLowerCase().includes(q)
          || (o.customer?.name || '').toLowerCase().includes(q)
          || (o.tableLabel || '').toLowerCase().includes(q);
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 100);
  }, [orders, search, statusFilter]);


  // ===== Item mutations on draft =====
  const updateItemQty = (id: string, delta: number) => {
    if (!draft) return;
    const next = { ...draft, items: draft.items.flatMap(it => {
      if (it.id !== id) return [it];
      const q = it.quantity + delta;
      if (q <= 0) return [it]; // can't go to 0 here — use Void
      return [{ ...it, quantity: q, lineTotal: q * it.price }];
    }) };
    recalcTotals(next);
    setDraft(next); setDirty(true);
  };

  // ===== v1.2.5: item remove par Manager password (optional) =====
  // Setting OFF ho to behaviour bilkul pehle jaisa hai.
  const [authFor, setAuthFor] = useState<string | null>(null);
  const openVoidItem = (id: string) => {
    try {
      if (getSettings()?.requirePasswordForItemRemove) { setAuthFor(id); return; }
    } catch {}
    setVoidItemId(id); setVoidReason('');
  };
  const onAuthorized = (byName: string) => {
    const id = authFor;
    setAuthFor(null);
    if (!id) return;
    setAuthorizedBy(byName);
    setVoidItemId(id); setVoidReason('');
    toast.success(`Authorized by ${byName}`);
  };
  const [authorizedBy, setAuthorizedBy] = useState<string>('');
  const confirmVoidItem = () => {
    if (!draft || !voidItemId) return;
    if (!voidReason.trim()) { toast.error('A reason is required'); return; }
    const removed = draft.items.find(i => i.id === voidItemId);
    const next: Order = { ...draft, items: draft.items.filter(i => i.id !== voidItemId) };
    recalcTotals(next);
    // stamp reason into a NOTE log so the audit shows why
    (next as any).__pendingNote = {
      item: removed?.name,
      reason: authorizedBy ? `${voidReason.trim()} [authorized by ${authorizedBy}]` : voidReason.trim(),
    };
    setDraft(next); setDirty(true);
    setVoidItemId(null);
    setAuthorizedBy('');
  };

  const addMenuItem = (m: MenuItem) => {
    if (!draft) return;
    if (m.pricingType !== 'fixed') { toast.error('Only fixed-price items can be added'); return; }
    const newLine: CartItem = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      menuItemId: m.id, name: m.name, pricingType: 'fixed', price: m.price,
      quantity: 1, lineTotal: m.price, note: '', printedQty: 0,
    };
    const next: Order = { ...draft, items: [...draft.items, newLine] };
    recalcTotals(next);
    setDraft(next); setDirty(true);
  };

  function recalcTotals(o: Order) {
    o.subtotal = o.items.reduce((s, i) => s + i.lineTotal, 0);
    o.grandTotal = Math.max(0, o.subtotal - (o.discount || 0)) + (o.tax || 0) + (o.serviceCharge || 0);
  }

  const setDiscount = (raw: string) => {
    if (!draft) return;
    const v = Math.max(0, Math.min(draft.subtotal, Number(raw) || 0));
    const next: Order = { ...draft, discount: v, discountTitle: v > 0 ? (draft.discountTitle || 'Manager discount') : undefined };
    recalcTotals(next);
    setDraft(next); setDirty(true);
  };

  const saveDraft = () => {
    if (!draft) return;
    const pending = (draft as any).__pendingNote;
    delete (draft as any).__pendingNote;
    saveOrder(draft);
    // Append manual reason note after the auto-diff has run
    if (pending?.reason) {
      const fresh = getOrders().find(o => o.id === draft.id);
      if (fresh) {
        fresh.editLogs = [
          ...(fresh.editLogs || []),
          makeEditLog('NOTE', { itemName: pending.item, reason: pending.reason, newValue: 'Manager void reason' }),
        ];
        saveOrder(fresh);
      }
    }
    // ===== v1.2.4: kitchen ko sirf CHANGE batao =====
    // Pehle bill edit save karne par kitchen ko KUCH nahi jata tha — cashier
    // majboori me full "Reprint KOT" dabata tha aur kitchen duplicate bana deta.
    // Ab: agar pehli KOT ja chuki hai aur items badle hain, sirf delta slip
    // (naye/extra items + CANCELLED lines) automatically kitchen ko jati hai.
    try {
      const s = getSettings();
      if (s.kotEnabled !== false) {
        const fresh2 = getOrders().find(o => o.id === draft.id);
        if (fresh2?.kotPrinted) {
          const diff = computeKotDiff(fresh2);
          if (diff.hasDiff) {
            enqueueKotUpdate(fresh2);
            const adds = diff.diffItemIds.length;
            const cancels = Object.keys(diff.cancelDeltas).length;
            toast.success(`KOT update sent to the kitchen — ${adds} new${cancels ? `, ${cancels} cancelled` : ''}`);
          }
        }
      }
    } catch {}
    toast.success('Changes saved — audit log updated');
    reload(); setDirty(false);
  };

  const voidWholeOrder = () => {
    if (!draft) return;
    if (!voidOrderReason.trim()) { toast.error('A void reason is required'); return; }
    const next: Order = { ...draft, status: 'void', voidReason: voidOrderReason.trim(), voidedAt: new Date().toISOString() } as any;
    saveOrder(next);
    toast.success('Order voided');
    setVoidOrderOpen(false); setVoidOrderReason('');
    reload();
  };

  const reprintReceipt = async () => {
    if (!draft) return;
    try {
      enqueueReceipt(draft, { force: true });
      logOrderReprint(draft.id, 'receipt', user?.name);
      toast.success('Receipt reprint sent');
      reload();
    } catch (e: any) { toast.error(e?.message || 'Reprint failed'); }
  };
  const reprintKot = async () => {
    if (!draft) return;
    try {
      enqueueKot(draft, { force: true });
      logOrderReprint(draft.id, 'kot', user?.name);
      toast.success('KOT reprint sent');
      reload();
    } catch (e: any) { toast.error(e?.message || 'Reprint failed'); }
  };

  const menuItems = useMemo(() => getMenuItems().filter(m => m.isActive !== false), []);
  const categories = useMemo(() => getCategories(), []);
  const filteredMenu = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    return menuItems.filter(m =>
      (menuCat === 'all' || m.categoryId === menuCat)
      && (!q || m.name.toLowerCase().includes(q)),
    ).slice(0, 60);
  }, [menuItems, menuCat, menuSearch]);

  // ===== v1.18.1 — conditional hooks fixed =====
  // This early return used to sit ABOVE useState(authFor), useState(authorizedBy)
  // and three useMemo calls. React identifies hooks by call ORDER, so a render
  // where canEdit was false called five fewer hooks than one where it was true.
  // Flipping between the two — which happens the moment a role loads, or an
  // Admin hands the till to a cashier — misaligns the hook list and React
  // either throws "rendered fewer hooks than expected" or, worse, silently
  // hands one hook's state to another. On this page that means a bill's draft
  // state landing in an unrelated field.
  //
  // Every hook now runs unconditionally; the guard renders after them.
  if (!canEdit) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center max-w-md mx-auto border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-8 w-8 text-amber-600 mx-auto mb-2" />
          <h3 className="font-bold text-sm">Access Denied</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Bill Editor sirf Admin / Manager role ke liye hai.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 lg:p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-primary" /> Bill Editor — Manager / Admin
          </h2>
          <p className="text-xs text-muted-foreground">
            Bill / KOT bn jane ke baad bhi koi bhi change — har action permanent audit log me jata hai.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
        {/* LEFT — order list */}
        <Card className="p-2 space-y-2 h-[calc(100vh-160px)] flex flex-col">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Order# / phone / table…"
                className="pl-8 h-9 text-xs"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open / Running</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="void">Void / Cancelled</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {visibleOrders.length === 0 && (
              <div className="text-center text-muted-foreground text-xs italic py-6">No orders.</div>
            )}
            {visibleOrders.map(o => {
              const active = o.id === selectedId;
              return (
                <button
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left rounded-lg border px-2.5 py-2 transition-smooth ${
                    active ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-sm">#{o.orderNumber}</div>
                    <Badge variant="outline" className="text-[9px]">{o.status}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center justify-between">
                    <span className="truncate">{o.customer?.name || o.tableLabel || o.orderType}</span>
                    <span className="font-bold">{money(o.grandTotal)}</span>
                  </div>
                  {(o.editLogs?.length || 0) > 1 && (
                    <div className="text-[9px] text-amber-700 flex items-center gap-1 mt-0.5">
                      <History className="h-2.5 w-2.5" /> {o.editLogs!.length} log entries
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* RIGHT — editor */}
        <div className="space-y-3">
          {!draft ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-50" />
              Left side se koi order select karen.
            </Card>
          ) : (
            <>
              {/* header */}
              <Card className="p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base">Order #{draft.orderNumber}</h3>
                      <Badge variant="outline" className="text-[10px]">{draft.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">{draft.orderType}</Badge>
                      {draft.kotPrinted && <Badge className="text-[10px] bg-emerald-600">KOT Printed</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {draft.customer?.name || '—'}
                      {draft.customer?.phone ? ` · ${draft.customer.phone}` : ''}
                      {draft.tableLabel ? ` · ${draft.tableLabel}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button size="sm" variant="outline" onClick={reprintReceipt}>
                      <Printer className="h-3 w-3 mr-1" /> Receipt
                    </Button>
                    <Button size="sm" variant="outline" onClick={reprintKot}>
                      <Printer className="h-3 w-3 mr-1" /> KOT
                    </Button>
                    {!['void', 'cancelled'].includes(draft.status) && (
                      <Button size="sm" variant="outline" className="text-red-600 border-red-300"
                        onClick={() => { setVoidOrderOpen(true); setVoidOrderReason(''); }}>
                        <Ban className="h-3 w-3 mr-1" /> Void Order
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3">
                {/* items */}
                <Card className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-sm">Items</h4>
                    <Button size="sm" onClick={() => setAddItemOpen(true)}>
                      <Plus className="h-3 w-3 mr-1" /> Add Item
                    </Button>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left p-1.5">Item</th>
                        <th className="text-right p-1.5">Price</th>
                        <th className="text-center p-1.5 w-28">Qty</th>
                        <th className="text-right p-1.5">Total</th>
                        <th className="p-1.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.items.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-muted-foreground italic p-4">No items.</td></tr>
                      )}
                      {draft.items.map(it => (
                        <tr key={it.id} className="border-t">
                          <td className="p-1.5">
                            <div className="font-medium">{it.name}</div>
                            {it.note && <div className="text-[10px] text-muted-foreground">{it.note}</div>}
                            {(it.printedQty || 0) > 0 && (
                              <div className="text-[9px] text-emerald-700">KOT printed: {it.printedQty}</div>
                            )}
                          </td>
                          <td className="p-1.5 text-right">{money(it.price)}</td>
                          <td className="p-1.5">
                            <div className="flex items-center justify-center gap-1">
                              <Button size="sm" variant="outline" className="h-6 w-6 p-0"
                                onClick={() => updateItemQty(it.id, -1)} disabled={it.quantity <= 1}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="font-bold w-6 text-center">{it.quantity}</span>
                              <Button size="sm" variant="outline" className="h-6 w-6 p-0"
                                onClick={() => updateItemQty(it.id, 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                          <td className="p-1.5 text-right font-bold">{money(it.lineTotal)}</td>
                          <td className="p-1.5">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                              onClick={() => openVoidItem(it.id)} title="Void item with reason">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2">
                      <tr>
                        <td colSpan={3} className="p-1.5 text-right text-muted-foreground">Subtotal</td>
                        <td className="p-1.5 text-right font-bold">{money(draft.subtotal)}</td>
                        <td></td>
                      </tr>
                      <tr>
                        <td colSpan={3} className="p-1.5 text-right text-muted-foreground">
                          Discount {(draft.discount || 0) > 0 && <span className="text-red-600">(active)</span>}
                        </td>
                        <td className="p-1 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-red-600 text-xs">−Rs.</span>
                            <Input
                              type="number"
                              min={0}
                              max={draft.subtotal}
                              value={draft.discount || 0}
                              onChange={e => setDiscount(e.target.value)}
                              className="h-7 w-24 text-right text-xs"
                            />
                            {(draft.discount || 0) > 0 && (
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                                onClick={() => setDiscount('0')} title="Remove discount">
                                <X className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                        <td></td>
                      </tr>
                      <tr>
                        <td colSpan={3} className="p-1.5 text-right font-extrabold">Grand Total</td>
                        <td className="p-1.5 text-right font-extrabold text-primary">{money(draft.grandTotal)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    {dirty && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400">Unsaved</Badge>}
                    <Button size="sm" disabled={!dirty} onClick={saveDraft}>
                      <Save className="h-3 w-3 mr-1" /> Save Changes
                    </Button>
                  </div>
                </Card>

                {/* audit timeline */}
                <Card className="p-3 max-h-[60vh] overflow-y-auto">
                  <h4 className="font-bold text-sm flex items-center gap-1 mb-2">
                    <History className="h-4 w-4" /> Audit Timeline
                  </h4>
                  <div className="border-l-2 border-primary/30 pl-3 space-y-1.5">
                    {((selected?.editLogs || []).slice().reverse()).map((e, i) => (
                      <div key={i} className="relative pb-1.5">
                        <div className="absolute -left-[14px] top-1 h-2 w-2 rounded-full bg-primary" />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px]">{ACTION_LABEL[e.action] || e.action}</Badge>
                          <span className="text-[9px] text-muted-foreground">
                            {new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {(e.itemName || e.oldValue != null || e.newValue != null) && (
                          <div className="text-[10px] mt-0.5">
                            {e.itemName && <span className="font-medium">{e.itemName}</span>}
                            {e.oldValue != null && <span className="text-muted-foreground line-through mx-1">{String(e.oldValue)}</span>}
                            {e.newValue != null && <span className="font-bold text-emerald-700">→ {String(e.newValue)}</span>}
                          </div>
                        )}
                        {e.reason && <div className="text-[9px] text-red-600 mt-0.5">Reason: {e.reason}</div>}
                        {e.userName && <div className="text-[9px] text-muted-foreground">by {e.userName}{e.userRole ? ` (${e.userRole})` : ''}</div>}
                      </div>
                    ))}
                    {(!selected?.editLogs || selected.editLogs.length === 0) && (
                      <div className="text-[10px] text-muted-foreground italic">No history yet.</div>
                    )}
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Void Item dialog */}
      <ManagerAuthDialog

        open={!!authFor}

        reason="Removing or voiding an item on a bill requires an Admin or Manager password."

        onAuthorized={onAuthorized}

        onCancel={() => setAuthFor(null)}

      />
      <Dialog open={!!voidItemId} onOpenChange={(o) => { if (!o) setVoidItemId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4 text-red-600" /> Void Item</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Item delete nahi hota — record audit log me reason ke sath save hoga.
          </p>
          <Textarea
            placeholder="Void reason (required)…"
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
            className="text-xs"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setVoidItemId(null)}>Cancel</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={confirmVoidItem}>
              <Ban className="h-3 w-3 mr-1" /> Confirm Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Order dialog */}
      <Dialog open={voidOrderOpen} onOpenChange={setVoidOrderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base flex items-center gap-2"><Ban className="h-4 w-4 text-red-600" /> Void Entire Order</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Order #{draft?.orderNumber} ko void karen. Reason permanent record hoga.
          </p>
          <Textarea
            placeholder="Void reason…"
            value={voidOrderReason}
            onChange={e => setVoidOrderReason(e.target.value)}
            className="text-xs"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setVoidOrderOpen(false)}>Cancel</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={voidWholeOrder}>
              <Ban className="h-3 w-3 mr-1" /> Void Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Item dialog */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add Item to Order</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search menu…"
                  className="pl-8 h-9 text-xs"
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                />
              </div>
              <Select value={menuCat} onValueChange={setMenuCat}>
                <SelectTrigger className="h-9 text-xs w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
              {filteredMenu.map(m => (
                <button
                  key={m.id}
                  onClick={() => { addMenuItem(m); setAddItemOpen(false); }}
                  className="border rounded-lg p-2 text-left hover:border-primary/60 transition-smooth"
                >
                  <div className="text-xs font-bold line-clamp-2">{m.name}</div>
                  <div className="text-[10px] text-primary font-bold mt-1">{money(m.price)}</div>
                </button>
              ))}
              {filteredMenu.length === 0 && (
                <div className="col-span-full text-center text-muted-foreground text-xs italic py-6">No items.</div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Add karne ke baad <b>Save Changes</b> dabayen, phir <b>KOT</b> reprint karen taake kitchen ko new item bhej diya jaye.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
