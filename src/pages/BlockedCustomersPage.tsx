// Blocked Customers — list / add / unblock / history
import { useEffect, useState } from 'react';
import { getBlockedCustomers, blockCustomer, unblockCustomer, onBlocklistChange, type BlockedCustomer } from '@/lib/blocklist';
import { UserX, Plus, RotateCcw, Search, Clock } from 'lucide-react';
import { toast } from 'sonner';

function fmt(iso?: string) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } }

export default function BlockedCustomersPage() {
  const [list, setList] = useState<BlockedCustomer[]>(() => getBlockedCustomers());
  const [showAdd, setShowAdd] = useState(false);
  const [showHist, setShowHist] = useState<BlockedCustomer | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', reason: '' });

  useEffect(() => onBlocklistChange(() => setList(getBlockedCustomers())), []);

  const currentUser = (() => { try { const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null'); return { id: u?.id, name: u?.name || u?.username }; } catch { return { id: undefined, name: undefined }; } })();

  const filtered = list.filter(c => {
    if (!q) return true;
    const s = q.toLowerCase();
    return c.name.toLowerCase().includes(s) || c.phone.includes(s.replace(/\D/g, '')) || c.reason.toLowerCase().includes(s);
  });
  const active = filtered.filter(c => c.status === 'active');
  const unblocked = filtered.filter(c => c.status === 'unblocked');

  const submit = () => {
    if (!form.name.trim() || !form.phone.trim() || !form.reason.trim()) { toast.error('Fill in all fields'); return; }
    blockCustomer({ name: form.name.trim(), phone: form.phone.trim(), reason: form.reason.trim(), by: currentUser.id, byName: currentUser.name });
    toast.success('Customer blocked');
    setForm({ name: '', phone: '', reason: '' }); setShowAdd(false);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserX className="w-6 h-6 text-status-danger" /> Blocked Customers</h1>
          <p className="text-sm text-muted-foreground">Customers who have been blocked from ordering</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="bg-status-danger text-white px-4 py-2 rounded font-semibold text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> Block New Customer</button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, phone, reason…" className="w-full pl-10 pr-3 py-2 border rounded bg-background" />
      </div>

      <section>
        <h2 className="font-semibold text-sm mb-2">Active Blocks ({active.length})</h2>
        {active.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8 border-2 border-dashed rounded-lg">No active blocks</div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase">
                <tr><th className="text-left p-2">Name</th><th className="text-left p-2">Phone</th><th className="text-left p-2">Reason</th><th className="text-left p-2">Blocked</th><th className="p-2">Actions</th></tr>
              </thead>
              <tbody>
                {active.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2">{c.phone}</td>
                    <td className="p-2 text-muted-foreground">{c.reason}</td>
                    <td className="p-2 text-xs text-muted-foreground">{fmt(c.blockedAt)} <br/> by {c.blockedByName || '—'}</td>
                    <td className="p-2 flex gap-1 justify-end">
                      <button onClick={() => setShowHist(c)} className="text-xs border rounded px-2 py-1 hover:bg-muted flex items-center gap-1"><Clock className="w-3 h-3" /> History</button>
                      <button onClick={() => { unblockCustomer(c.id, currentUser.name); toast.success('Unblocked'); }} className="text-xs bg-status-success text-white rounded px-2 py-1 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Unblock</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {unblocked.length > 0 && (
        <section>
          <h2 className="font-semibold text-sm mb-2 mt-4">Previously Unblocked ({unblocked.length})</h2>
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase"><tr><th className="text-left p-2">Name</th><th className="text-left p-2">Phone</th><th className="text-left p-2">Original Reason</th><th className="text-left p-2">Unblocked At</th><th className="p-2"></th></tr></thead>
              <tbody>
                {unblocked.map(c => (
                  <tr key={c.id} className="border-t opacity-70">
                    <td className="p-2">{c.name}</td><td className="p-2">{c.phone}</td><td className="p-2 text-muted-foreground">{c.reason}</td>
                    <td className="p-2 text-xs">{fmt(c.unblockAt)}</td>
                    <td className="p-2 text-right"><button onClick={() => setShowHist(c)} className="text-xs border rounded px-2 py-1 hover:bg-muted">History</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-card border rounded-lg max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold">Block Customer</h3>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Customer Name" className="w-full border rounded px-3 py-2 bg-background text-sm" />
            <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone Number" className="w-full border rounded px-3 py-2 bg-background text-sm" />
            <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Reason for blocking…" className="w-full border rounded px-3 py-2 bg-background text-sm" rows={3} />
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 border rounded py-2 text-sm">Cancel</button>
              <button onClick={submit} className="flex-1 bg-status-danger text-white rounded py-2 text-sm font-semibold">Block Customer</button>
            </div>
          </div>
        </div>
      )}

      {showHist && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowHist(null)}>
          <div className="bg-card border rounded-lg max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold">{showHist.name} — History</h3>
            <div className="space-y-2 text-sm max-h-80 overflow-y-auto">
              {(showHist.history || []).slice().reverse().map((h, i) => (
                <div key={i} className="border rounded p-2">
                  <div className="font-semibold capitalize">{h.action} <span className="text-xs text-muted-foreground">• {fmt(h.at)}</span></div>
                  {h.by && <div className="text-xs">by {h.by}</div>}
                  {h.reason && <div className="text-xs text-muted-foreground">{h.reason}</div>}
                </div>
              ))}
            </div>
            <button onClick={() => setShowHist(null)} className="w-full border rounded py-2 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
