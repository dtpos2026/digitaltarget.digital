// ============================================================================
// v1.28.0 — the white-label customer app really is per-restaurant
//
// The database half was verified against the live project: two customer_apps
// rows, two calls to public_customer_app_config, two different payloads, and
// null for a tenant that has no row. The payloads below are those exact
// responses, copied verbatim, so this exercises the client against what the
// server actually sends rather than an invented shape.
//
// What is asserted here is the half that lives in the browser: that loading a
// restaurant's configuration paints THAT restaurant's colour, name and feature
// switches, and that opening a second restaurant repaints rather than leaving
// the first one's identity behind.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The RPC responses recorded from the live database.
const BBQ = {
  tenantId: 'fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb',
  enabled: true,
  appName: 'Butt BBQ Express',
  logoUrl: 'https://cdn.example/bbq-logo.png',
  iconUrl: 'https://cdn.example/bbq-icon.png',
  theme: { mode: 'dark', primary: '#B91C1C' },
  whatsappNumber: '923001112222',
  features: { history: true, loyalty: false, tracking: true },
  appVersion: '1.0.0',
  minSupportedVersion: null,
  updateUrl: null,
  updateRequired: false,
};

const FISH = {
  tenantId: '509bf494-e968-40fc-82f7-4a25cbee8279',
  enabled: true,
  appName: 'Grilled Fish Club',
  logoUrl: 'https://cdn.example/fish-logo.png',
  iconUrl: 'https://cdn.example/fish-icon.png',
  theme: { mode: 'light', primary: '#0369A1' },
  whatsappNumber: '923004445555',
  features: { history: false, loyalty: true, tracking: true },
  appVersion: '2.3.1',
  minSupportedVersion: null,
  updateUrl: null,
  updateRequired: false,
};

const CONFIGS: Record<string, unknown> = {
  [BBQ.tenantId]: BBQ,
  [FISH.tenantId]: FISH,
};

let configured = true;
const rpcCalls: Array<{ fn: string; args: any }> = [];

vi.mock('@/lib/supabase', async () => ({
  isSupabaseConfigured: () => configured,
  currentTenantId: () => null,
  currentBranchId: () => null,
  sb: () => ({
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      // The live function returns SQL NULL for a tenant with no enabled row.
      return { data: CONFIGS[args?.p_tenant] ?? null, error: null };
    },
  }),
}));

const {
  loadCustomerAppConfig, getCachedAppConfig, applyCustomerAppTheme,
  hexToHslTriplet, featureOn,
} = await import('@/lib/customerAppConfig');

const readVar = (name: string) =>
  document.documentElement.style.getPropertyValue(name).trim();

beforeEach(() => {
  configured = true;
  rpcCalls.length = 0;
  localStorage.clear();
  document.documentElement.style.removeProperty('--primary');
  document.documentElement.style.removeProperty('--primary-glow');
  document.documentElement.classList.remove('dark');
  document.title = '';
});

describe('a restaurant gets its own identity, not the platform default', () => {
  it('loads the configuration the server holds for that tenant', async () => {
    const cfg = await loadCustomerAppConfig(BBQ.tenantId);
    expect(cfg?.appName).toBe('Butt BBQ Express');
    expect(cfg?.primaryColor).toBe('#B91C1C');
    expect(cfg?.mode).toBe('dark');
    expect(cfg?.whatsappNumber).toBe('923001112222');
    expect(rpcCalls[0]).toEqual({
      fn: 'public_customer_app_config',
      args: { p_tenant: BBQ.tenantId },
    });
  });

  it('paints that restaurant onto the running app', async () => {
    const cfg = await loadCustomerAppConfig(BBQ.tenantId);
    applyCustomerAppTheme(cfg);

    // #B91C1C is a deep red — the assertion is the actual conversion, so a
    // broken hex→HSL path cannot pass by writing something arbitrary.
    expect(readVar('--primary')).toBe(hexToHslTriplet('#B91C1C'));
    expect(readVar('--primary')).toBe('0 74% 42%');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.title).toBe('Butt BBQ Express');
  });

  it('repaints completely when a different restaurant is opened', async () => {
    applyCustomerAppTheme(await loadCustomerAppConfig(BBQ.tenantId));
    const red = readVar('--primary');

    applyCustomerAppTheme(await loadCustomerAppConfig(FISH.tenantId));
    const blue = readVar('--primary');

    expect(blue).not.toBe(red);
    expect(blue).toBe(hexToHslTriplet('#0369A1'));
    // The first restaurant's dark mode must not survive into the second.
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.title).toBe('Grilled Fish Club');
  });

  it('keeps the glow in the same hue as the brand colour', async () => {
    applyCustomerAppTheme(await loadCustomerAppConfig(FISH.tenantId));
    const [h, s, l] = readVar('--primary').split(' ');
    const [gh, gs, gl] = readVar('--primary-glow').split(' ');
    expect(gh).toBe(h);
    expect(gs).toBe(s);
    expect(parseInt(gl, 10)).toBeGreaterThan(parseInt(l, 10));
  });

  it('honours each restaurant\'s feature switches independently', async () => {
    const bbq = await loadCustomerAppConfig(BBQ.tenantId);
    const fish = await loadCustomerAppConfig(FISH.tenantId);

    expect(featureOn(bbq, 'history')).toBe(true);
    expect(featureOn(fish, 'history')).toBe(false);
    expect(featureOn(bbq, 'loyalty')).toBe(false);
    expect(featureOn(fish, 'loyalty')).toBe(true);
    // Not configured by either restaurant, so the permissive default stands.
    expect(featureOn(bbq, 'ordering')).toBe(true);
  });

  it('returns nothing for a restaurant with no customer app', async () => {
    const cfg = await loadCustomerAppConfig('00000000-0000-0000-0000-000000000000');
    expect(cfg).toBeNull();
    // And nothing is painted, so the site does not silently look like someone
    // else's restaurant.
    applyCustomerAppTheme(cfg);
    expect(readVar('--primary')).toBe('');
  });
});

describe('the branding survives a cold start', () => {
  it('caches per tenant and reads back the same identity', async () => {
    await loadCustomerAppConfig(BBQ.tenantId);
    await loadCustomerAppConfig(FISH.tenantId);

    expect(getCachedAppConfig(BBQ.tenantId)?.appName).toBe('Butt BBQ Express');
    expect(getCachedAppConfig(FISH.tenantId)?.appName).toBe('Grilled Fish Club');
    expect(getCachedAppConfig(BBQ.tenantId)?.primaryColor).toBe('#B91C1C');
    expect(getCachedAppConfig(FISH.tenantId)?.primaryColor).toBe('#0369A1');
  });

  it('opens branded with no backend rather than unbranded', async () => {
    await loadCustomerAppConfig(BBQ.tenantId);
    rpcCalls.length = 0;
    configured = false;

    const cfg = await loadCustomerAppConfig(BBQ.tenantId);
    expect(rpcCalls).toHaveLength(0);
    expect(cfg?.appName).toBe('Butt BBQ Express');
    expect(cfg?.mode).toBe('dark');
  });

  it('never serves one restaurant the other\'s cached branding', async () => {
    await loadCustomerAppConfig(BBQ.tenantId);
    configured = false;
    expect(await loadCustomerAppConfig(FISH.tenantId)).toBeNull();
  });
});
