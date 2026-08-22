// ============================================================
// Unified Audit History (Phase 4)
// ------------------------------------------------------------
// One timeline for: order edits, voids, reprints, status changes,
// approvals / rejections, customer block / unblock, and location
// block / unblock. Append-only — nothing is ever deleted.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  History, Search, Download, Calendar, User as UserIcon, FileText, Printer, X,
  Edit3, Plus, Minus, Ban, Trash2, CheckCircle2, XCircle, ShieldOff, MapPinOff, ShieldCheck,
} from 'lucide-react';
import { getOrders } from '@/lib/store';
import { getBlockedCustomers, getBlockedLocations, onBlocklistChange } from '@/lib/blocklist';
import type { Order, OrderEditLog, OrderEditAction } from '@/lib/types';

type ExtendedAction =
  | OrderEditAction
  | 'APPROVE'
  | 'REJECT'
  | 'BLOCK_CUSTOMER'
  | 'UNBLOCK_CUSTOMER'
  | 'BLOCK_LOCATION'
  | 'UNBLOCK_LOCATION';

type EntryCategory = 'order' | 'customer-block' | 'location-block';

interface FlatEntry {
  at: string;
  action: ExtendedAction;
  category: EntryCategory;
  // order-side fields
  orderId?: string;
  orderNumber?: string | number;
  orderType?: string;
  customerName?: string;
  grandTotal?: number;
  kotTokens?: number[];
  // common
  itemName?: string;
  oldValue?: any;
  newValue?: any;
  reason?: string;
  userName?: string;
  userRole?: string;
  deviceName?: string;
  // blocklist refs
  blockedSubject?: string; // phone / area name
}

const ACTION_LABEL: Record<ExtendedAction, string> = {
  CREATE: 'Order Created',
  ADD: 'Item Added',
  QTY_UP: 'Qty Increased',
  QTY_DOWN: 'Qty Decreased',
  CANCEL: 'Item Cancelled',
  DISCOUNT: 'Discount Changed',
  PAYMENT: 'Payment Done',
  VOID: 'Order Voided',
  COMPLIMENTARY: 'Complimentary',
  CANCEL_ORDER: 'Order Cancelled',
  STATUS: 'Status Changed',
  REPRINT: 'KOT Printed / Reprint',
  NOTE: 'Note Updated',
  QTY_INCREASE: 'Qty Increased',
  QTY_DECREASE: 'Qty Decreased',
  REPLACE: 'Item Replaced',
  APPROVE: 'Order Approved',
  REJECT: 'Order Rejected',
  BLOCK_CUSTOMER: 'Customer Blocked',
  UNBLOCK_CUSTOMER: 'Customer Unblocked',
  BLOCK_LOCATION: 'Location Blocked',
  UNBLOCK_LOCATION: 'Location Unblocked',
};

const ACTION_COLOR: Record<ExtendedAction, string> = {
  CREATE: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  ADD: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  QTY_UP: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  QTY_DOWN: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  CANCEL: 'bg-red-500/15 text-red-700 border-red-500/30',
  DISCOUNT: 'bg-violet-500/15 text-violet-700 border-violet-500/30',
  PAYMENT: 'bg-primary/15 text-primary border-primary/30',
  VOID: 'bg-red-500/15 text-red-700 border-red-500/30',
  COMPLIMENTARY: 'bg-pink-500/15 text-pink-700 border-pink-500/30',
  CANCEL_ORDER: 'bg-red-500/15 text-red-700 border-red-500/30',
  STATUS: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  REPRINT: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
  NOTE: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
  QTY_INCREASE: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  QTY_DECREASE: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  REPLACE: 'bg-violet-500/15 text-violet-700 border-violet-500/30',
  APPROVE: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  REJECT: 'bg-red-500/15 text-red-700 border-red-500/30',
  BLOCK_CUSTOMER: 'bg-red-500/15 text-red-700 border-red-500/30',
  UNBLOCK_CUSTOMER: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  BLOCK_LOCATION: 'bg-red-500/15 text-red-700 border-red-500/30',
  UNBLOCK_LOCATION: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
};

function actionIcon(a: ExtendedAction) {
  switch (a) {
    case 'CREATE': return <FileText className="h-3 w-3" />;
    case 'ADD': return <Plus className="h-3 w-3" />;
    case 'QTY_UP':
    case 'QTY_INCREASE': return <Plus className="h-3 w-3" />;
    case 'QTY_DOWN':
    case 'QTY_DECREASE': return <Minus className="h-3 w-3" />;
    case 'CANCEL': return <Trash2 className="h-3 w-3" />;
    case 'VOID':
    case 'CANCEL_ORDER': return <Ban className="h-3 w-3" />;
    case 'REPRINT': return <Printer className="h-3 w-3" />;
    case 'APPROVE': return <CheckCircle2 className="h-3 w-3" />;
    case 'REJECT': return <XCircle className="h-3 w-3" />;
    case 'BLOCK_CUSTOMER': return <ShieldOff className="h-3 w-3" />;
    case 'UNBLOCK_CUSTOMER': return <ShieldCheck className="h-3 w-3" />;
    case 'BLOCK_LOCATION': return <MapPinOff className="h-3 w-3" />;
    case 'UNBLOCK_LOCATION': return <ShieldCheck className="h-3 w-3" />;
    default: return <Edit3 className="h-3 w-3" />;
  }
}

/** Re-classify a raw order edit log into our extended action set. */
function reclassify(e: OrderEditLog): ExtendedAction {
  if (e.action === 'STATUS' && String(e.newValue) === 'running' && String(e.oldValue) === 'pending_approval') return 'APPROVE';
  if (e.action === 'CANCEL_ORDER' && String(e.newValue) === 'rejected') return 'REJECT';
  return e.action as ExtendedAction;
}

export default function AuditHistoryPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<EntryCategory | 'all'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [blockTick, setBlockTick] = useState(0);

  // refresh whenever blocklist changes
  useEffect(() => onBlocklistChange(() => setBlockTick(t => t + 1)), []);

  const orders = useMemo(() => getOrders(), []);

  const allEntries: FlatEntry[] = useMemo(() => {
    const out: FlatEntry[] = [];

    // Order edit logs (includes approvals, rejections, reprints, edits)
    for (const o of orders) {
      const tokens = (o.kotRevisions || []).map(r => r.kotNo);
      for (const e of o.editLogs || []) {
        out.push({
          ...e,
          action: reclassify(e),
          category: 'order',
          orderId: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          customerName: o.customer?.name,
          grandTotal: o.grandTotal,
          kotTokens: tokens,
        });
      }
    }

    // Customer block / unblock history
    for (const c of getBlockedCustomers()) {
      for (const h of c.history || []) {
        out.push({
          at: h.at,
          action: h.action === 'block' ? 'BLOCK_CUSTOMER' : 'UNBLOCK_CUSTOMER',
          category: 'customer-block',
          customerName: c.name,
          itemName: c.name,
          reason: h.reason,
          userName: h.by,
          blockedSubject: c.phone,
          newValue: h.action === 'block' ? c.phone : undefined,
        });
      }
    }

    // Location block / unblock history
    for (const l of getBlockedLocations()) {
      for (const h of l.history || []) {
        out.push({
          at: h.at,
          action: h.action === 'block' ? 'BLOCK_LOCATION' : 'UNBLOCK_LOCATION',
          category: 'location-block',
          itemName: l.areaName || (l.lat ? `${l.lat.toFixed(4)},${l.lng?.toFixed(4)}` : 'Location'),
          reason: h.reason,
          userName: h.by,
          blockedSubject: l.areaName,
          newValue: l.action === 'review' ? 'Review queue' : 'Auto-reject',
        });
      }
    }

    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [orders, blockTick]);

  const allUsers = useMemo(() => {
    const set = new Set<string>();
    allEntries.forEach(e => { if (e.userName) set.add(e.userName); });
    return Array.from(set).sort();
  }, [allEntries]);

  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (userFilter !== 'all' && e.userName !== userFilter) return false;
      if (fromDate) {
        const t = new Date(e.at).getTime();
        if (t < new Date(fromDate + 'T00:00:00').getTime()) return false;
      }
      if (toDate) {
        const t = new Date(e.at).getTime();
        if (t > new Date(toDate + 'T23:59:59').getTime()) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!String(e.orderNumber ?? '').toLowerCase().includes(q)
          && !(e.itemName || '').toLowerCase().includes(q)
          && !(e.customerName || '').toLowerCase().includes(q)
          && !(e.userName || '').toLowerCase().includes(q)
          && !(e.blockedSubject || '').toLowerCase().includes(q)
          && !(e.reason || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allEntries, search, actionFilter, categoryFilter, userFilter, fromDate, toDate]);

  const stats = useMemo(() => {
    return {
      total: filtered.length,
      edits: filtered.filter(e => ['ADD', 'QTY_UP', 'QTY_DOWN', 'CANCEL', 'DISCOUNT', 'QTY_INCREASE', 'QTY_DECREASE', 'REPLACE'].includes(e.action)).length,
      voids: filtered.filter(e => ['VOID', 'CANCEL_ORDER', 'REJECT'].includes(e.action)).length,
      approvals: filtered.filter(e => e.action === 'APPROVE').length,
      blocks: filtered.filter(e => ['BLOCK_CUSTOMER', 'BLOCK_LOCATION'].includes(e.action)).length,
      prints: filtered.filter(e => e.action === 'REPRINT').length,
    };
  }, [filtered]);

  const exportCSV = () => {
    const rows = [['Timestamp', 'Category', 'Order#', 'KOT Tokens', 'Action', 'Item / Subject', 'Old', 'New', 'Reason', 'User', 'Role']];
    filtered.forEach(e => {
      rows.push([
        new Date(e.at).toLocaleString(),
        e.category,
        e.orderNumber != null ? '#' + e.orderNumber : '',
        (e.kotTokens || []).join(' / '),
        ACTION_LABEL[e.action] || e.action,
        e.itemName || e.blockedSubject || '',
        String(e.oldValue ?? ''),
        String(e.newValue ?? ''),
        e.reason || '',
        e.userName || '',
        e.userRole || '',
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const categoryChips: Array<{ key: typeof categoryFilter; label: string; color: string }> = [
    { key: 'all', label: 'All', color: 'bg-primary/15 text-primary' },
    { key: 'order', label: 'Orders', color: 'bg-blue-500/15 text-blue-700' },
    { key: 'customer-block', label: 'Customer Blocks', color: 'bg-red-500/15 text-red-700' },
    { key: 'location-block', label: 'Location Blocks', color: 'bg-amber-500/15 text-amber-700' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Unified Audit History
          </h2>
          <p className="text-xs text-muted-foreground">
            Orders, approvals, rejections, prints, customer & location blocks — sab ka permanent timeline.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV}>
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats.total} color="text-primary" />
        <StatCard label="Item Edits" value={stats.edits} color="text-emerald-600" />
        <StatCard label="Voids / Rejects" value={stats.voids} color="text-red-600" />
        <StatCard label="Approvals" value={stats.approvals} color="text-emerald-600" />
        <StatCard label="Blocks" value={stats.blocks} color="text-amber-600" />
        <StatCard label="Prints" value={stats.prints} color="text-sky-600" />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        {categoryChips.map(c => (
          <button
            key={c.key}
            onClick={() => setCategoryFilter(c.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${categoryFilter === c.key ? c.color + ' border-current font-bold' : 'bg-card hover:bg-accent'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search order#, item, customer, phone, user, reason…"
              className="pl-8 h-9 text-xs"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {Object.entries(ACTION_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="User" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {allUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="date" className="h-9 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <Input type="date" className="h-9 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Entries */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left p-2.5">Time</th>
                <th className="text-left p-2.5">Order / Subject</th>
                <th className="text-left p-2.5">KOT</th>
                <th className="text-left p-2.5">Action</th>
                <th className="text-left p-2.5">Detail</th>
                <th className="text-left p-2.5">Change</th>
                <th className="text-left p-2.5">User</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground p-6 italic">No history entries.</td></tr>
              )}
              {filtered.slice(0, 500).map((e, i) => {
                const order = e.orderId ? orders.find(o => o.id === e.orderId) : null;
                return (
                  <tr
                    key={i}
                    className={`border-t hover:bg-accent/30 ${order ? 'cursor-pointer' : ''}`}
                    onClick={() => order && setSelectedOrder(order)}
                  >
                    <td className="p-2.5 text-muted-foreground whitespace-nowrap">
                      {new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-2.5 font-bold text-primary">
                      {e.orderNumber != null
                        ? <>#{e.orderNumber}</>
                        : <span className="text-muted-foreground font-normal text-[10px] uppercase">{e.category.replace('-', ' ')}</span>}
                    </td>
                    <td className="p-2.5 text-[10px] text-muted-foreground">{(e.kotTokens || []).join(', ') || '—'}</td>
                    <td className="p-2.5">
                      <Badge variant="outline" className={`text-[10px] gap-1 ${ACTION_COLOR[e.action] || ''}`}>
                        {actionIcon(e.action)} {ACTION_LABEL[e.action] || e.action}
                      </Badge>
                    </td>
                    <td className="p-2.5">
                      {e.itemName ? <span className="font-medium">{e.itemName}</span> : <span className="text-muted-foreground italic">—</span>}
                      {e.blockedSubject && e.blockedSubject !== e.itemName && (
                        <div className="text-[10px] text-muted-foreground">{e.blockedSubject}</div>
                      )}
                      {e.reason && <div className="text-[10px] text-red-600 mt-0.5">Reason: {e.reason}</div>}
                    </td>
                    <td className="p-2.5">
                      {e.oldValue != null || e.newValue != null ? (
                        <span className="text-[11px]">
                          {e.oldValue != null && <span className="text-muted-foreground line-through mr-1">{String(e.oldValue)}</span>}
                          {e.newValue != null && <span className="font-bold text-emerald-700">{String(e.newValue)}</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">{e.userName || 'System'}</span>
                      </div>
                      {e.userRole && <div className="text-[9px] text-muted-foreground uppercase">{e.userRole}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <div className="p-2 text-center text-[10px] text-muted-foreground bg-muted/30">
            Showing first 500 entries. Refine filters to narrow down.
          </div>
        )}
      </Card>

      {/* Order Detail Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-2" onClick={() => setSelectedOrder(null)}>
          <Card className="w-full max-w-2xl max-h-[85vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">Order #{selectedOrder.orderNumber} — Full Timeline</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="text-xs text-muted-foreground mb-3 grid grid-cols-2 gap-1">
              <div><b>Type:</b> {selectedOrder.orderType}</div>
              <div><b>Total:</b> {money(selectedOrder.grandTotal)}</div>
              <div><b>Status:</b> {selectedOrder.status}</div>
              <div><b>Customer:</b> {selectedOrder.customer?.name || '—'}</div>
              {(selectedOrder.kotRevisions || []).length > 0 && (
                <div className="col-span-2"><b>KOT Tokens:</b> {(selectedOrder.kotRevisions || []).map(r => `#${r.kotNo} (${r.type})`).join(', ')}</div>
              )}
            </div>
            <div className="space-y-1.5 border-l-2 border-primary/30 pl-3">
              {(selectedOrder.editLogs || []).slice().reverse().map((e, i) => {
                const action = reclassify(e);
                return (
                  <div key={i} className="relative pb-2">
                    <div className="absolute -left-[14px] top-1 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <Badge variant="outline" className={`text-[10px] gap-1 ${ACTION_COLOR[action] || ''}`}>
                        {actionIcon(action)} {ACTION_LABEL[action] || action}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                      <span className="text-[10px] font-medium">by {e.userName || 'Unknown'}{e.userRole ? ` (${e.userRole})` : ''}</span>
                    </div>
                    {(e.itemName || e.oldValue != null || e.newValue != null) && (
                      <div className="text-[11px] mt-0.5 ml-1">
                        {e.itemName && <span className="font-medium">{e.itemName}</span>}
                        {e.oldValue != null && <span className="text-muted-foreground line-through mx-1">{String(e.oldValue)}</span>}
                        {e.newValue != null && <span className="font-bold text-emerald-700">→ {String(e.newValue)}</span>}
                      </div>
                    )}
                    {e.reason && <div className="text-[10px] text-red-600 ml-1 mt-0.5">Reason: {e.reason}</div>}
                  </div>
                );
              })}
              {(selectedOrder.editLogs || []).length === 0 && (
                <div className="text-xs text-muted-foreground italic py-2">No history for this order.</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
    </Card>
  );
}
