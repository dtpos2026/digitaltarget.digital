// Blocked Locations — block by area name OR GPS coordinates with radius
import { useEffect, useState } from 'react';
import { getBlockedLocations, blockLocation, unblockLocation, onBlocklistChange, type BlockedLocation } from '@/lib/blocklist';
import { MapPin, Plus, RotateCcw, Search, Clock } from 'lucide-react';
import { toast } from 'sonner';

function fmt(iso?: string) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } }

export default function BlockedLocationsPage() {
  const [list, setList] = useState<BlockedLocation[]>(() => getBlockedLocations());
  const [showAdd, setShowAdd] = useState(false);
  const [showHist, setShowHist] = useState<BlockedLocation | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ areaName: '', lat: '', lng: '', radiusM: '500', reason: '', action: 'reject' as 'reject' | 'review' });

  useEffect(() => onBlocklistChange(() => setList(getBlockedLocations())), []);
  const currentUser = (() => { try { const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null'); return { id: u?.id, name: u?.name || u?.username }; } catch { return { id: undefined, name: undefined }; } })();

  const filtered = list.filter(l => !q || l.areaName.toLowerCase().includes(q.toLowerCase()) || l.reason.toLowerCase().includes(q.toLowerCase()));
  const active = filtered.filter(l => l.status === 'active');
  const unblocked = filtered.filter(l => l.status === 'unblocked');

  const useCurrentGps = () => {
    if (!('geolocation' in navigator)) { toast.error('GPS not available'); return; }
    navigator.geolocation.getCurrentPosition(p => {
      setForm(f => ({ ...f, lat: String(p.coords.latitude), lng: String(p.coords.longitude) }));
      toast.success('GPS captured');
    }, () => toast.error('Could not get location'));
  };

  const submit = () => {
    if (!form.areaName.trim() || !form.reason.trim()) { toast.error('Area name and reason are required'); return; }
    blockLocation({
      areaName: form.areaName.trim(),
      lat: form.lat ? Number(form.lat) : undefined,
      lng: form.lng ? Number(form.lng) : undefined,
      radiusM: form.radiusM ? Number(form.radiusM) : undefined,
      reason: form.reason.trim(),
      action: form.action,
      blockedBy: currentUser.id, blockedByName: currentUser.name,
    });
    toast.success('Location blocked');
    setForm({ areaName: '', lat: '', lng: '', radiusM: '500', reason: '', action: 'reject' });
    setShowAdd(false);
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="w-6 h-6 text-status-danger" /> Blocked Locations</h1>
          <p className="text-sm text-muted-foreground">Areas and GPS zones you do not accept orders from</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="bg-status-danger text-white px-4 py-2 rounded font-semibold text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> Block New Location</button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search area or reason…" className="w-full pl-10 pr-3 py-2 border rounded bg-background" />
      </div>

      <section>
        <h2 className="font-semibold text-sm mb-2">Active Blocks ({active.length})</h2>
        {active.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8 border-2 border-dashed rounded-lg">No active location blocks</div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase"><tr><th className="text-left p-2">Area</th><th className="text-left p-2">GPS / Radius</th><th className="text-left p-2">Action</th><th className="text-left p-2">Reason</th><th className="text-left p-2">Blocked</th><th className="p-2"></th></tr></thead>
              <tbody>
                {active.map(l => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2 font-medium">{l.areaName}</td>
                    <td className="p-2 text-xs">{l.lat && l.lng ? `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)} (${l.radiusM || 500}m)` : '— (area name only)'}</td>
                    <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded ${l.action === 'reject' ? 'bg-status-danger/15 text-status-danger' : 'bg-status-warning/15 text-status-warning'}`}>{l.action === 'reject' ? 'Auto-Reject' : 'Review Queue'}</span></td>
                    <td className="p-2 text-muted-foreground">{l.reason}</td>
                    <td className="p-2 text-xs text-muted-foreground">{fmt(l.blockedAt)}<br/>by {l.blockedByName || '—'}</td>
                    <td className="p-2 flex gap-1 justify-end">
                      <button onClick={() => setShowHist(l)} className="text-xs border rounded px-2 py-1 hover:bg-muted flex items-center gap-1"><Clock className="w-3 h-3" /> History</button>
                      <button onClick={() => { unblockLocation(l.id, currentUser.name); toast.success('Unblocked'); }} className="text-xs bg-status-success text-white rounded px-2 py-1 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Unblock</button>
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
              <thead className="bg-muted text-xs uppercase"><tr><th className="text-left p-2">Area</th><th className="text-left p-2">Reason</th><th className="text-left p-2">Unblocked</th><th className="p-2"></th></tr></thead>
              <tbody>
                {unblocked.map(l => (
                  <tr key={l.id} className="border-t opacity-70">
                    <td className="p-2">{l.areaName}</td><td className="p-2 text-muted-foreground">{l.reason}</td><td className="p-2 text-xs">{fmt(l.unblockAt)}</td>
                    <td className="p-2 text-right"><button onClick={() => setShowHist(l)} className="text-xs border rounded px-2 py-1 hover:bg-muted">History</button></td>
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
            <h3 className="font-bold">Block Location</h3>
            <input value={form.areaName} onChange={e => setForm({ ...form, areaName: e.target.value })} placeholder="Area Name (e.g. Model Town)" className="w-full border rounded px-3 py-2 bg-background text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="Latitude (optional)" className="border rounded px-3 py-2 bg-background text-sm" />
              <input value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="Longitude (optional)" className="border rounded px-3 py-2 bg-background text-sm" />
            </div>
            <div className="flex gap-2">
              <input value={form.radiusM} onChange={e => setForm({ ...form, radiusM: e.target.value })} placeholder="Radius (meters)" className="flex-1 border rounded px-3 py-2 bg-background text-sm" />
              <button onClick={useCurrentGps} type="button" className="border rounded px-3 py-2 text-xs hover:bg-muted whitespace-nowrap">📍 Use My GPS</button>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Action on matching order</label>
              <select value={form.action} onChange={e => setForm({ ...form, action: e.target.value as any })} className="w-full border rounded px-3 py-2 bg-background text-sm">
                <option value="reject">Auto-Reject Order</option>
                <option value="review">Send to Approval Queue</option>
              </select>
            </div>
            <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Reason…" className="w-full border rounded px-3 py-2 bg-background text-sm" rows={2} />
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowAdd(false)} className="flex-1 border rounded py-2 text-sm">Cancel</button>
              <button onClick={submit} className="flex-1 bg-status-danger text-white rounded py-2 text-sm font-semibold">Block</button>
            </div>
          </div>
        </div>
      )}

      {showHist && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowHist(null)}>
          <div className="bg-card border rounded-lg max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold">{showHist.areaName} — History</h3>
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
