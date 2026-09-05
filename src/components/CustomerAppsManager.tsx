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
import { APP_THEMES, themeFor, contrastWithWhite } from '@/lib/appThemes';
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
  requireClaimOtp: boolean;
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
    features: { ...DEFAULT_FEATURES }, requireClaimOtp: false, appVersion: '1.0.0',
    minSupportedVersion: '', updateUrl: '', updateRequired: false,
  };
}

/**
 * A versionCode Android will accept, derived from the version name.
 *
 * Android compares versionCode as a plain integer and refuses anything not
 * higher than what is installed, so it has to rise with every release. Deriving
 * it from the version name means the operator maintains ONE number instead of
 * two that can disagree: 1.2.3 -> 10203, 2.0.0 -> 20000.
 */
export function versionCodeFor(version: string): string {
  const parts = String(version || '').trim().split('.').map(n => parseInt(n, 10));
  if (!parts.length || Number.isNaN(parts[0])) return '';
  const [maj = 0, min = 0, patch = 0] = parts.map(n => (Number.isNaN(n) ? 0 : n));
  if (min > 99 || patch > 99) return '';           // outside what this encoding fits
  const code = maj * 10000 + min * 100 + patch;
  return code > 0 ? String(code) : '';
}

export default function CustomerAppsManager({ restaurants }: CustomerAppsManagerProps) {
  const [configs, setConfigs] = useState<Record<string, AppConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sb } = await import('@/lib/supabase');
        const { data, error } = await sb()
          .from('customer_apps')
          .select('tenant_id,enabled,app_name,logo_url,icon_url,theme,whatsapp_number,features,require_claim_otp,app_version,min_supported_version,update_url,update_required');
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
            requireClaimOtp: r.require_claim_otp === true,
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
        require_claim_otp: cfg.requireClaimOtp,
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

  /**
   * v1.28.9 — build this restaurant's APK from here.
   *
   * The build itself runs on GitHub, and starting it needs a token that can
   * write to the repository. That token stays in the apk-build edge function:
   * one handed to the browser would be copied by every machine, extension and
   * network between here and there, and it can push code, not merely build.
   *
   * The branding this button sends is what is already SAVED, not what is on
   * screen — a build from unsaved edits would produce an APK that does not
   * match what the app itself will show. So save first, then build.
   */
  async function buildApk(cfg: AppConfig) {
    if (!cfg.appName.trim()) {
      toast.error('Give the app a name first — it becomes the label under the icon.');
      return;
    }
    if (!cfg.iconUrl.trim()) {
      toast.error('Add an app icon URL first — otherwise the APK ships the Digital Target logo.');
      return;
    }
    // Two restaurants under one package id are the same app to every phone:
    // installing the second replaces the first. Derive a distinct one.
    const slug = cfg.appName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
    const appId = `com.digitaltarget.${slug || 'customer'}`;

    setBuilding(cfg.tenantId);
    try {
      const { sb } = await import('@/lib/supabase');
      const { data: session } = await sb().auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Sign in again — the session has expired.');

      const { data, error } = await sb().functions.invoke('apk-build', {
        body: {
          tenant_id: cfg.tenantId,
          app_id: appId,
          apps: 'Customer',
          refresh_bundle: true,
          // v1.48.0 — the version travels with the build.
          //
          // These were never sent, so every APK started from this panel shipped
          // versionCode 1. Android refuses to install a build whose versionCode
          // is not HIGHER than the installed one, so the SECOND APK handed to a
          // restaurant failed with INSTALL_FAILED_VERSION_DOWNGRADE and the
          // only way through was to uninstall — which signs the customer out
          // and loses their saved addresses.
          app_version: cfg.appVersion || '',
          version_code: versionCodeFor(cfg.appVersion),
        },
      });
      // A non-2xx from an edge function arrives as an error whose body holds
      // the useful part, so the operator sees the reason and not "failed".
      if (error) {
        let detail = '';
        try { detail = (await (error as any).context?.json())?.message ?? ''; } catch { /* body already read */ }
        throw new Error(detail || error.message);
      }
      toast.success(
        `${data?.message ?? 'Build started.'} Package id: ${appId}`,
        { duration: 12000 },
      );
    } catch (e: any) {
      toast.error(String(e?.message ?? e), { duration: 12000 });
    } finally {
      setBuilding(null);
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

                <Button
                  size="sm"
                  variant="outline"
                  title="Build this restaurant's branded APK on GitHub"
                  onClick={() => buildApk(cfg)}
                  disabled={building === tenantId || saving === tenantId}
                >
                  {building === tenantId
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Package className="h-3.5 w-3.5 mr-1" />}
                  Build APK
                </Button>
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

                  {/*
                    v1.28.8 — a shortlist, because picking a colour that reads
                    well on a phone next to a logo is a design decision, and a
                    colour wheel asks the operator to make it fresh for every
                    restaurant. The wheel is still below; this only saves the
                    common case. The chosen colour also paints the launcher
                    icon's tile (tools/brand.mjs reads theme.primary), so this
                    brands the home screen as well as the app.
                  */}
                  <div className="sm:col-span-2">
                    <div className="text-xs font-semibold mb-2 flex items-center gap-1">
                      <Palette className="h-3.5 w-3.5" /> Theme
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {APP_THEMES.map(t => {
                        const active = themeFor(cfg.primaryColor, cfg.mode)?.id === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            title={`${t.name} · ${t.mode}`}
                            aria-pressed={active}
                            onClick={() => edit(tenantId, { primaryColor: t.primary, mode: t.mode })}
                            className={`group rounded-lg border p-1.5 text-left transition ${
                              active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <div
                              className="h-8 w-full rounded flex items-center justify-center text-[10px] font-bold text-white"
                              style={{ background: t.primary }}
                            >
                              Aa
                            </div>
                            <div className="mt-1 truncate text-[10px] leading-tight">{t.name}</div>
                            <div className="text-[9px] text-muted-foreground">{t.mode}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Field label="Brand colour" hint="Or pick your own — white text must stay readable on it">
                    <div className="flex items-center gap-2">
                      <input type="color" value={cfg.primaryColor}
                        onChange={e => edit(tenantId, { primaryColor: e.target.value })}
                        className="h-9 w-12 rounded border bg-transparent p-0.5"
                        aria-label="Brand colour" />
                      <Input value={cfg.primaryColor}
                        onChange={e => edit(tenantId, { primaryColor: e.target.value })}
                        className="font-mono" />
                    </div>
                    {/*
                      The app draws white text over this colour everywhere. A
                      hand-picked light one gives buttons nobody can read
                      outdoors, and that is not visible from this panel — so it
                      is said here rather than discovered on a customer's phone.
                    */}
                    {contrastWithWhite(cfg.primaryColor) < 4.5 && (
                      <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                        White text on this colour is {contrastWithWhite(cfg.primaryColor).toFixed(1)}:1 —
                        below the 4.5:1 needed to stay readable. Pick a darker shade, or one above.
                      </p>
                    )}
                  </Field>
                  <Field label="Light or dark">
                    <div className="flex gap-1">
                      {(['dark', 'light'] as const).map(m => (
                        <Button key={m} type="button" size="sm"
                          variant={cfg.mode === m ? 'default' : 'outline'}
                          onClick={() => edit(tenantId, { mode: m })}>
                          {m}
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

                  <Field
                    label="Verify the phone before claiming a profile"
                    hint="Needs a working SMS provider — with none connected, leave this off or customers cannot finish signing up"
                  >
                    <label className="flex items-center gap-2 text-xs cursor-pointer h-9">
                      <Switch
                        checked={cfg.requireClaimOtp}
                        onCheckedChange={v => edit(tenantId, { requireClaimOtp: v })}
                        aria-label="Require an SMS code before claiming an existing profile"
                      />
                      {cfg.requireClaimOtp
                        ? 'SMS code required'
                        : 'Number alone is enough'}
                    </label>
                  </Field>
                  {!cfg.requireClaimOtp && (
                    <div className="sm:col-span-2 text-[11px] text-muted-foreground border-l-2 border-amber-500/60 pl-2">
                      With this off, anyone who knows a diner's number can set a PIN on the
                      profile you already hold for them and see its saved address and order
                      history. Turn it on once an SMS provider is connected.
                    </div>
                  )}

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
