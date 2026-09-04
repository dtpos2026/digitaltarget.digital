// ============================================================================
// v1.42.0 — the rest of the reported list.
//
//   "1 change could not be uploaded (orders)" on the Order Taker screen
//   "Order #undefined placed!" on the customer confirmation
//   a readable ordering link instead of a uuid
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { looksLikeSlug } from '@/lib/publicTenant';

const sql    = readFileSync('supabase/migrations/20260904110000_v1_42_0_order_taker_writes.sql', 'utf8');
const store  = readFileSync('src/lib/supabaseStore.ts', 'utf8');
const online = readFileSync('src/pages/OnlineOrderPage.tsx', 'utf8');

describe('the order taker\'s bills reach the server', () => {
  it('the store routes an order through the portal RPC when it has a token', () => {
    expect(store).toContain("if (col === 'orders')");
    expect(store).toContain('portalSaveOrder');
    expect(store).toContain("rpc('portal_upsert_order'");
  });

  it('a POS till with a real session keeps the ordinary path', () => {
    // portalSaveOrder returns false with no token, so nothing changes there.
    const fn = store.slice(store.indexOf('async function portalSaveOrder'));
    expect(fn).toContain('if (!token) return false;');
  });

  it('a refusal is never silent — that was the whole bug', () => {
    const fn = store.slice(store.indexOf('async function portalSaveOrder'));
    expect(fn).toContain('throw new Error(`portal_upsert_order refused');
  });

  it('the SERVER mints the order number, not the device', () => {
    expect(sql).toContain("jsonb_build_object('orderNumber', v_number");
    expect(sql).toContain('order_counters');
    expect(sql).toContain('greatest(');
  });

  it('an order of another restaurant is refused', () => {
    expect(sql).toContain("'not_yours'");
    expect(sql).toContain('where o.tenant_id = v_tenant');
  });

  it('only the two portal roles may use it', () => {
    expect(sql).toContain("v_role not in ('order_taker','rider')");
  });
});

describe('the customer never sees "Order #undefined"', () => {
  it('falls back to the row the RPC also returns', () => {
    expect(online).toContain('const placedNumber');
    expect(online).toContain('.order?.order_number');
    expect(online).toContain('.order?.data?.orderNumber');
  });

  it('only accepts a real number', () => {
    expect(online).toContain('Number.isFinite(placedNumber)');
  });

  it('says "Order placed!" rather than "#undefined"', () => {
    // The number is only put in the message when there IS one — asserted on
    // the guard, not on the absence of the template, which legitimately still
    // appears as the other half of the ternary.
    expect(online).toContain("order.orderNumber ? `Order #${order.orderNumber} placed!` : 'Order placed!'");
  });

  it('the confirmation card does not print a bare #', () => {
    expect(online).toContain("placedOrder.orderNumber ? `#${placedOrder.orderNumber}` : 'Confirmed'");
  });
});

describe('the readable ordering link', () => {
  it('tells a slug from a uuid', () => {
    expect(looksLikeSlug('butt')).toBe(true);
    expect(looksLikeSlug('butt-grilled-fish-restaurant')).toBe(true);
    expect(looksLikeSlug('fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb')).toBe(false);
    expect(looksLikeSlug('')).toBe(false);
    expect(looksLikeSlug(null)).toBe(false);
    expect(looksLikeSlug('a')).toBe(false);            // too short to be one
    expect(looksLikeSlug('has space')).toBe(false);
  });

  it('resolves a slug BEFORE the store is initialised', () => {
    const fn = online.slice(online.indexOf('const loadStore'));
    expect(fn).toContain('resolveSlugTenant');
    expect(fn.indexOf('resolveSlugTenant')).toBeLessThan(fn.indexOf('initStore()'));
  });

  it('only an ACTIVE restaurant resolves', () => {
    expect(sql).toContain('and t.is_active');
  });

  it('a uuid link still works — printed QR codes must not break', () => {
    // looksLikeSlug is false for a uuid, so the old path is untouched.
    expect(looksLikeSlug('fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb')).toBe(false);
  });
});
