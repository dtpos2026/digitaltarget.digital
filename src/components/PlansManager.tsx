// Super Admin → Plans tab
// Create/edit/delete subscription plans (device-tier monthly/yearly).
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Layers, Plus, Trash2, Edit3, Check, X, Smartphone } from 'lucide-react';
import {
  AdminPlan, fetchAdminPlans, createAdminPlan, updateAdminPlan, deleteAdminPlan,
} from '@/lib/adminPlans';
import { formatRs } from '@/lib/billing';

export default function PlansManager() {
  const [items, setItems] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminPlan | null>(null);

  const load = async () => {
    setLoading(true);
    try { setItems(await fetchAdminPlans()); }
    catch (e: any) { toast.error(e?.message || 'Load failed'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (p: AdminPlan) => {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    try { await deleteAdminPlan(p.id); toast.success('Deleted'); load(); }
    catch (e: any) { toast.error(e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <Layers className="h-5 w-5 text-violet-600" /> Subscription Plans
          </h2>
          <p className="text-xs text-muted-foreground">
            Device-tier plans (Basic / Starter / Pro / Enterprise). Packages = bundled offers.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-violet-600 hover:bg-violet-700 text-white">
          <Plus className="h-4 w-4 mr-1" /> New Plan
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-10">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-12 text-center bg-muted/30 rounded-lg border border-dashed">
          No plans yet. "New Plan" to create one — e.g. Basic 1 device Rs 2,000/mo.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(p => (
            <div key={p.id} className={`border rounded-xl p-4 bg-card relative ${p.active ? 'border-violet-500/30' : 'border-border opacity-70'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-base truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Smartphone className="h-3 w-3" />
                    {p.maxDevices === 0 ? 'Unlimited devices' : `Up to ${p.maxDevices} device(s)`}
                  </div>
                </div>
                <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${p.active ? 'bg-green-500/10 text-green-700 border-green-500/30' : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}`}>
                  {p.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="bg-violet-500/10 border border-violet-500/20 rounded p-2 text-center">
                  <div className="text-[9px] uppercase font-bold text-violet-700">Monthly</div>
                  <div className="text-base font-extrabold text-violet-700">{formatRs(p.monthlyRs)}</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center">
                  <div className="text-[9px] uppercase font-bold text-blue-700">Yearly</div>
                  <div className="text-base font-extrabold text-blue-700">{formatRs(p.yearlyRs)}</div>
                </div>
              </div>

              {p.features && p.features.length > 0 && (
                <ul className="text-[11px] text-muted-foreground space-y-0.5 mb-2 pl-4 list-disc">
                  {p.features.slice(0, 4).map((f, i) => <li key={i}>{f}</li>)}
                  {p.features.length > 4 && <li>+{p.features.length - 4} more</li>}
                </ul>
              )}

              <div className="flex gap-1 mt-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(p); setShowForm(true); }}>
                  <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={async () => { await updateAdminPlan(p.id, { active: !p.active }); load(); }}>
                  {p.active ? 'Hide' : 'Show'}
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(p)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <PlanForm initial={editing} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      )}
    </div>
  );
}

function PlanForm({ initial, onClose, onSaved }: { initial: AdminPlan | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [maxDevices, setMaxDevices] = useState(initial?.maxDevices ?? 1);
  const [monthlyRs, setMonthlyRs] = useState(initial?.monthlyRs ?? 2000);
  const [yearlyRs, setYearlyRs] = useState(initial?.yearlyRs ?? 20000);
  const [features, setFeatures] = useState<string[]>(initial?.features || []);
  const [featureInput, setFeatureInput] = useState('');
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);

  const addFeature = () => {
    const v = featureInput.trim();
    if (!v) return;
    setFeatures([...features, v]); setFeatureInput('');
  };

  const save = async () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), maxDevices, monthlyRs, yearlyRs, features, active };
      if (initial) await updateAdminPlan(initial.id, payload);
      else await createAdminPlan(payload);
      toast.success(initial ? 'Plan updated' : 'Plan created');
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <Layers className="h-5 w-5 text-violet-600" />
            {initial ? 'Edit Plan' : 'New Plan'}
          </h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Plan Name *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pro" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Devices (0=∞)</label>
            <Input type="number" min={0} value={maxDevices} onChange={e => setMaxDevices(parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Monthly Rs</label>
            <Input type="number" min={0} value={monthlyRs} onChange={e => setMonthlyRs(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Yearly Rs</label>
            <Input type="number" min={0} value={yearlyRs} onChange={e => setYearlyRs(parseFloat(e.target.value) || 0)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Features</label>
          <div className="flex gap-1 mt-1">
            <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); } }}
              placeholder="e.g. Unlimited Orders" className="h-8 text-xs" />
            <Button type="button" size="sm" variant="outline" onClick={addFeature}>Add</Button>
          </div>
          {features.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {features.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-700 border border-violet-500/30 rounded-full px-2 py-0.5 text-[11px]">
                  {f}
                  <button type="button" onClick={() => setFeatures(features.filter((_, x) => x !== i))} className="hover:text-red-600">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
        </label>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Check className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : (initial ? 'Update' : 'Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
