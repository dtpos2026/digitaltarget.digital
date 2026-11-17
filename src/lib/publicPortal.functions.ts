import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Json } from '@/integrations/supabase/types';

const uuid = z.string().uuid();

export const submitPublicOrder = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    tenantId: uuid,
    branchId: uuid.nullable(),
    // v1.115.0 — the customer's session, when signed in: the server needs it to honour a code made for account holders
    customerToken: z.string().min(32).max(200).nullable().optional(),
    order: z.record(z.any()).refine(
      (order) => Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 100,
      'Order must contain between 1 and 100 items',
    ),
  }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    // v1.95.0 — the owner's switches (Online ordering, Delivery, Pickup) are enforced here too. The page checks them
    // first; this is the backstop for a stale page or a hand-made request. A settings read that fails must not stop an
    // order, so only a clear "closed" answer blocks.
    let blocked: string | null = null;
    try {
      const { readStorefront, orderingBlockedReason } = await import('@/lib/publicStorefront');
      const sf = await readStorefront(supabaseAdmin as unknown as import('@/lib/publicStorefront').StorefrontDb, data.tenantId);
      blocked = sf ? orderingBlockedReason(sf, data.order) : null;
    } catch { /* fail open: see above */ }
    if (blocked) throw new Error(blocked);
    // v1.115.0 — the server prices the order (items, minimum, delivery charge, promo code and its use); what it answers is the truth
    const payload = data.customerToken ? { ...data.order, customerToken: data.customerToken } : data.order;
    const { data: result, error } = await supabaseAdmin.rpc('public_place_order', {
      p_tenant: data.tenantId,
      p_branch: data.branchId as string,
      p_order: payload as Json,
    });
    if (error) throw new Error(error.message);
    return result as { id: string; order_number: number; subtotal?: number; discount?: number; delivery_charge?: number; grand_total?: number; order: Json };
  });

/** v1.115.0 — is this promo code good for this basket, and what does it take off? (the server's rule, the same one the order uses) */
export const checkPublicPromo = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    tenantId: uuid,
    code: z.string().trim().min(1).max(40),
    subtotal: z.number().min(0).max(100000000),
    customerToken: z.string().min(32).max(200).nullable().optional(),
  }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: result, error } = await supabaseAdmin.rpc('public_check_promo', {
      p_tenant: data.tenantId, p_code: data.code, p_subtotal: data.subtotal, p_token: data.customerToken ?? undefined,
    });
    if (error) throw new Error(error.message);
    return result as { ok: boolean; reason?: string; minOrder?: number; code?: string; discount?: number };
  });

/** v1.115.0 — the Offers page: the codes the owner chose to show, and the active deals. */
export const getPublicOffers = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({ tenantId: uuid }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: result, error } = await supabaseAdmin.rpc('public_offers', { p_tenant: data.tenantId });
    if (error) throw new Error(error.message);
    return result as {
      ok: boolean;
      codes?: Array<{ code: string; discountType: 'percent' | 'pkr'; discountValue: number; minOrder: number | null; validUntil: string | null; accountsOnly: boolean; notes: string | null }>;
      deals?: Array<{ id: string; name: string; price: number; items: Json; image: string | null }>;
    };
  });

export const trackPublicOrder = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    tenantId: uuid,
    orderId: uuid.nullable().default(null),
    orderNumber: z.number().int().positive().nullable().default(null),
    phoneLast4: z.string().max(20).nullable().default(null),
    tableLabel: z.string().trim().max(100).nullable().default(null),
  }).refine((input) => input.orderId || input.orderNumber, 'Order ID or number is required').parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: result, error } = await supabaseAdmin.rpc('public_track_order', {
      p_tenant: data.tenantId,
      p_order_id: data.orderId ?? undefined,
      p_order_number: data.orderNumber ?? undefined,
      p_phone_last4: data.phoneLast4 ?? undefined,
      p_table_label: data.tableLabel ?? undefined,
    });
    if (error) throw new Error(error.message);
    return result as Json | null;
  });

export const createPublicWaiterCall = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    tenantId: uuid,
    branchId: uuid.nullable(),
    tableLabel: z.string().trim().min(1).max(100),
    floorName: z.string().trim().max(100).nullable(),
    message: z.string().trim().min(1).max(300),
  }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: result, error } = await supabaseAdmin.rpc('public_call_waiter', {
      p_tenant: data.tenantId,
      p_branch: data.branchId as string,
      p_table_label: data.tableLabel,
      p_floor_name: data.floorName ?? undefined,
      p_message: data.message,
    });
    if (error) throw new Error(error.message);
    return result as Json;
  });