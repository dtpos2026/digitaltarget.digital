// ============================================================================
// Per-restaurant branding for the customer app.
//
// One anon-callable RPC returns the row the Super Admin configured. Nothing
// here decides anything: if the app is switched off, the RPC returns nothing
// and the caller is expected to say so rather than quietly serving an unbranded
// site.
//
// The result is cached on the device so the app opens already branded — a
// packaged APK that flashes the wrong colours on every launch looks broken —
// and so it still knows its own name with no connection.
// ============================================================================
import { sb, isSupabaseConfigured } from './supabase';

export interface CustomerAppFeatures {
  ordering?: boolean;
  tracking?: boolean;
  history?: boolean;
  offers?: boolean;
  support?: boolean;
  whatsapp?: boolean;
  loyalty?: boolean;
}

export interface CustomerAppConfig {
  tenantId: string;
  enabled: boolean;
  appName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string | null;
  mode: 'light' | 'dark' | null;
  whatsappNumber: string | null;
  features: CustomerAppFeatures;
  appVersion: string | null;
  minSupportedVersion: string | null;
  updateUrl: string | null;
  updateRequired: boolean;
}

const CACHE_PREFIX = 'dt-customer-app-config:';

/** Defaults are permissive: a restaurant that configured nothing still works. */
const DEFAULT_FEATURES: Required<CustomerAppFeatures> = {
  ordering: true, tracking: true, history: true,
  offers: true, support: true, whatsapp: true, loyalty: false,
};

export function featureOn(cfg: CustomerAppConfig | null, key: keyof CustomerAppFeatures): boolean {
  if (!cfg) return DEFAULT_FEATURES[key];
  const v = cfg.features?.[key];
  return v === undefined ? DEFAULT_FEATURES[key] : v !== false;
}

function normalize(raw: any): CustomerAppConfig | null {
  if (!raw || typeof raw !== 'object' || !raw.tenantId) return null;
  const theme = (raw.theme ?? {}) as Record<string, string>;
  return {
    tenantId: String(raw.tenantId),
    enabled: raw.enabled !== false,
    appName: String(raw.appName ?? ''),
    logoUrl: raw.logoUrl ?? null,
    iconUrl: raw.iconUrl ?? null,
    primaryColor: theme.primary ?? null,
    mode: (theme.mode as 'light' | 'dark') ?? null,
    whatsappNumber: raw.whatsappNumber ?? null,
    features: { ...DEFAULT_FEATURES, ...((raw.features ?? {}) as CustomerAppFeatures) },
    appVersion: raw.appVersion ?? null,
    minSupportedVersion: raw.minSupportedVersion ?? null,
    updateUrl: raw.updateUrl ?? null,
    updateRequired: raw.updateRequired === true,
  };
}

export function getCachedAppConfig(tenantId: string): CustomerAppConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + tenantId);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch { return null; }
}

function cache(tenantId: string, cfg: CustomerAppConfig | null): void {
  try {
    const k = CACHE_PREFIX + tenantId;
    if (cfg) localStorage.setItem(k, JSON.stringify({ ...cfg, theme: { primary: cfg.primaryColor, mode: cfg.mode } }));
    else localStorage.removeItem(k);
  } catch { /* private mode */ }
}

/**
 * @returns the configuration, or null when this restaurant has no customer app
 *          (never configured, switched off, or the tenant is inactive).
 */
export async function loadCustomerAppConfig(tenantId: string): Promise<CustomerAppConfig | null> {
  if (!tenantId) return null;
  if (!isSupabaseConfigured()) return getCachedAppConfig(tenantId);
  try {
    const { data, error } = await sb().rpc('public_customer_app_config' as never, { p_tenant: tenantId } as never);
    if (error) throw error;
    const cfg = normalize(data);
    cache(tenantId, cfg);
    return cfg;
  } catch {
    // Offline: the branding it opened with last time is the right answer.
    return getCachedAppConfig(tenantId);
  }
}

// ---------------------------------------------------------------------------
// Applying the theme.
//
// The stylesheet expresses colours as bare HSL triplets ("273 89% 23%"), so a
// hex from the panel has to be converted rather than assigned.
// ---------------------------------------------------------------------------

export function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return `${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

/** Paint the restaurant's colour onto the running app. Safe to call repeatedly. */
export function applyCustomerAppTheme(cfg: CustomerAppConfig | null): void {
  if (typeof document === 'undefined' || !cfg) return;
  const root = document.documentElement;

  if (cfg.primaryColor) {
    const triplet = hexToHslTriplet(cfg.primaryColor);
    if (triplet) {
      root.style.setProperty('--primary', triplet);
      // The glow is the same hue, lifted, so gradients and hovers stay in family.
      const [h, s, l] = triplet.split(' ');
      const lift = Math.min(95, parseInt(l, 10) + 12);
      root.style.setProperty('--primary-glow', `${h} ${s} ${lift}%`);
    }
  }
  if (cfg.mode === 'dark' || cfg.mode === 'light') {
    root.classList.toggle('dark', cfg.mode === 'dark');
  }
  if (cfg.appName) document.title = cfg.appName;
}
