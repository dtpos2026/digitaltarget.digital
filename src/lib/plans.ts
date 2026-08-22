// DT POS — Subscription Plans (device limits + feature gating)
// Plans are defined here so they can be updated centrally. Super Admin
// can also set a per-restaurant `customDeviceLimit` to override.

export type PlanId = 'trial' | 'starter' | 'business' | 'premium' | 'enterprise' | 'basic';

export interface PlanInfo {
  id: PlanId;
  name: string;
  deviceLimit: number;     // 0 = unlimited
  monthlyPriceRs: number;
  description: string;
  color: string;
  features: string[];      // page keys allowed; '*' = all
}

// ---- Feature catalog ----
// Cumulative — each tier extends the previous one.
const TRIAL_FEATURES = [
  'pos', 'tables', 'bills', 'kitchen', 'menu',
  'settings', 'dashboard', 'devices', 'users',
  // v1.3.0 Token module — available on every plan, but each restaurant must
  // still switch it ON itself in Settings → Features (default OFF). Super
  // Admin can still block it per tenant via feature overrides if needed.
  'tokens',
  'itemSalesReport',
];

const STARTER_FEATURES = [
  ...TRIAL_FEATURES,
  'delivery', 'pickup', 'retray', 'pending-payments', 'void-bills', 'credits',
  'customers', 'whatsapp', 'inventory', 'hr', 'accounts',
  'reports', 'backup',
];

const BUSINESS_FEATURES = [
  ...STARTER_FEATURES,
  'variations', 'recipes', 'wastage', 'receiving',
  'promo-codes', 'marketing', 'crm', 'customer-map',
  'profitability', 'costing', 'reports-center',
  'riders', 'rider-app', 'branches',
];

const PREMIUM_FEATURES = [
  ...BUSINESS_FEATURES,
  'online-portal', 'live-map', 'live-riders', 'branches-map',
];

export const PLANS: Record<PlanId, PlanInfo> = {
  trial: {
    id: 'trial', name: 'Trial', deviceLimit: 2, monthlyPriceRs: 0,
    description: '14-day free trial · 2 devices', color: 'text-zinc-500',
    features: TRIAL_FEATURES,
  },
  starter: {
    id: 'starter', name: 'Starter', deviceLimit: 5, monthlyPriceRs: 3000,
    description: 'Single outlet · 5 devices', color: 'text-blue-500',
    features: STARTER_FEATURES,
  },
  business: {
    id: 'business', name: 'Business', deviceLimit: 10, monthlyPriceRs: 6000,
    description: 'Growing restaurant · 10 devices', color: 'text-green-600',
    features: BUSINESS_FEATURES,
  },
  premium: {
    id: 'premium', name: 'Premium', deviceLimit: 20, monthlyPriceRs: 12000,
    description: 'Multi-station setup · 20 devices', color: 'text-purple-600',
    features: PREMIUM_FEATURES,
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', deviceLimit: 0, monthlyPriceRs: 25000,
    description: 'Chains / custom · Unlimited devices', color: 'text-amber-600',
    features: ['*'],
  },
  // Legacy fallback — old accounts default to Starter feature set
  basic: {
    id: 'basic', name: 'Basic (Legacy)', deviceLimit: 5, monthlyPriceRs: 3000,
    description: 'Legacy plan · 5 devices', color: 'text-zinc-500',
    features: STARTER_FEATURES,
  },
};

export const PLAN_OPTIONS: PlanInfo[] = ['trial', 'starter', 'business', 'premium', 'enterprise']
  .map(id => PLANS[id as PlanId]);

export function getPlan(id?: string | null): PlanInfo {
  if (id && (PLANS as any)[id]) return (PLANS as any)[id];
  return PLANS.trial;
}

/**
 * Effective device limit for a restaurant.
 * Priority: customDeviceLimit (Super Admin override) > plan.deviceLimit.
 * Returns Infinity for unlimited.
 */
export function effectiveDeviceLimit(planId?: string | null, customLimit?: number | null): number {
  if (typeof customLimit === 'number' && customLimit > 0) return customLimit;
  const limit = getPlan(planId).deviceLimit;
  return limit === 0 ? Infinity : limit;
}

/** Is `pageKey` allowed for the given plan? */
export function planAllowsFeature(planId: string | null | undefined, pageKey: string): boolean {
  const p = getPlan(planId);
  if (p.features.includes('*')) return true;
  return p.features.includes(pageKey);
}

/** Apply Super Admin per-tenant overrides on top of the plan default. */
export function featureEnabled(
  planId: string | null | undefined,
  pageKey: string,
  overrides?: Record<string, boolean> | null,
): boolean {
  if (overrides && typeof overrides[pageKey] === 'boolean') return overrides[pageKey];
  return planAllowsFeature(planId, pageKey);
}

// ---- Client-side current plan + feature overrides storage ----
// Stored on login so the sidebar / route guards know what to show.
const PLAN_LS_KEY = 'pos-tenant-plan';
const OVERRIDES_LS_KEY = 'pos-tenant-feature-overrides';

export function setCurrentTenantPlan(plan: string | undefined | null) {
  try {
    if (plan) localStorage.setItem(PLAN_LS_KEY, plan);
    else localStorage.removeItem(PLAN_LS_KEY);
  } catch {}
  try { window.dispatchEvent(new CustomEvent('pos-plan-changed', { detail: plan })); } catch {}
}

export function getCurrentTenantPlan(): string {
  try { return localStorage.getItem(PLAN_LS_KEY) || 'trial'; } catch { return 'trial'; }
}

export function setCurrentTenantOverrides(overrides: Record<string, boolean> | null | undefined) {
  try {
    if (overrides && Object.keys(overrides).length) {
      localStorage.setItem(OVERRIDES_LS_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(OVERRIDES_LS_KEY);
    }
  } catch {}
  try { window.dispatchEvent(new CustomEvent('pos-plan-changed', { detail: 'overrides' })); } catch {}
}

export function getCurrentTenantOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OVERRIDES_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export const DEVICE_LIMIT_REACHED_MSG =
  'Your device limit has been reached. Please contact Digital Target Super Admin to approve or increase your device limit.';

