// ============================================================================
// SUPER ADMIN PLATFORM — Supabase client
//
// These are Digital Target's OWN business records: packages, plans, invoices,
// payments, marketing contacts, service calls, releases, support threads.
//
// Every "Missing or insufficient permissions" reported from the panel came
// from these modules still writing to Firestore, where a Supabase-authenticated
// Super Admin has no identity at all. Firestore was refusing a stranger — the
// message was correct, it just named the wrong system.
//
// RLS on every table below is `is_super_admin()`. No restaurant can read them,
// with two deliberate exceptions: a restaurant may read its own invoices and
// payments (it is entitled to its own billing history) and its own support
// thread (but never the internal notes on it).
// ============================================================================

import { sb } from './supabase';

// ---------------------------------------------------------------------------
// Types — kept close to what the existing panel already renders, so the UI
// does not have to change.
// ---------------------------------------------------------------------------

export interface AdminPackage {
  id: string; name: string;
  setup_fee: number; monthly_fee: number;
  duration_months: number; devices?: number | null;
  description?: string | null; is_active: boolean; sort_order: number;
}

export interface AdminPlan {
  id: string; code: string; name: string;
  device_limit?: number | null; branch_limit?: number | null;
  price: number; features: Record<string, unknown>;
  is_active: boolean; sort_order: number;
}

export interface AdminInvoice {
  id: string; tenant_id?: string | null; number: string;
  issued_at: string; due_at?: string | null;
  line_items: Array<Record<string, unknown>>;
  subtotal: number; tax: number; total: number; paid_total: number;
  status: 'unpaid' | 'partial' | 'paid' | 'void'; notes?: string | null;
}

export interface AdminPayment {
  id: string; invoice_id?: string | null; tenant_id?: string | null;
  amount: number; method?: string | null; reference?: string | null;
  received_at: string; notes?: string | null;
}

export interface AdminRelease {
  id: string; version: string; channel: string;
  notes?: string | null; download_url?: string | null;
  is_published: boolean; target_tenant_ids: string[];
  published_at?: string | null; created_at: string;
}

// ---------------------------------------------------------------------------
// A single place to turn a Supabase error into something an operator can act
// on. `error.message` alone is often "new row violates row-level security
// policy", which tells a restaurant owner nothing.
// ---------------------------------------------------------------------------
function fail(op: string, error: { message: string; code?: string } | null): never {
  const msg = error?.message ?? 'unknown error';
  if (/row-level security/i.test(msg)) {
    throw new Error(`${op}: not permitted for this account (Super Admin only).`);
  }
  throw new Error(`${op}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export async function listPackages(): Promise<AdminPackage[]> {
  const { data, error } = await sb().from('admin_packages')
    .select('*').order('sort_order').order('name');
  if (error) fail('Load packages', error);
  return (data ?? []) as AdminPackage[];
}

export async function savePackage(p: Partial<AdminPackage>): Promise<AdminPackage> {
  const { data, error } = await sb().from('admin_packages')
    .upsert(p as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save package', error);
  return data as AdminPackage;
}

export async function deletePackage(id: string): Promise<void> {
  const { error } = await sb().from('admin_packages').delete().eq('id', id);
  if (error) fail('Delete package', error);
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(): Promise<AdminPlan[]> {
  const { data, error } = await sb().from('admin_plans')
    .select('*').order('sort_order').order('price');
  if (error) fail('Load plans', error);
  return (data ?? []) as AdminPlan[];
}

export async function savePlan(p: Partial<AdminPlan>): Promise<AdminPlan> {
  const { data, error } = await sb().from('admin_plans')
    .upsert(p as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save plan', error);
  return data as AdminPlan;
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await sb().from('admin_plans').delete().eq('id', id);
  if (error) fail('Delete plan', error);
}

/**
 * Change a restaurant's plan (trial → enterprise).
 *
 * Goes through an RPC rather than a direct UPDATE because this used to fail
 * SILENTLY: the panel wrote to Firestore, matched no rows, and reported
 * success. The RPC raises if the restaurant does not exist, so a failed change
 * is impossible to mistake for a successful one.
 */
export async function setTenantPlan(
  tenantId: string, plan: string, expiresAt?: string,
): Promise<void> {
  const { error } = await sb().rpc('sa_set_plan', {
    p_tenant: tenantId, p_plan: plan, p_expires: expiresAt ?? null,
  });
  if (error) fail('Change plan', error);
}

// ---------------------------------------------------------------------------
// Invoices and payments
// ---------------------------------------------------------------------------

export async function listInvoices(tenantId?: string): Promise<AdminInvoice[]> {
  let q = sb().from('admin_invoices').select('*').order('issued_at', { ascending: false });
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) fail('Load invoices', error);
  return (data ?? []) as AdminInvoice[];
}

export async function saveInvoice(inv: Partial<AdminInvoice>): Promise<AdminInvoice> {
  const { data, error } = await sb().from('admin_invoices')
    .upsert(inv as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save invoice', error);
  return data as AdminInvoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  const { error } = await sb().from('admin_invoices').delete().eq('id', id);
  if (error) fail('Delete invoice', error);
}

export async function listPayments(tenantId?: string): Promise<AdminPayment[]> {
  let q = sb().from('admin_payments').select('*').order('received_at', { ascending: false });
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) fail('Load payments', error);
  return (data ?? []) as AdminPayment[];
}

export async function savePayment(p: Partial<AdminPayment>): Promise<AdminPayment> {
  const { data, error } = await sb().from('admin_payments')
    .upsert(p as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save payment', error);

  // Keep the invoice's paid_total in step. Doing this here rather than in a
  // trigger keeps the arithmetic visible where the money is recorded.
  if (p.invoice_id) {
    const { data: rows } = await sb().from('admin_payments')
      .select('amount').eq('invoice_id', p.invoice_id);
    const paid = (rows ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const { data: inv } = await sb().from('admin_invoices')
      .select('total').eq('id', p.invoice_id).maybeSingle();
    const total = Number((inv as any)?.total ?? 0);
    await sb().from('admin_invoices').update({
      paid_total: paid,
      status: paid <= 0 ? 'unpaid' : paid + 0.009 < total ? 'partial' : 'paid',
    }).eq('id', p.invoice_id);
  }
  return data as AdminPayment;
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await sb().from('admin_payments').delete().eq('id', id);
  if (error) fail('Delete payment', error);
}

// ---------------------------------------------------------------------------
// Marketing and service calls
// ---------------------------------------------------------------------------

export async function listMarketingContacts() {
  const { data, error } = await sb().from('admin_marketing_contacts')
    .select('*').order('created_at', { ascending: false });
  if (error) fail('Load contacts', error);
  return data ?? [];
}

export async function saveMarketingContact(c: Record<string, unknown>) {
  const { data, error } = await sb().from('admin_marketing_contacts')
    .upsert(c as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save contact', error);
  return data;
}

export async function deleteMarketingContact(id: string) {
  const { error } = await sb().from('admin_marketing_contacts').delete().eq('id', id);
  if (error) fail('Delete contact', error);
}

export async function listServiceCalls(tenantId?: string) {
  let q = sb().from('admin_service_calls').select('*').order('created_at', { ascending: false });
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data, error } = await q;
  if (error) fail('Load service calls', error);
  return data ?? [];
}

export async function saveServiceCall(c: Record<string, unknown>) {
  const { data, error } = await sb().from('admin_service_calls')
    .upsert(c as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save service call', error);
  return data;
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export async function listReleases(): Promise<AdminRelease[]> {
  const { data, error } = await sb().from('admin_releases')
    .select('*').order('created_at', { ascending: false });
  if (error) fail('Load releases', error);
  return (data ?? []) as AdminRelease[];
}

export async function saveRelease(r: Partial<AdminRelease>): Promise<AdminRelease> {
  const { data, error } = await sb().from('admin_releases')
    .upsert(r as any, { onConflict: 'id' }).select().single();
  if (error) fail('Save release', error);
  return data as AdminRelease;
}

export async function publishRelease(id: string, targetTenantIds: string[] = []) {
  const { error } = await sb().from('admin_releases').update({
    is_published: true,
    target_tenant_ids: targetTenantIds,
    published_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) fail('Publish release', error);
}

/** The latest release visible to the signed-in restaurant. */
export async function latestReleaseForTenant(): Promise<AdminRelease | null> {
  const { data, error } = await sb().from('admin_releases')
    .select('*').eq('is_published', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return null;   // a missing release must never block the app
  return (data as AdminRelease) ?? null;
}

// ---------------------------------------------------------------------------
// Super Admin team
// ---------------------------------------------------------------------------

export async function listTeam() {
  const { data, error } = await sb().rpc('sa_list_team');
  if (error) fail('Load team', error);
  return data ?? [];
}

export async function addTeamMember(email: string, canManageTeam = false) {
  const { error } = await sb().rpc('sa_add_team_member', {
    p_email: email, p_can_manage: canManageTeam,
  });
  if (error) fail('Add team member', error);
}

export async function removeTeamMember(email: string) {
  const { error } = await sb().rpc('sa_remove_team_member', { p_email: email });
  if (error) fail('Remove team member', error);
}

// ---------------------------------------------------------------------------
// Support thread
// ---------------------------------------------------------------------------

export async function listSupportMessages(tenantId: string, includeInternal = false) {
  let q = sb().from('admin_support_messages')
    .select('*').eq('tenant_id', tenantId).order('created_at');
  if (!includeInternal) q = q.eq('is_internal', false);
  const { data, error } = await q;
  if (error) fail('Load messages', error);
  return data ?? [];
}

export async function sendSupportMessage(
  tenantId: string, body: string, direction: 'in' | 'out', isInternal = false,
) {
  const { error } = await sb().from('admin_support_messages').insert({
    tenant_id: tenantId, body, direction, is_internal: isInternal,
  });
  if (error) fail('Send message', error);
}

// ---------------------------------------------------------------------------
// v1.56.0 — emergency staff password reset
//
// REQUESTED: "ak bnda pass bhol gya din ka ya caser ka pos open he nhi hota is
// leyi ye option emergency rkho super admin penal me" — a cashier forgets their
// password, the POS will not open, and there is nobody above them to let them
// back in. Explicitly a RESTAURANT user's password, not the Super Admin's own.
//
// pos_update_user() already changes a staff password but opens with
// `auth_tenant_id()`, which is null for a Super Admin, so it refused every
// attempt — correctly. These go through sa_* functions guarded by
// is_super_admin() instead, so the cross-tenant branch is not inside the
// function every restaurant's own admin calls.
//
// The new password is set with must_change_password, which LoginPage has
// refused to get past since v1.31.1 — so it works exactly once, to let the
// person choose their own, and cannot quietly become a permanent backdoor.
// Every reset is written to the RESTAURANT's staff_audit_logs with the Super
// Admin's id and email.
// ---------------------------------------------------------------------------

export interface TenantStaffMember {
  userId: string;
  username: string;
  name: string;
  role: string;
  phone?: string | null;
  branchId?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  hasPassword: boolean;
  updatedAt?: string | null;
}

export interface TenantStaffList {
  staff: TenantStaffMember[];
  restaurant?: string | null;
  workspaceCode?: string | null;
}

/** Everyone who can sign in to one restaurant. Never returns a password hash. */
export async function listTenantStaff(tenantId: string): Promise<TenantStaffList> {
  const { data, error } = await sb().rpc('sa_list_staff', { p_tenant: tenantId });
  if (error) fail('Load staff', error);
  const r = data as any;
  if (!r?.ok) {
    throw new Error(r?.reason === 'forbidden'
      ? 'Load staff: Super Admin only.'
      : `Load staff: ${r?.reason || 'unknown error'}`);
  }
  return {
    staff: Array.isArray(r.staff) ? r.staff : [],
    restaurant: r.restaurant ?? null,
    workspaceCode: r.workspaceCode ?? null,
  };
}

export interface StaffPasswordReset {
  username: string;
  name: string;
  role: string;
  /** Shown once. Only its bcrypt hash was stored. */
  password: string;
}

/**
 * Reset one staff member's password.
 *
 * @param newPassword leave blank to have the server generate a readable one
 *        (its alphabet already excludes O/0 and I/l/1, which get misheard on
 *        the phone).
 * @param reason recorded in the restaurant's own audit log.
 */
export async function resetStaffPassword(
  userId: string, newPassword?: string, reason?: string,
): Promise<StaffPasswordReset> {
  const { data, error } = await sb().rpc('sa_reset_staff_password', {
    p_user_id: userId,
    p_new_password: newPassword?.trim() ? newPassword.trim() : null,
    p_reason: reason?.trim() ? reason.trim() : null,
  });
  if (error) fail('Reset password', error);
  const r = data as any;
  // A refusal must never read as a success. This used to be the whole class of
  // bug in this codebase: an RPC that answers {ok:false} while the caller
  // shows a green toast.
  if (!r?.ok) {
    const why = r?.reason === 'forbidden' ? 'Super Admin only.'
      : r?.reason === 'no_user'   ? 'That user no longer exists.'
      : r?.reason === 'too_short' ? (r?.message || 'Password is too short.')
      : (r?.message || r?.reason || 'unknown error');
    throw new Error(`Reset password: ${why}`);
  }
  return {
    username: String(r.username ?? ''),
    name: String(r.name ?? ''),
    role: String(r.role ?? ''),
    password: String(r.password ?? ''),
  };
}
