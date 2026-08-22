import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
// v1.18.1 — identity from the auth adapter: a Supabase-authenticated super
// admin has NO Firebase user, so fbAuth().currentUser was null here.
import { currentAuthUser } from '@/lib/authProvider';
import {
  Plus, Send, Ban, Copy, Pencil, Sparkles, Loader2, CheckCircle2, Circle, AlertTriangle, X, Users, Search,
} from 'lucide-react';
import {
  subscribeAllReleases, createRelease, updateRelease, publishRelease, disableRelease, deleteRelease,
  type SystemRelease,
} from '@/lib/releases';
import { fbAuth, fbDb } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { APP_VERSION } from '@/lib/version';
import VersionDistributionPanel from '@/components/VersionDistributionPanel';

type FormState = {
  version: string;
  webVersion: string;
  title: string;
  notes: string;
  desktopUpdateUrl: string;
  forceUpdate: boolean;
  minimumSupportedVersion: string;
  targetTenantIds: string[];
};

const EMPTY: FormState = {
  version: '',
  webVersion: '',
  title: '',
  notes: '',
  desktopUpdateUrl: '',
  forceUpdate: false,
  minimumSupportedVersion: '',
  targetTenantIds: [],
};

interface TenantLite { id: string; name: string; email?: string; }


export default function ReleaseManagerPage() {
  const [rows, setRows] = useState<SystemRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SystemRelease | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');

  useEffect(() => {
    const unsub = subscribeAllReleases((r) => { setRows(r); setLoading(false); });
    return () => unsub();
  }, []);

  // Load tenant list once for the target-selector
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(fbDb(), 'userIndex'));
        const list: TenantLite[] = [];
        snap.forEach(d => {
          const x: any = d.data();
          if (x.approved) {
            list.push({ id: d.id, name: x.restaurantName || x.email || d.id, email: x.email });
          }
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setTenants(list);
      } catch (e) { console.warn('tenant load', e); }
    })();
  }, []);

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(t => t.name.toLowerCase().includes(q) || (t.email || '').toLowerCase().includes(q));
  }, [tenants, tenantSearch]);

  const toggleTenantTarget = (id: string) => {
    setForm(f => ({
      ...f,
      targetTenantIds: f.targetTenantIds.includes(id)
        ? f.targetTenantIds.filter(x => x !== id)
        : [...f.targetTenantIds, id],
    }));
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, version: APP_VERSION, webVersion: APP_VERSION });
    setShowDialog(true);
  };

  const openEdit = (r: SystemRelease) => {
    setEditing(r);
    setForm({
      version: r.version || '',
      webVersion: r.webVersion || '',
      title: r.title || '',
      notes: r.notes || '',
      desktopUpdateUrl: r.desktopUpdateUrl || '',
      forceUpdate: !!r.forceUpdate,
      minimumSupportedVersion: r.minimumSupportedVersion || '',
      targetTenantIds: Array.isArray(r.targetTenantIds) ? r.targetTenantIds : [],
    });
    setShowDialog(true);
  };


  const save = async () => {
    if (!form.version.trim()) { toast.error('Version required'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateRelease(editing.id, form);
        toast.success('Release updated');
      } else {
        await createRelease({
          ...form,
          status: 'draft',
          createdBy: currentAuthUser()?.email || 'super-admin',
        } as any);
        toast.success('Draft release created');
      }
      setShowDialog(false);
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const publish = async (r: SystemRelease) => {
    if (!confirm(`Publish v${r.version} to all restaurants?`)) return;
    try {
      await publishRelease(r.id);
      toast.success(`v${r.version} published — clients will see update banner`);
    } catch (e: any) {
      toast.error(`Publish failed: ${e?.message || e}`);
    }
  };

  const disable = async (r: SystemRelease) => {
    if (!confirm(`Disable v${r.version}?`)) return;
    try {
      await disableRelease(r.id);
      toast('Release disabled');
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || e}`);
    }
  };

  const remove = async (r: SystemRelease) => {
    if (!confirm(`Delete v${r.version} permanently?`)) return;
    try {
      await deleteRelease(r.id);
      toast.success('Release deleted');
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.message || e}`);
    }
  };

  const copyUrl = (url: string) => {
    if (!url) { toast.error('No URL set'); return; }
    try { navigator.clipboard.writeText(url); toast.success('URL copied'); } catch { toast.error('Copy failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />Release Manager
          </h2>
          <p className="text-xs text-muted-foreground">Web + Desktop ke liye versions release karein. Restaurants ko automatic update notification milti hai.</p>
        </div>
        <Button onClick={openNew} className="bg-primary text-primary-foreground">
          <Plus className="h-4 w-4 mr-1" />New Release
        </Button>
      </div>
      <VersionDistributionPanel latestVersion={rows.find(r => r.status === 'released')?.version} />


      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Abhi koi release nahi — "+ New Release" se start karein.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Version</th>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Force</th>
                <th className="text-left px-3 py-2">Min</th>
                <th className="text-left px-3 py-2">Released</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono font-bold">v{r.version}</td>
                  <td className="px-3 py-2">{r.title || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2">{r.forceUpdate ? <AlertTriangle className="h-4 w-4 text-red-600" /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{r.minimumSupportedVersion || '—'}</td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    {r.releasedAt ? new Date((r.releasedAt as any).toDate?.() || r.releasedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => copyUrl(r.desktopUpdateUrl)} title="Copy update URL">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {r.status !== 'released' && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white ml-1" onClick={() => publish(r)}>
                        <Send className="h-3.5 w-3.5 mr-1" />Publish
                      </Button>
                    )}
                    {r.status === 'released' && (
                      <Button size="sm" variant="outline" className="ml-1 border-red-500/40 text-red-600" onClick={() => disable(r)}>
                        <Ban className="h-3.5 w-3.5 mr-1" />Disable
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-500/10 ml-1" onClick={() => remove(r)} title="Delete">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold">{editing ? `Edit Release v${editing.version}` : 'New Release'}</h3>
              <button onClick={() => setShowDialog(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Version *">
                <Input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="1.1.0" />
              </Field>
              <Field label="Web Version">
                <Input value={form.webVersion} onChange={e => setForm({ ...form, webVersion: e.target.value })} placeholder="1.1.0" />
              </Field>
            </div>
            <Field label="Title">
              <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Auto Update & Release Manager" />
            </Field>
            <Field label="Release Notes">
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                rows={5}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="• New feature&#10;• Bug fixes"
              />
            </Field>
            <Field label="Desktop Update URL (.exe)">
              <Input value={form.desktopUpdateUrl} onChange={e => setForm({ ...form, desktopUpdateUrl: e.target.value })} placeholder="https://.../DT-POS-Setup-v1.1.0.exe" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum Supported Version">
                <Input value={form.minimumSupportedVersion} onChange={e => setForm({ ...form, minimumSupportedVersion: e.target.value })} placeholder="1.0.0" />
              </Field>
              <Field label="Force Update">
                <label className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-background text-sm cursor-pointer">
                  <input type="checkbox" checked={form.forceUpdate} onChange={e => setForm({ ...form, forceUpdate: e.target.checked })} />
                  Block app until updated
                </label>
              </Field>
            </div>

            {/* ===== TARGET TENANTS (specific-clients update) ===== */}
            <Field label={`Target Clients (${form.targetTenantIds.length === 0 ? 'ALL — broadcast' : `${form.targetTenantIds.length} selected`})`}>
              <div className="border border-input rounded-md bg-background">
                <div className="p-2 border-b bg-muted/40 flex items-center gap-2 flex-wrap">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">
                    {form.targetTenantIds.length === 0
                      ? 'All clients will receive the update (broadcast)'
                      : `Only the ${form.targetTenantIds.length} selected clients will receive it`}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, targetTenantIds: [] }))}
                      className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-700 font-bold hover:bg-violet-500/25">
                      Broadcast (All)
                    </button>
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, targetTenantIds: filteredTenants.map(t => t.id) }))}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted text-foreground font-bold hover:bg-muted/70">
                      Select All Visible
                    </button>
                  </div>
                </div>
                <div className="p-2 border-b">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={tenantSearch}
                      onChange={e => setTenantSearch(e.target.value)}
                      placeholder="Search client by name / email…"
                      className="pl-7 h-8 text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredTenants.length === 0 ? (
                    <div className="p-3 text-center text-xs text-muted-foreground">No clients found</div>
                  ) : filteredTenants.map(t => {
                    const checked = form.targetTenantIds.includes(t.id);
                    return (
                      <label key={t.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs hover:bg-muted/50 ${checked ? 'bg-violet-500/10' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleTenantTarget(t.id)}
                          className="h-3.5 w-3.5 accent-violet-600" />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold truncate">{t.name}</div>
                          {t.email && <div className="text-[10px] text-muted-foreground truncate">{t.email}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </Field>



            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                {editing ? 'Save Changes' : 'Save Draft'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === 'released') return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 bg-green-500/15 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />Released</span>;
  if (status === 'disabled') return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-500/15 px-2 py-0.5 rounded-full"><Ban className="h-3 w-3" />Disabled</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-500/15 px-2 py-0.5 rounded-full"><Circle className="h-3 w-3" />Draft</span>;
}
