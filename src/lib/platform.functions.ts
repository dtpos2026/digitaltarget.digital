// Super Admin provisioning that needs privileges the browser must never hold.
//
// Creating the restaurant owner's login used to run supabase.auth.signUp() in
// the panel itself. That has two defects: it swaps the Super Admin's own
// session for the new owner's, and Supabase rejects it outright for some
// address shapes — which is exactly the "owner account could not be made"
// warning. The Auth Admin API has neither problem, so the work moves here.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const provisionRestaurantOwner = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    tenantId: z.string().uuid(),
    email: z.string().email(),
    password: z.string().min(6),
    displayName: z.string().min(1),
  }).parse(data))
  .handler(async ({ data, context }) => {
    // Authorise through the CALLER's own client so RLS decides, not us.
    const { data: isAdmin, error: adminErr } = await context.supabase.rpc('is_super_admin');
    if (adminErr) throw new Error(adminErr.message);
    if (!isAdmin) throw new Error('Super Admin only');

    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const email = data.email.trim().toLowerCase();

    let userId: string | null = null;
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName },
    });

    if (created.error) {
      // An existing account is not a failure: link it and reset its password
      // so the credentials the Super Admin just handed over actually work.
      if (!/already|registered|exists/i.test(created.error.message)) {
        throw new Error(`Auth account step: ${created.error.message}`);
      }
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (list?.users as Array<{ id: string; email?: string | null }> | undefined)
        ?.find((u) => (u.email ?? '').toLowerCase() === email);
      if (!found) throw new Error(`Auth account step: ${created.error.message}`);
      userId = found.id;
      const pwd = await supabaseAdmin.auth.admin.updateUserById(userId, { password: data.password });
      if (pwd.error) throw new Error(`Password reset step: ${pwd.error.message}`);
    } else {
      userId = created.data.user?.id ?? null;
    }
    if (!userId) throw new Error('Auth account step: no user id returned');

    const linkRes = await supabaseAdmin
      .from('tenants')
      .update({ owner_user_id: userId })
      .eq('id', data.tenantId);
    if (linkRes.error) throw new Error(`Restaurant link step: ${linkRes.error.message}`);

    const { data: branch } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('tenant_id', data.tenantId)
      .order('sort_order')
      .limit(1)
      .maybeSingle();

    // Every tenant needs at least one branch: the POS binds its device (and so
    // every sync and every map pin) to a branch id. Create one when missing
    // rather than leaving the owner with a device that can never register.
    let branchId = branch?.id ?? null;
    if (!branchId) {
      const madeBranch = await supabaseAdmin
        .from('branches')
        .insert({ tenant_id: data.tenantId, name: 'Main Branch', is_active: true })
        .select('id')
        .maybeSingle();
      if (madeBranch.error) throw new Error(`Branch step: ${madeBranch.error.message}`);
      branchId = madeBranch.data?.id ?? null;
    }

    const { error: profErr } = await supabaseAdmin.from('user_profiles').upsert(
      {
        user_id: userId,
        tenant_id: data.tenantId,
        branch_id: branchId,
        username: email.split('@')[0] || 'owner',
        display_name: data.displayName,
        role: 'owner',
        all_branches: true,
        is_active: true,
      },
      { onConflict: 'user_id' },
    );
    if (profErr) throw new Error(`Owner profile step: ${profErr.message}`);

    // The restaurant first signs in with its owner email/password, then the POS
    // staff screen needs an account of its own. v1.31.2: this used to set that
    // PIN to a four-digit constant shared by every owner on the platform. It now
    // generates one per restaurant and returns it, to be handed over once.
    const { error: defaultLoginErr } = await supabaseAdmin.rpc('set_default_owner_pos_login', {
      p_user_id: userId,
      p_tenant: data.tenantId,
    });
    if (defaultLoginErr) throw new Error(`POS login step: ${defaultLoginErr.message}`);

    // Record the owner's email against the restaurant so the panel can show
    // who signs in — the list used to render a blank email column.
    const pending = await supabaseAdmin.from('pending_owners').upsert(
      { tenant_id: data.tenantId, email, claimed_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (pending.error) throw new Error(`Owner record step: ${pending.error.message}`);

    // Read BACK what we just wrote. "Created but not linked" was the actual
    // failure users saw, and an unverified write cannot rule it out.
    const [tenantRow, profileRow] = await Promise.all([
      supabaseAdmin.from('tenants').select('id, name, owner_user_id').eq('id', data.tenantId).maybeSingle(),
      supabaseAdmin.from('user_profiles').select('user_id, tenant_id, role, is_active, branch_id, username')
        .eq('user_id', userId).maybeSingle(),
    ]);
    if (tenantRow.data?.owner_user_id !== userId) {
      throw new Error('Verification failed: restaurant is not linked to the new owner account');
    }
    if (!profileRow.data || profileRow.data.tenant_id !== data.tenantId
      || profileRow.data.role !== 'owner' || !profileRow.data.is_active) {
      throw new Error('Verification failed: owner profile was not created for this restaurant');
    }

    return {
      ok: true,
      userId,
      verified: true,
      tenantName: tenantRow.data?.name ?? null,
      branchId,
      posUsername: profileRow.data.username,
    };
  });

