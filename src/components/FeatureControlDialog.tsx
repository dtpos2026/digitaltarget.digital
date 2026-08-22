import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usingSupabaseAuth } from '@/lib/authProvider';
import { fbDb } from '@/lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { X, RotateCcw, Save, ToggleLeft, ToggleRight, CheckCircle2, XCircle } from 'lucide-react';
import { PAGES, GROUP_ORDER, type PageGroup } from '@/lib/permissions';
import { getPlan, planAllowsFeature } from '@/lib/plans';

interface Props {
  tenantId: string;
  restaurantName: string;
  planId: string;
  overrides: Record<string, boolean>;
  onClose: () => void;
  onSaved: () => void;
}

export default function FeatureControlDialog({ tenantId, restaurantName, planId, overrides, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Record<string, boolean>>({ ...(overrides || {}) });
  const [saving, setSaving] = useState(false);

  const plan = getPlan(planId);

  // group pages
  const grouped: Record<PageGroup, typeof PAGES> = {
    Operations: [], Marketing: [], Inventory: [], Accounts: [], Staff: [], Reports: [], Admin: [],
  };
  PAGES.forEach(p => grouped[p.group].push(p));

  const isEnabled = (key: string): boolean => {
    if (typeof draft[key] === 'boolean') return draft[key];
    return planAllowsFeature(planId, key);
  };

  const isOverridden = (key: string): boolean => typeof draft[key] === 'boolean';

  const toggle = (key: string) => {
    setDraft(prev => {
      const next = { ...prev };
      const planDefault = planAllowsFeature(planId, key);
      if (typeof next[key] === 'boolean') {
        // overridden — flip again means revert to plan default
        if (next[key] === !planDefault) {
          delete next[key]; // back to plan default
        } else {
          next[key] = !next[key];
        }
      } else {
        next[key] = !planDefault;
      }
      return next;
    });
  };

  const clearAll = () => setDraft({});

  const save = async () => {
    setSaving(true);
    try {
      // v1.21.0 — feature flags live in tenant_settings on Supabase.
      if (usingSupabaseAuth()) {
        const { sb } = await import('@/lib/supabase');
        const ALL = '00000000-0000-0000-0000-000000000000';
        const cur = await sb().from('tenant_settings').select('settings')
          .eq('tenant_id', tenantId).eq('branch_id', ALL).maybeSingle();
        // The Firestore version stored these under `featureOverrides`; keep
        // the same key inside the settings jsonb so the reader is unchanged.
        const merged = {
          ...((cur.data as any)?.settings ?? {}),
          featureOverrides: draft,
          featureOverridesUpdatedAt: new Date().toISOString(),
        };
        const { error } = await sb().from('tenant_settings')
          .upsert({ tenant_id: tenantId, branch_id: ALL, settings: merged },
                  { onConflict: 'tenant_id,branch_id' });
        if (error) throw error;
        toast.success('Feature controls updated — live on restaurant\'s device');
        onSaved();
        onClose();
        setSaving(false);
        return;
      }
      await updateDoc(doc(fbDb(), 'userIndex', tenantId), {
        featureOverrides: draft,
        featureOverridesUpdatedAt: serverTimestamp(),
      });
      toast.success('Feature controls updated — live on restaurant\'s device');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    }
    setSaving(false);
  };

  const enabledCount = PAGES.filter(p => isEnabled(p.key)).length;
  const overrideCount = Object.keys(draft).length;

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Feature Control · {restaurantName}</h2>
            <p className="text-xs text-muted-foreground">
              Plan: <span className={`font-semibold ${plan.color}`}>{plan.name}</span>
              {' · '}{enabledCount}/{PAGES.length} features ON
              {overrideCount > 0 && <span className="text-amber-600 font-semibold"> · {overrideCount} override(s)</span>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>

        {/* Help banner */}
        <div className="px-5 py-2 bg-violet-500/5 border-b text-[11px] text-muted-foreground">
          💡 Plan default ke upar override. Green dot = plan ka default. Amber dot = Super Admin override. Click toggle to flip; click again to clear override.
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {GROUP_ORDER.map(group => {
            const items = grouped[group];
            if (!items?.length) return null;
            return (
              <div key={group}>
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">{group}</h3>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {items.map(p => {
                    const on = isEnabled(p.key);
                    const overridden = isOverridden(p.key);
                    const isSettings = p.key === 'settings';
                    return (
                      <button
                        key={p.key}
                        onClick={() => !isSettings && toggle(p.key)}
                        disabled={isSettings}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                          isSettings
                            ? 'opacity-60 cursor-not-allowed bg-muted/30'
                            : on
                              ? 'bg-green-500/5 border-green-500/30 hover:border-green-500/50'
                              : 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${overridden ? 'bg-amber-500' : on ? 'bg-green-500' : 'bg-gray-400'}`} />
                          <span className="text-sm font-medium truncate">{p.title}</span>
                          {isSettings && <span className="text-[9px] bg-amber-500/20 text-amber-700 px-1.5 py-0.5 rounded font-bold">ALWAYS ON</span>}
                        </div>
                        {on ? (
                          <ToggleRight className="h-5 w-5 text-green-600 shrink-0" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between bg-muted/20">
          <Button variant="outline" size="sm" onClick={clearAll}>
            <RotateCcw className="h-4 w-4 mr-1" />Reset to plan defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
              <Save className="h-4 w-4 mr-1" />{saving ? 'Saving…' : 'Save & Apply Live'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
