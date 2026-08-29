// ============================================================
// Shared staff portal sign-in (Rider + Order Taker)
// ------------------------------------------------------------
// ONE app serves EVERY restaurant. The app never picks the
// restaurant: the server resolves user -> tenant -> branch -> role
// from the credentials alone (staff_login_global, SECURITY DEFINER,
// service-role only). An optional Workspace Code only disambiguates
// a username that exists at more than one restaurant — it is never
// the security boundary.
// ============================================================
import { setTenant, getTenantId } from './tenant';
import { setPortalToken, portalLogout } from './portalData';

export interface PortalIdentity {
  userId: string;
  name: string;
  username: string;
  role: string;
  tenantId: string;
  tenantName: string;
  workspaceCode: string | null;
  branchId: string | null;
  allBranches: boolean;
  permissions: string[];
}

export type PortalLoginResult =
  | { ok: true; identity: PortalIdentity }
  | { ok: false; reason: string; message: string; needWorkspaceCode?: boolean };

const WORKSPACE_KEY = 'pos-workspace-code';

export function getSavedWorkspaceCode(): string {
  try { return localStorage.getItem(WORKSPACE_KEY) || ''; } catch { return ''; }
}
export function saveWorkspaceCode(code: string) {
  try {
    if (code) localStorage.setItem(WORKSPACE_KEY, code.trim().toUpperCase());
    else localStorage.removeItem(WORKSPACE_KEY);
  } catch { /* ignore */ }
}

/**
 * Sign a staff member in from any restaurant.
 * `expectedRole` guards the app identity: the Rider app must not accept an
 * Order Taker account and vice-versa.
 */
export async function portalSignIn(opts: {
  username: string;
  password: string;
  workspaceCode?: string;
  expectedRole?: 'rider' | 'order_taker';
}): Promise<PortalLoginResult> {
  const { staffSignInGlobal } = await import('./staffAuth.functions');
  let res: Awaited<ReturnType<typeof staffSignInGlobal>>;
  try {
    res = await staffSignInGlobal({
      data: {
        username: opts.username.trim(),
        password: opts.password,
        workspaceCode: (opts.workspaceCode || '').trim() || null,
      },
    });
  } catch (e) {
    return { ok: false, reason: 'network', message: (e as Error)?.message || 'Could not reach the server' };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      message: res.message,
      needWorkspaceCode: res.reason === 'need_workspace_code',
    };
  }

  if (opts.expectedRole && res.role !== opts.expectedRole) {
    return {
      ok: false,
      reason: 'wrong_role',
      message: opts.expectedRole === 'rider'
        ? 'This account is not a Rider account.'
        : 'This account is not an Order Taker account.',
    };
  }

  // Bind the device to the resolved restaurant BEFORE any data is read, so
  // every store read/write is scoped to that tenant. Switching restaurants
  // triggers the cross-tenant cache wipe in sessionIsolation.ts.
  if (res.tenantId && res.tenantId !== getTenantId()) {
    setTenant(res.tenantId, res.tenantName || undefined);
  } else if (res.tenantId) {
    setTenant(res.tenantId, res.tenantName || undefined);
  }
  if (res.workspaceCode) saveWorkspaceCode(res.workspaceCode);

  // ===== v1.29.0 — the session that lets the portal READ =====
  //
  // Binding the tenant above tells the device WHICH restaurant it belongs to.
  // It does not make the device allowed to read that restaurant, because there
  // is no Supabase session behind a staff login — so every request went as
  // `anon`, and RLS gave back the public menu and nothing else: no tables, no
  // riders, no orders.
  //
  // The token is what the portal_* functions resolve to this staff member. It
  // is stored only here and sent only to those functions; the restaurant it
  // belongs to is inside it, so it cannot be pointed at another one.
  setPortalToken(res.portalToken ?? null);

  const identity: PortalIdentity = {
    userId: res.userId,
    name: res.name,
    username: opts.username.trim(),
    role: res.role,
    tenantId: res.tenantId,
    tenantName: res.tenantName,
    workspaceCode: res.workspaceCode,
    branchId: res.branchId,
    allBranches: res.allBranches,
    permissions: res.permissions,
  };

  try {
    localStorage.setItem('pos-user-id', identity.userId);
    localStorage.setItem('pos-user-role', identity.role);
    localStorage.setItem('dt_pos_current_user', JSON.stringify({
      id: identity.userId, name: identity.name, username: identity.username, role: identity.role,
    }));
  } catch { /* ignore */ }

  return { ok: true, identity };
}

/**
 * Sign the portal out everywhere, not just on this screen.
 *
 * Clearing local state alone left the server-side session alive for thirty
 * days, so a lost or handed-on phone stayed a way into the restaurant. This
 * ends it at the source; the local token is dropped first, so the app is signed
 * out even when the request cannot be made.
 */
export async function portalSignOut(): Promise<void> {
  await portalLogout();
  try {
    localStorage.removeItem('pos-user-id');
    localStorage.removeItem('pos-user-role');
    localStorage.removeItem('dt_pos_current_user');
  } catch { /* ignore */ }
}
