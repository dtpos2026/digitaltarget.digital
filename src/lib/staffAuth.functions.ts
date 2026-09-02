// POS staff sign-in (username + password) verified on the server.
//
// The screen used to call verify_staff_pin() straight from the browser. That
// RPC runs as the CALLER, so it needs a live Supabase session and a resolved
// tenant. On the POS screen neither is guaranteed: the owner's session may
// have expired, or the tenant may not have been re-resolved yet after a
// reload. Both cases came back as a plain "Invalid username or password" for
// credentials that were perfectly correct.
//
// This path verifies the bcrypt hash inside Postgres through a service-role
// routine, so it works with or without a browser session, and reports the
// EXACT reason when it fails.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type StaffLoginResult =
  | {
      ok: true;
      userId: string;
      name: string;
      role: string;
      branchId: string | null;
      permissions: string[];
      /** v1.31.1 — true while the account still has its shipped password. */
      mustChangePassword: boolean;
      /**
       * v1.39.0 — this restaurant's Workspace Code.
       *
       * The card on the dashboard reads tenants.workspace_code through
       * auth_tenant_id(), which needs a Supabase auth session. A POS staff
       * member has none — user_profiles rows are not auth.users accounts — so
       * the card could only tell the person at the till to fetch the owner.
       * The code comes back on the login instead, which has already checked
       * this username against its bcrypt hash. Null only on an older server.
       */
      workspaceCode: string | null;
    }
  | { ok: false; reason: string; message: string };

export const staffSignIn = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<StaffLoginResult> => {
    const messages: Record<string, string> = {
      no_tenant: 'This device is not linked to a restaurant yet. Sign in with the owner email first.',
      no_user: 'No staff account with that username in this restaurant.',
      inactive: 'This staff account is disabled. Ask the owner to activate it.',
      no_password: 'No password is set for this account yet. Ask the owner to set one.',
      bad_password: 'Wrong password for this username.',
    };
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();

    const { data: res, error } = await supabaseAdmin.rpc('staff_login_check' as never, {
      p_tenant: data.tenantId,
      p_username: data.username.trim(),
      p_pin: data.password,
    } as never);

    if (error) throw new Error(error.message);

    const r = (res ?? {}) as {
      ok?: boolean;
      reason?: string;
      user_id?: string;
      name?: string | null;
      role?: string | null;
      branch_id?: string | null;
      permissions?: string[] | null;
      must_change_password?: boolean | null;
      // v1.39.0 — the code the rider and order-taker apps ask for. It rides
      // back on the login that already proved this staff member's identity,
      // so the till can show it without an owner email sign-in.
      workspace_code?: string | null;
    };

    if (!r.ok) {
      // Uniform small delay so a wrong password cannot be told apart from an
      // unknown username by timing alone.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const reason = r.reason ?? 'bad_password';
      return { ok: false, reason, message: messages[reason] ?? 'Invalid username or password' };
    }

    // The platform stores the restaurant owner as role 'owner', but the POS
    // only knows admin/manager/cashier/rider/order_taker. Without this mapping
    // the owner signs in with an unknown role, gets no default permissions and
    // sees an empty sidebar.
    const rawRole = (r.role ?? 'cashier').toLowerCase();
    const role = rawRole === 'owner' ? 'admin' : rawRole;

    return {
      ok: true,
      userId: r.user_id ?? '',
      name: r.name ?? data.username,
      role,
      branchId: r.branch_id ?? null,
      permissions: r.permissions ?? [],
      mustChangePassword: r.must_change_password === true,
      workspaceCode: r.workspace_code ?? null,
    };

  });

export const saveStaffUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    userId: z.string().min(1),
    username: z.string().trim().min(1).max(80),
    password: z.string().min(4).max(128),
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(['admin', 'manager', 'cashier', 'rider', 'order_taker']),
    branchId: z.preprocess(
      (v) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
      },
      z.string().uuid().nullable(),
    ),
    permissions: z.array(z.string()).default([]),
    featurePermissions: z.array(z.string()).default([]),
    phone: z.string().nullable(),
    allBranches: z.boolean(),
    isActive: z.boolean(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: caller, error: callerError } = await context.supabase
      .from('user_profiles')
      .select('tenant_id, role, is_active')
      .eq('user_id', context.userId)
      .maybeSingle();
    if (callerError) throw new Error(`Permission check: ${callerError.message}`);
    if (!caller?.tenant_id || !caller.is_active || !['owner', 'admin', 'manager'].includes(caller.role)) {
      throw new Error('Only an active owner, admin, or manager can save staff users');
    }

    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const normalized = data.username.toLowerCase();
    const existing = await supabaseAdmin.from('user_profiles')
      .select('user_id').eq('tenant_id', caller.tenant_id).eq('username', normalized).maybeSingle();
    if (existing.error) throw new Error(`Username check: ${existing.error.message}`);

    let userId = existing.data?.user_id ?? null;
    if (!userId) {
      const safeName = normalized.replace(/[^a-z0-9._-]/g, '-').slice(0, 48) || 'staff';
      const created = await supabaseAdmin.auth.admin.createUser({
        email: `${caller.tenant_id}.${safeName}@staff.dtpos.local`,
        password: globalThis.crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { display_name: data.displayName, staff_account: true },
      });
      if (created.error || !created.data.user?.id) {
        throw new Error(`Staff account step: ${created.error?.message ?? 'No user ID returned'}`);
      }
      userId = created.data.user.id;
    }

    const { error } = await supabaseAdmin.rpc('pos_set_staff_profile' as never, {
      p_user_id: userId,
      p_tenant: caller.tenant_id,
      p_username: normalized,
      p_password: data.password,
      p_display_name: data.displayName,
      p_role: data.role,
      p_branch_id: data.branchId,
      p_permissions: data.permissions,
      p_feature_permissions: data.featurePermissions,
      p_phone: data.phone,
      p_all_branches: data.allBranches,
      p_is_active: data.isActive,
    } as never);
    if (error) throw new Error(`Staff profile step: ${error.message}`);
    return { ok: true, userId };
  });

/**
 * Remove a POS staff user. The browser can only delete the LOCAL copy, so on
 * Supabase a deleted user kept coming back on the next refresh. This deletes
 * the profile row (and the shadow auth account) server-side.
 */
export const deleteStaffUser = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: caller, error: callerError } = await context.supabase
      .from('user_profiles')
      .select('tenant_id, role, is_active')
      .eq('user_id', context.userId)
      .maybeSingle();
    if (callerError) throw new Error(`Permission check: ${callerError.message}`);
    if (!caller?.tenant_id || !caller.is_active || !['owner', 'admin'].includes(caller.role)) {
      throw new Error('Only an active owner or admin can delete staff users');
    }
    if (data.userId === context.userId) throw new Error('You cannot delete your own account');

    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const target = await supabaseAdmin.from('user_profiles')
      .select('user_id, tenant_id, role').eq('user_id', data.userId).maybeSingle();
    if (target.error) throw new Error(target.error.message);
    if (!target.data) return { ok: true };
    if (target.data.tenant_id !== caller.tenant_id) throw new Error('That user belongs to another restaurant');
    if (target.data.role === 'owner') throw new Error('The restaurant owner account cannot be deleted');

    const del = await supabaseAdmin.from('user_profiles').delete().eq('user_id', data.userId);
    if (del.error) throw new Error(`Delete step: ${del.error.message}`);
    // Best effort: the shadow auth login is useless without a profile.
    try { await supabaseAdmin.auth.admin.deleteUser(data.userId); } catch { /* ignore */ }
    return { ok: true };
  });

// ============================================================
// Global staff sign-in — ONE Rider / Order Taker app for ALL restaurants.
// ------------------------------------------------------------
// The client sends only credentials (plus an optional workspace code). The
// SERVER resolves user -> tenant -> branch -> role. Tenant identity supplied
// by the frontend is never trusted, so a staff member cannot reach another
// restaurant's data by editing a URL or local state.
// ============================================================
export type GlobalStaffLoginResult =
  | {
      ok: true;
      userId: string;
      name: string;
      role: string;
      tenantId: string;
      tenantName: string;
      workspaceCode: string | null;
      branchId: string | null;
      allBranches: boolean;
      permissions: string[];
      featurePermissions: string[];
      /**
       * v1.29.0 — an opaque session for the Rider and Order Taker apps.
       *
       * Those two have no Supabase session (POS staff are user_profiles rows,
       * not auth.users), so without this every read they make is `anon` and RLS
       * correctly refuses tables, riders and orders. Present only for the two
       * portal roles; null for everyone else, who do not need one.
       */
      portalToken: string | null;
    }
  | { ok: false; reason: string; message: string };

export const staffSignInGlobal = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        username: z.string().trim().min(1).max(120),
        password: z.string().min(1).max(200),
        workspaceCode: z.string().trim().max(24).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<GlobalStaffLoginResult> => {
    const messages: Record<string, string> = {
      no_user: 'No staff account with that username. Check the username, or enter your Workspace Code.',
      no_user_in_workspace: 'No staff account with that username at this Workspace Code.',
      need_workspace_code: 'This username exists at more than one restaurant — enter your Workspace Code.',
      inactive: 'This account is disabled. Ask the restaurant admin to activate it.',
      bad_password: 'Wrong password / PIN.',
    };

    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: res, error } = await supabaseAdmin.rpc('staff_login_global' as never, {
      p_username: data.username,
      p_pin: data.password,
      p_workspace_code: data.workspaceCode ?? null,
    } as never);
    if (error) throw new Error(error.message);

    const r = (res ?? {}) as {
      ok?: boolean;
      reason?: string;
      user_id?: string;
      name?: string | null;
      role?: string | null;
      tenant_id?: string;
      tenant_name?: string | null;
      workspace_code?: string | null;
      branch_id?: string | null;
      all_branches?: boolean | null;
      permissions?: string[] | null;
      feature_permissions?: string[] | null;
    };

    if (!r.ok) {
      // Constant-ish delay so a wrong password is not distinguishable by timing.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const reason = r.reason ?? 'bad_password';
      return { ok: false, reason, message: messages[reason] ?? 'Invalid username or password' };
    }

    const rawRole = (r.role ?? 'cashier').toLowerCase();

    // ===== v1.29.0 — the portal could see the menu and nothing else =====
    //
    // This verified the staff member and then handed the browser an identity,
    // with no Supabase session behind it — POS staff are user_profiles rows and
    // have no auth.users account to sign into. So every read the Rider and
    // Order Taker apps made afterwards went as `anon`, and the policies
    // answered exactly as written: menu_items and categories are public, so the
    // menu appeared; dining_tables, user_profiles and orders are
    // authenticated-only, so there were no tables, no riders and no orders.
    //
    // The session token below is the same device the customer app already uses
    // (public_customer_login -> customer_from_token): opaque, stored only as a
    // sha256, and resolvable only by the portal_* functions, which return that
    // one restaurant's rows and cannot be pointed at another.
    //
    // A token is minted only for the two portal roles. A cashier signing into
    // the POS goes through the owner's Supabase session and needs none, and
    // handing one out anyway would widen what a POS login is.
    let portalToken: string | null = null;
    if ((rawRole === 'rider' || rawRole === 'order_taker') && r.user_id && r.tenant_id) {
      const { data: tok, error: tokErr } = await supabaseAdmin.rpc('portal_session_create' as never, {
        p_user_id: r.user_id,
        p_tenant_id: r.tenant_id,
        p_branch_id: r.branch_id ?? null,
        p_role: rawRole,
        p_all_branches: !!r.all_branches,
      } as never);
      // A failure here must not block the sign-in: the app still works offline
      // from its cached roster, and saying "wrong password" would be a lie.
      if (tokErr) console.error('[staff] portal session could not be created:', tokErr.message);
      else portalToken = (tok as string | null) ?? null;
    }

    return {
      ok: true,
      userId: r.user_id ?? '',
      name: r.name ?? data.username,
      role: rawRole === 'owner' ? 'admin' : rawRole,
      tenantId: r.tenant_id ?? '',
      tenantName: r.tenant_name ?? '',
      workspaceCode: r.workspace_code ?? null,
      branchId: r.branch_id ?? null,
      allBranches: !!r.all_branches,
      permissions: r.permissions ?? [],
      featurePermissions: r.feature_permissions ?? [],
      portalToken,
    };
  });
