// ============================================================================
// v1.59.0 — the website threw away the size the customer picked
//
// Two reports, one function.
//
//   "meny ak client ko dy rha tha software ky online order key but erro agya"
//   "ak item ha usky varient han ... jo varient sale howa who inventry sy cut jay"
//
// public_place_order() re-prices every line from the menu row — correct, a
// browser must not name its own price — but it read ONLY menu_items.price and
// never looked at size_variants / inch_variants. So:
//
//   * a Large was charged at the BASE price. The customer saw Large's price on
//     the website and the bill said something else.
//   * order_items.variant_type and .variant_name — columns that already exist —
//     were left null on every website order, and the stored data line carried
//     no variant either.
//   * so deductStockForOrder() could never see a variant: cartVariantKey()
//     builds its key from variantType/variantName, finds nothing, and falls
//     back to the item's default recipe. The variant's own inventory was never
//     deducted. The client side was never at fault — OnlineOrderPage does set
//     both fields on the line.
//
// And the error the client hit: (v_item->>'menuItemId')::uuid raised
// 22P02 "invalid input syntax for type uuid", which reached the customer as
// "Order fail: invalid input syntax for type uuid".
//
// Measured on the live database after the change, with probe orders removed:
//
//   junk item id   -> 22023 "item not available: Ghost Item"
//   unknown size   -> 22023 "that size is no longer available: Sting (NoSuchSize)"
//   good order     -> unit_price 70.00, the variant's price, total 140 for qty 2
//   variant_name   -> "Regular" in order_items AND in the data line
//   note           -> carried (it was read from 'notes' while callers write 'note')
//
// One defect of my own was caught by that run and fixed before this shipped:
// `v_menu := null` does not reset a plpgsql RECORD, so reading v_menu.id raised
// 55000 "record is not assigned yet" — the same class of cryptic error this
// change exists to remove. The lookup is tracked with a boolean instead.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartVariantKey } from '@/lib/store';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260926120000_v1_59_0_online_order_variants.sql'),
  'utf8',
).replace(/--[^\n]*/g, '');   // never assert against this file's own prose

describe('the size the customer picked reaches the bill', () => {
  it('prices the line from the VARIANT, not the base item', () => {
    expect(sql).toContain("case when v_vtype = 'inch'");
    expect(sql).toContain('coalesce(v_menu.inch_variants');
    expect(sql).toContain('coalesce(v_menu.size_variants');
    expect(sql).toContain('v_price := v_vprice;');
  });

  it('still takes the price from the server, never from the browser', () => {
    // The whole reason this function re-prices. A client-sent price would let
    // anyone buy a pizza for one rupee.
    expect(sql).not.toMatch(/v_price\s*:=\s*\(v_item->>'price'\)/);
    expect(sql).toContain("select (x->>'price')::numeric into v_vprice");
  });

  it('writes the variant to the columns that already existed for it', () => {
    expect(sql).toContain('variant_type, variant_name)');
    expect(sql).toContain('v_vtype, v_vname);');
  });

  it('puts the variant in the stored line, which is what stock reads', () => {
    expect(sql).toContain("'variantType', v_vtype");
    expect(sql).toContain("'variantName', v_vname");
  });
});

describe('stock deduction can now match that line', () => {
  it('cartVariantKey reads exactly the two fields the order now carries', () => {
    expect(cartVariantKey({ variantType: 'size', variantName: 'Regular' })).toBe('size:Regular');
    expect(cartVariantKey({ variantType: 'inch', variantName: '12 Inch' })).toBe('inch:12 Inch');
  });

  it('a line with no variant still falls back to the default recipe', () => {
    expect(cartVariantKey({ variantType: undefined, variantName: undefined })).toBe('');
  });

  it('defaults a missing type to size, so a half-filled line still matches', () => {
    expect(cartVariantKey({ variantType: undefined, variantName: 'Large' })).toBe('size:Large');
  });
});

describe('a bad order says what is wrong instead of leaking Postgres', () => {
  it('an id that is not a uuid is handled, not thrown', () => {
    expect(sql).toContain('v_mid := (v_item->>\'menuItemId\')::uuid;');
    expect(sql).toContain('exception when others then');
    expect(sql).toContain("raise exception 'item not available: %'");
  });

  it('a RECORD is never read before it is assigned', () => {
    // `v_menu := null` does not reset a record; reading it raises 55000.
    expect(sql).not.toContain('v_menu := null;');
    expect(sql).toContain('v_found := found;');
    expect(sql).toContain('if not v_found then');
  });

  it('a vanished size is named rather than silently charged at base price', () => {
    expect(sql).toContain("raise exception 'that size is no longer available: % (%)'");
  });

  it('a bad QR table id does not fail the whole order', () => {
    expect(sql).toContain('v_branch := p_branch;');
  });
});

describe('the kitchen note is no longer dropped', () => {
  it('reads the key every caller actually writes', () => {
    expect(sql).toContain("coalesce(nullif(v_item->>'note', ''), nullif(v_item->>'notes', ''), '')");
  });
});
