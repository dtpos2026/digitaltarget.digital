// Super Admin → Packages tab
// Create/edit/delete subscription packages (setup fee + monthly fee + duration)
// These packages can then be selected in the Invoice form to auto-fill totals.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Package, Plus, Trash2, Edit3, Check, X, PackageCheck, PackageX } from 'lucide-react';
import {
  AdminPackage, fetchPackages, createPackage, updatePackage, deletePackage, packageTotal,
} from '@/lib/packages';
import { formatRs } from '@/lib/billing';

export default function PackagesManager() {
  const [items, setItems] = useState<AdminPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminPackage | null>(null);

  const load = async () => {
    setLoading(true);
    try { setItems(await fetchPackages()); }
    catch (e: any) { toast.error(e?.message || 'Load failed'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (p: AdminPackage) => {
    if (!confirm(`Delete package "${p.name}"?`)) return;
    try { await deletePackage(p.id); toast.success('Deleted'); load(); }
    catch (e: any) { toast.error(e?.message); }
  };
  const onToggle = async (p: AdminPackage) => {
    try { await updatePackage(p.id, { active: !p.active }); load(); }
    catch (e: any) { toast.error(e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <Package className="h-5 w-5 text-violet-600" /> Subscription Packages
          </h2>
          <p className="text-xs text-muted-foreground">
            Setup fee + monthly fee + duration. Select these packages on an invoice and the total is calculated for you.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-violet-600 hover:bg-violet-700 text-white">
          <Plus className="h-4 w-4 mr-1" /> New Package
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-10">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-12 text-center bg-muted/30 rounded-lg border border-dashed">
          No packages yet. "New Package" to create one — e.g. Setup Rs 10,000 + Rs 3,000/mo × 6 mo = Rs 28,000
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(p => (
            <div key={p.id}
              className={`border rounded-xl p-4 bg-card relative ${p.active ? 'border-violet-500/30' : 'border-border opacity-70'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-base truncate">{p.name}</div>
                  {p.description && <div className="text-[11px] text-muted-foreground line-clamp-2">{p.description}</div>}
                </div>
                <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${p.active ? 'bg-green-500/10 text-green-700 border-green-500/30' : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}`}>
                  {p.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 text-center mb-2">
                <Stat label="Setup" value={formatRs(p.setupFeeRs)} tone="amber" />
                <Stat label="Monthly" value={formatRs(p.monthlyRs)} tone="violet" />
                <Stat label="Months" value={String(p.durationMonths)} tone="blue" />
              </div>

              <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-2 text-center">
                <div className="text-[9px] uppercase font-bold text-violet-700">Total Package</div>
                <div className="text-xl font-extrabold text-violet-700">{formatRs(packageTotal(p))}</div>
              </div>

              <div className="flex gap-1 mt-3">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(p); setShowForm(true); }}>
                  <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => onToggle(p)}>
                  {p.active ? <PackageX className="h-3.5 w-3.5" /> : <PackageCheck className="h-3.5 w-3.5" />}
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
        <PackageForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'violet' | 'blue' }) {
  const tones: any = {
    amber: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    violet: 'bg-violet-500/10 text-violet-700 border-violet-500/20',
    blue: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  };
  return (
    <div className={`border rounded p-1.5 ${tones[tone]}`}>
      <div className="text-[9px] uppercase font-bold opacity-80">{label}</div>
      <div className="text-sm font-extrabold leading-tight">{value}</div>
    </div>
  );
}

function PackageForm({ initial, onClose, onSaved }: {
  initial: AdminPackage | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [setupFee, setSetupFee] = useState(initial?.setupFeeRs ?? 10000);
  const [monthly, setMonthly] = useState(initial?.monthlyRs ?? 3000);
  const [duration, setDuration] = useState(initial?.durationMonths ?? 6);
  const [description, setDescription] = useState(initial?.description || '');
  const [features, setFeatures] = useState<string[]>(initial?.includedFeatures || []);
  const [featureInput, setFeatureInput] = useState('');
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);

  const total = (setupFee || 0) + (monthly || 0) * (duration || 0);

  const addFeature = () => {
    const v = featureInput.trim();
    if (!v) return;
    if (features.includes(v)) { setFeatureInput(''); return; }
    setFeatures([...features, v]);
    setFeatureInput('');
  };
  const removeFeature = (f: string) => setFeatures(features.filter(x => x !== f));

  const save = async () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), setupFeeRs: setupFee, monthlyRs: monthly,
        durationMonths: duration, description: description.trim(), active,
        includedFeatures: features,
      };
      if (initial) {
        await updatePackage(initial.id, payload);
        toast.success('Package updated');
      } else {
        await createPackage(payload);
        toast.success('Package created');
      }
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-violet-600" />
            {initial ? 'Edit Package' : 'New Package'}
          </h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Package Name *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Starter 6 Months" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Setup Fee (Rs)</label>
            <Input type="number" min={0} value={setupFee} onChange={e => setSetupFee(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Monthly (Rs)</label>
            <Input type="number" min={0} value={monthly} onChange={e => setMonthly(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Months</label>
            <Input type="number" min={1} value={duration} onChange={e => setDuration(parseInt(e.target.value) || 1)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Description (optional)</label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Includes: dashboard, reports, WhatsApp…" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Included Features (chips)</label>
          <div className="flex gap-1 mt-1">
            <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); } }}
              placeholder="e.g. Unlimited Devices" className="h-8 text-xs" />
            <Button type="button" size="sm" variant="outline" onClick={addFeature}>Add</Button>
          </div>
          {features.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {features.map(f => (
                <span key={f} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-700 border border-violet-500/30 rounded-full px-2 py-0.5 text-[11px]">
                  {f}
                  <button type="button" onClick={() => removeFeature(f)} className="hover:text-red-600">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Active (invoice me show ho)
        </label>

        <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase font-bold text-violet-700">Auto Calculated Total</div>
            <div className="text-[11px] text-muted-foreground">
              {formatRs(setupFee)} setup + {formatRs(monthly)} × {duration} mo
            </div>
          </div>
          <div className="text-2xl font-extrabold text-violet-700">{formatRs(total)}</div>
        </div>

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
