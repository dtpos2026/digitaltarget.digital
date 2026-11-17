// Centralized Party Master — single source of truth for all parties (suppliers,
// customers, vendors, payees). Used across Accounts, Inventory Receiving, Ledger
// and Expenses. Any party created here is instantly available everywhere.
import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Trash2, Pencil, Users2, BookOpen, Package } from 'lucide-react';
import { toast } from 'sonner';
import {
  getParties, saveParty, deleteParty,
  getLedger, getReceivingEntries, getTransactions, genId,
} from '@/lib/store';
import type { Party, LedgerType } from '@/lib/types';
import { PageTitle } from '@/components/layout/PageFrame';
import MasterDetail from '@/components/layout/MasterDetail';

type Filter = 'all' | LedgerType;

const empty = (): Party => ({
  id: '', type: 'supplier', name: '', phone: '', address: '',
  openingBalance: 0, isActive: true,
});

export default function PartyMasterPage() {
  const [tick, setTick] = useState(0);
  const parties = useMemo(() => getParties(), [tick]);
  const ledger = useMemo(() => getLedger(), [tick]);
  const receiving = useMemo(() => getReceivingEntries(), [tick]);
  const txns = useMemo(() => getTransactions(), [tick]);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Party>(empty());
  // v1.115.0 — SW-18: the selected party's panel (balance, recent ledger lines) beside the table on a wide window, a dialog below it
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = () => setTick(t => t + 1);
  const selected = useMemo(() => parties.find(p => p.id === selectedId) ?? null, [parties, selectedId]);

  const summary = (p: Party) => {
    const entries = ledger.filter(l => l.partyId === p.id);
    const bal = (p.openingBalance || 0) + entries.reduce((s, e) => s + e.debit - e.credit, 0);
    const grnCount = receiving.filter(r => (r as any).partyId === p.id || r.supplierName?.trim().toLowerCase() === p.name.trim().toLowerCase()).length;
    const txnCount = txns.filter(t => t.partyId === p.id).length;
    return { balance: bal, ledgerCount: entries.length, grnCount, txnCount };
  };

  const filtered = parties
    .filter(p => filter === 'all' ? true : p.type === filter)
    .filter(p => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        p.name.toLowerCase().includes(q)
        || (p.phone || '').toLowerCase().includes(q)
        || (p.address || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const onSave = () => {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    // Prevent duplicates (case-insensitive within same type)
    const dup = parties.find(p =>
      p.id !== form.id
      && p.type === form.type
      && p.name.trim().toLowerCase() === form.name.trim().toLowerCase()
    );
    if (dup) { toast.error(`"${dup.name}" already exists as ${dup.type}`); return; }
    saveParty({ ...form, id: form.id || genId(), name: form.name.trim() });
    toast.success(form.id ? 'Party updated' : 'Party added — now available in all modules');
    setOpen(false);
    setForm(empty());
    refresh();
  };

  const onDelete = (p: Party) => {
    const s = summary(p);
    const usage = s.ledgerCount + s.grnCount + s.txnCount;
    if (usage > 0 && !confirm(`"${p.name}" has ${usage} linked records (ledger/GRN/transactions). Delete anyway?`)) return;
    if (usage === 0 && !confirm(`Delete "${p.name}"?`)) return;
    deleteParty(p.id);
    refresh();
    toast.info('Deleted');
  };

  const counts = {
    all: parties.length,
    supplier: parties.filter(p => p.type === 'supplier').length,
    customer: parties.filter(p => p.type === 'customer').length,
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <PageTitle icon={Users2} subtitle="Suppliers and other parties you trade with">Party Master</PageTitle>
        <Badge variant="outline" className="text-[10px]">Central database — used by Accounts, Inventory, Receiving, Expenses & Ledger</Badge>
        <Button size="sm" className="ml-auto" onClick={() => { setForm(empty()); setOpen(true); }}>
          <Plus className="h-3 w-3 mr-1" /> New Party
        </Button>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="supplier">Suppliers / Vendors ({counts.supplier})</TabsTrigger>
              <TabsTrigger value="customer">Customers ({counts.customer})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[220px] max-w-md ml-auto">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Global search — name, phone, address..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <MasterDetail
        title={selected ? selected.name : 'Party'} open={!!selected} onClose={() => setSelectedId(null)}
        emptyText="Select a supplier or customer to see what is owed and the latest ledger lines." dialogClassName="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        detail={selected ? (() => {
          const s = summary(selected);
          const lines = ledger.filter(l => l.partyId === selected.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
          return (
            <div className="space-y-3 text-sm" data-party-panel={selected.id}>
              <div className="flex items-center gap-2">
                <Badge variant={selected.type === 'supplier' ? 'secondary' : 'default'}>{selected.type}</Badge>
                {selected.isActive === false && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{selected.phone || 'No phone'}</span>
              </div>
              {selected.address && <p className="text-xs text-muted-foreground">{selected.address}</p>}
              <div className="rounded-xl border p-3 text-center">
                <div className={`text-2xl font-extrabold ${s.balance > 0 ? 'text-status-success' : s.balance < 0 ? 'text-destructive' : ''}`} data-party-balance>
                  {s.balance === 0 ? money(0) : money(Math.abs(Math.round(s.balance)))}
                </div>
                <div className="text-[11px] text-muted-foreground">{s.balance > 0 ? 'they owe us' : s.balance < 0 ? 'we owe them' : 'settled'}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg border p-2"><div className="font-bold">{s.grnCount}</div>GRNs</div>
                <div className="rounded-lg border p-2"><div className="font-bold">{s.txnCount}</div>Txns</div>
                <div className="rounded-lg border p-2"><div className="font-bold">{s.ledgerCount}</div>Ledger</div>
              </div>
              <div>
                <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Latest ledger lines</h4>
                {lines.length === 0 ? <p className="text-xs text-muted-foreground">No ledger lines yet.</p> : (
                  <ul className="divide-y text-xs">
                    {lines.map(l => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate">{l.description || l.reference || 'Entry'}<span className="block text-[10px] text-muted-foreground">{l.date}</span></span>
                        <span className={l.debit > 0 ? 'font-bold text-status-success' : 'font-bold text-destructive'}>{l.debit > 0 ? '+' : '−'}{money(l.debit > 0 ? l.debit : l.credit)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { setForm(selected); setOpen(true); }}><Pencil className="mr-1 h-3 w-3" /> Edit</Button>
                <Button size="sm" variant="outline" className="flex-1 text-destructive" onClick={() => { onDelete(selected); setSelectedId(null); }}><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
              </div>
            </div>
          );
        })() : null}
        list={
      <div className="bg-card border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-bold">Name</th>
              <th className="text-left px-3 py-2 font-bold">Type</th>
              <th className="text-left px-3 py-2 font-bold">Phone</th>
              <th className="text-left px-3 py-2 font-bold min-[1280px]:max-[1699px]:hidden">Address</th>
              <th className="text-right px-3 py-2 font-bold min-[1280px]:max-[1699px]:hidden">GRNs</th>
              <th className="text-right px-3 py-2 font-bold min-[1280px]:max-[1699px]:hidden">Txns</th>
              <th className="text-right px-3 py-2 font-bold min-[1280px]:max-[1699px]:hidden">Ledger Lines</th>
              <th className="text-right px-3 py-2 font-bold">Balance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const s = summary(p);
              return (
                <tr key={p.id} data-party-row={p.id} onClick={() => setSelectedId(p.id)} className={`cursor-pointer border-b hover:bg-accent/30 ${selectedId === p.id ? 'bg-primary/5' : ''}`}>
                  <td className="px-3 py-2 font-bold">
                    {p.name}
                    {p.isActive === false && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={p.type === 'supplier' ? 'secondary' : 'default'}>{p.type}</Badge>
                  </td>
                  <td className="px-3 py-2">{p.phone || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground min-[1280px]:max-[1699px]:hidden">{p.address || '—'}</td>
                  <td className="px-3 py-2 text-right min-[1280px]:max-[1699px]:hidden">
                    {s.grnCount > 0 ? <span className="inline-flex items-center gap-1"><Package className="h-3 w-3 text-status-teal" />{s.grnCount}</span> : '—'}
                  </td>
                  <td className="px-3 py-2 text-right min-[1280px]:max-[1699px]:hidden">{s.txnCount || '—'}</td>
                  <td className="px-3 py-2 text-right min-[1280px]:max-[1699px]:hidden">
                    {s.ledgerCount > 0 ? <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3 text-primary" />{s.ledgerCount}</span> : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${s.balance > 0 ? 'text-status-success' : s.balance < 0 ? 'text-destructive' : ''}`}>
                    {s.balance === 0 ? '—' : `${money(Math.abs(Math.round(s.balance)))}`}
                    {s.balance !== 0 && (
                      <div className="text-[9px] font-normal text-muted-foreground">
                        {s.balance > 0 ? 'they owe' : 'we owe'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setForm(p); setOpen(true); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onDelete(p); }}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                {parties.length === 0 ? 'No parties yet — add suppliers/customers here or auto-create from Receiving' : 'No match'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{form.id ? 'Edit Party' : 'New Party'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Type</label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as LedgerType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">Supplier / Vendor / Payee</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Name *</label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Phone</label>
                <Input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Opening Balance</label>
                <Input type="number" value={form.openingBalance || 0}
                  onChange={e => setForm({ ...form, openingBalance: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Address</label>
              <Input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={onSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
