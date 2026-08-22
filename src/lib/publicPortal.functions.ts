import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Json } from '@/integrations/supabase/types';

const uuid = z.string().uuid();

export const submitPublicOrder = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({
    tenantId: uuid,
    branchId: uuid.nullable(),
    order: z.record(z.any()).refine(
      (order) => Array.isArray(order.items) && order.items.length > 0 && order.items.length <= 100,
      'Order must contain between 1 and 100 items',
    ),
  }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: result, error } = await supabaseAdmin.rpc('public_place_order', {
      p_tenant: data.tenantId,
      p_branch: data.branchId as string,
      p_order: data.order as Json,
    });
    if (error) throw new Error(error.message);
    return result as { id: string; order_number: number; order: Json };
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