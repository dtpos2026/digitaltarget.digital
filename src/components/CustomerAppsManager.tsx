// ============================================================================
// Super Admin → Premium Customer Apps
//
// One row per restaurant in `customer_apps`. This screen is the ONLY place that
// row is written: a restaurant can read its own configuration but not change
// it, because the customer app is something the platform sells rather than
// something a client switches on for themselves.
//
// Nothing here builds a second ordering system. The customer app IS the
// existing customer order website — this decides what it is called, how it
// looks, which features are on, and which WhatsApp number it floats.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Smartphone, Search, Save, Palette, MessageCircle, Package,
  CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

/** Every feature the customer app can be sold with. */
const FEATURES = [
  { key: 'ordering', label: 'Online ordering' },
  { key: 'tracking', label: 'Live order tracking' },
  { key: 'history', label: 'Order history' },
  { key: 'offers', label: 'Offers & promotions' },
  { key: 'support', label: 'Support chat' },
  { key: 'whatsapp', label: 'WhatsApp button' },
  { key: 'loyalty', label: 'Loyalty points' },
] as const;

type Features = Record<string, boolean>;

interface AppConfig {
  tenantId: string;
  enabled: boolean;
  appName: string;
  logoUrl: string;
  iconUrl: string;
  primaryColor: string;
  mode: 'light' | 'dark';
  whatsappNumber: string;
  features: Features;
  appVersion: string;
  minSupportedVersion: string;
  updateUrl: string;
  updateRequired: boolean;
}

export interface CustomerAppsManagerProps {
  /** Restaurants already loaded by the console — not re-fetched here. */
  restaurants: Array<{ tenantId: string; name: string }>;
}

const DEFAULT_FEATURES: Features = {
  ordering: true, tracking: true, history: true,
  offers: true, support: true, whatsapp: true, loyalty: false,
};

function blank(tenantId: string, name: string): AppConfig {
  return {
    tenantId, enabled: false, appName: name, logoUrl: '', iconUrl: '',
    primaryColor: '#7c3aed', mode: 'dark', whatsappNumber: '',
    features: { ...DEFAULT_FEATURES }, appVersion: '1.0.0',
    minSupportedVersion: '', updateUrl: '', updateRequired: false,
  };
}

export default function CustomerAppsManager({ restaurants }: CustomerAppsManagerProps) {
  const [configs, setConfigs] = useState<Record<string, AppConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sb } = await import('@/lib/supabase');
        const { data, error } = await sb()
          .from('customer_apps')
          .select('tenant_id,enabled,app_name,logo_url,icon_url,theme,whatsapp_number,features,app_version,min_supported_version,update_url,update_required');
        if (error) throw error;
        if (cancelled) return;
        const next: Record<string, AppConfig> = {};
        for (const r of (data ?? []) as any[]) {
          const theme = (r.theme ?? {}) as Record<string, string>;
          next[r.tenant_id] = {
            tenantId: r.tenant_id,
            enabled: !!r.enabled,
            appName: r.app_name ?? '',
            logoUrl: r.logo_url ?? '',
            iconUrl: r.icon_url ?? '',
            primaryColor: theme.primary ?? '#7c3aed',
            mode: (theme.mode as 'light' | 'dark') ?? 'dark',
            whatsappNumber: r.whatsapp_number ?? '',
            features: { ...DEFAULT_FEATURES, ...((r.features ?? {}) as Features) },
            appVersion: r.app_version ?? '',
            minSupportedVersion: r.min_supported_version ?? '',
            updateUrl: r.update_url ?? '',
            updateRequired: !!r.update_required,
          };
        }
        setConfigs(next);
      } catch (e: any) {
        toast.error('Could not load customer apps: ' + (e?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.tenantId.includes(q))
      .map(r => ({ ...r, cfg: configs[r.tenantId] ?? blank(r.tenantId, r.name) }));
  }, [restaurants, configs, query]);

  const liveCount = useMemo(
    () => Object.values(configs).filter(c => c.enabled).length,
    [configs],
  );

  function edit(tenantId: string, patch: Partial<AppConfig>) {
    setConfigs(prev => {
      const base = prev[tenantId]
        ?? blank(tenantId, restaurants.find(r => r.tenantId === tenantId)?.name ?? '');
      return { ...prev, [tenantId]: { ...base, ...patch } };
    });
  }

  async function save(cfg: AppConfig) {
    setSaving(cfg.tenantId);
    try {
      const { sb } = await import('@/lib/supabase');
      const { error } = await sb().from('customer_apps').upsert({
        tenant_id: cfg.tenantId,
        enabled: cfg.enabled,
        app_name: cfg.appName.trim() || null,
        logo_url: cfg.logoUrl.trim() || null,
        icon_url: cfg.iconUrl.trim() || null,
        theme: { primary: cfg.primaryColor, mode: cfg.mode },
        whatsapp_number: cfg.whatsappNumber.replace(/\D/g, '') || null,
        features: cfg.features,
        app_version: cfg.appVersion.trim() || null,
        min_supported_version: cfg.minSupportedVersion.trim() || null,
        update_url: cfg.updateUrl.trim() || null,
        update_required: cfg.updateRequired,
      } as any, { onConflict: 'tenant_id' });
      if (error) throw error;
      toast.success(cfg.enabled ? 'Customer app is live' : 'Saved — app is switched off');
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading customer apps…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Premium Customer Apps</h2>
        </div>
        <span className="text-xs rounded-full bg-status-success/15 text-status-success px-2 py-0.5 font-semibold">
          {liveCount} live
        </span>
        <span className="text-xs text-muted-foreground">
          of {restaurants.length} restaurant{restaurants.length === 1 ? '' : 's'}
        </span>
        <div className="relative ml-auto">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search restaurant…"
            className="pl-8 h-9 w-56"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground max-w-3xl">
        Switching an app off takes it dark: the branding call returns nothing and
        sign-in stops working for that restaurant. It does not delete any customer
        or order.
      </p>

      <div className="space-y-2">
        {list.map(({ tenantId, name, cfg }) => {
          const isOpen = open === tenantId;
          return (
            <div key={tenantId} className="border rounded-lg bg-card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <button
                  onClick={() => setOpen(isOpen ? null : tenantId)}
                  className="flex-1 min-w-[180px] text-left"
                >
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {cfg.enabled
                      ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                      : <XCircle className="h-4 w-4 text-muted-foreground" />}
                    {name}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {cfg.appName || name} · v{cfg.appVersion || '—'} · tid {tenantId.slice(0, 8)}…
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {cfg.enabled ? 'Live' : 'Off'}
                  </span>
                  <Switch
                    checked={cfg.enabled}
                    onCheckedChange={v => edit(tenantId, { enabled: v })}
                    aria-label={`Customer app for ${name}`}
                  />
                </div>

                <Button size="sm" onClick={() => save(cfg)} disabled={saving === tenantId}>
                  {saving === tenantId
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Save className="h-4 w-4" />}
                  <span className="ml-1">Save</span>
                </Button>
              </div>

              {isOpen && (
                <div className="border-t p-3 grid gap-3 sm:grid-cols-2 bg-muted/30">
                  <Field label="App name">
                    <Input value={cfg.appName} placeholder={name}
                      onChange={e => edit(tenantId, { appName: e.target.value })} />
                  </Field>
                  <Field label="WhatsApp number" hint="Digits with country code, e.g. 923001234567">
                    <Input value={cfg.whatsappNumber} inputMode="numeric"
                      onChange={e => edit(tenantId, { whatsappNumber: e.target.value })} />
                  </Field>
                  <Field label="Logo URL">
                    <Input value={cfg.logoUrl}
                      onChange={e => edit(tenantId, { logoUrl: e.target.value })} />
                  </Field>
                  <Field label="App icon URL" hint="512×512 PNG — used as the launcher icon">
                    <Input value={cfg.iconUrl}
                      onChange={e => edit(tenantId, { iconUrl: e.target.value })} />
                  </Field>

                  <Field label="Brand colour">
                    <div className="flex items-center gap-2">
                      <input type="color" value={cfg.primaryColor}
                        onChange={e => edit(tenantId, { primaryColor: e.target.value })}
                        className="h-9 w-12 rounded border bg-transparent p-0.5"
                        aria-label="Brand colour" />
                      <Input value={cfg.primaryColor}
                        onChange={e => edit(tenantId, { primaryColor: e.target.value })}
                        className="font-mono" />
                    </div>
                  </Field>
                  <Field label="Theme">
                    <div className="flex gap-1">
                      {(['dark', 'light'] as const).map(m => (
                        <Button key={m} type="button" size="sm"
                          variant={cfg.mode === m ? 'default' : 'outline'}
                          onClick={() => edit(tenantId, { mode: m })}>
                          <Palette className="h-3.5 w-3.5 mr-1" />{m}
                        </Button>
                      ))}
                    </div>
                  </Field>

                  <div className="sm:col-span-2">
                    <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" /> Features
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {FEATURES.map(f => (
                        <label key={f.key} className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch
                            checked={cfg.features[f.key] !== false}
                            onCheckedChange={v =>
                              edit(tenantId, { features: { ...cfg.features, [f.key]: v } })}
                            aria-label={f.label}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <Field label="App version">
                    <Input value={cfg.appVersion} placeholder="1.0.0"
                      onChange={e => edit(tenantId, { appVersion: e.target.value })} />
                  </Field>
                  <Field label="Minimum supported version" hint="Older installs are asked to update">
                    <Input value={cfg.minSupportedVersion} placeholder="1.0.0"
                      onChange={e => edit(tenantId, { minSupportedVersion: e.target.value })} />
                  </Field>
                  <Field label="Update / download URL">
                    <Input value={cfg.updateUrl} placeholder="https://…/app.apk"
                      onChange={e => edit(tenantId, { updateUrl: e.target.value })} />
                  </Field>
                  <Field label="Force update">
                    <label className="flex items-center gap-2 text-xs cursor-pointer h-9">
                      <Switch checked={cfg.updateRequired}
                        onCheckedChange={v => edit(tenantId, { updateRequired: v })}
                        aria-label="Force update" />
                      Block the app until updated
                    </label>
                  </Field>

                  <div className="sm:col-span-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Support chat and the WhatsApp button reuse this restaurant's existing
                    support thread and the number above — no separate inbox is created.
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {list.length === 0 && (
          <div className="text-sm text-muted-foreground p-6 text-center border rounded-lg">
            No restaurant matches “{query}”.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </label>
  );
}
