// ============================================================
// Tests — v1.22.0 collection → table mapping
//
// REPORTED: "Cloud sync issue — data is saved locally and will retry",
// repeating endlessly.
//
// CAUSE: three collections were mapped to tables whose shape they do not fit.
// Every write failed, the deferred queue retried, and the toast reappeared —
// while nothing ever reached the cloud. Verified against the live database:
//
//   waiters/riders/users -> user_profiles : "column id does not exist"
//                                           (its key is user_id, not id)
//   marketingContacts    -> customers     : "column restaurant_name does not exist"
//
// Each already has a dedicated path, so the generic writer must skip them.
// ============================================================
import { describe, it, expect } from 'vitest';
import { tableFor, isGenericallySyncable, isDocStoreCollection, TABLE_FOR, toSnake, toCamel, rowToDb, rowFromDb } from '@/lib/supabaseStore';

describe('collections with a dedicated path are NOT generically synced', () => {
  it('staff never go through the generic writer', () => {
    // user_profiles has no `id` column; staff are created by pos_create_user(),
    // which hashes the password server-side.
    for (const col of ['users', 'waiters', 'riders']) {
      expect(tableFor(col)).toBeNull();
      expect(isGenericallySyncable(col)).toBe(false);
    }
  });

  it('waiters and riders still persist on the server as documents', () => {
    // They have no table of their own, so they were skipped entirely and
    // stayed device-bound. They now save into module_documents.
    expect(isDocStoreCollection('waiters')).toBe(true);
    expect(isDocStoreCollection('riders')).toBe(true);
    expect(isDocStoreCollection('users')).toBe(false);
  });

  it('marketing leads do not get written to the customers table', () => {
    // A sales lead carries restaurantName / source / linkedTenantId — none of
    // which exist on customers. They belong to admin_marketing_contacts.
    expect(tableFor('marketingContacts')).toBeNull();
  });

  it('stock movements now sync as documents', () => {
    // stock_logs is a document table (jsonb `data`), so a movement can be
    // written on its own without violating a NOT NULL item column.
    expect(tableFor('stockLogs')).toBe('stock_logs');
    const row = rowToDb('stockLogs', { id: 's1', itemId: 'i1', qty: -2, reason: 'wastage' });
    expect(row.data.qty).toBe(-2);
  });

  it('document tables keep every field and round-trip', () => {
    const row = rowToDb('employees', { id: 'e1', name: 'Ali', salary: 50000, cnic: '123' });
    expect(row.data.cnic).toBe('123');
    const back = rowFromDb({ id: 'e1', data: row.data, updated_at: new Date().toISOString() }, 'employees');
    expect(back.name).toBe('Ali');
    expect(back.salary).toBe(50000);
    expect(back.items).toBeUndefined();
  });
});

describe('the collections the POS actually needs still map', () => {
  const core = [
    ['categories', 'categories'],
    ['menuItems', 'menu_items'],
    ['orders', 'orders'],
    ['tables', 'dining_tables'],
    ['floors', 'floors'],
    ['kitchens', 'kitchens'],
    ['inventory', 'inventory_items'],
    ['customers', 'customers'],
    ['employees', 'employees'],
    ['branches', 'branches'],
    ['paymentAccounts', 'payment_accounts'],
    ['deals', 'deals'],
    ['shifts', 'shifts'],
    ['refunds', 'refunds'],
    ['recipes', 'recipes'],
  ] as const;

  for (const [col, table] of core) {
    it(`${col} -> ${table}`, () => {
      expect(tableFor(col)).toBe(table);
      expect(isGenericallySyncable(col)).toBe(true);
    });
  }

  it('an unknown collection is skipped rather than guessed at', () => {
    expect(tableFor('somethingNew')).toBeNull();
  });
});

describe('field name conversion', () => {
  it('camelCase becomes snake_case', () => {
    expect(toSnake('menuItemId')).toBe('menu_item_id');
    expect(toSnake('grandTotal')).toBe('grand_total');
    expect(toSnake('name')).toBe('name');
  });

  it('snake_case becomes camelCase', () => {
    expect(toCamel('menu_item_id')).toBe('menuItemId');
    expect(toCamel('grand_total')).toBe('grandTotal');
  });

  it('round-trips without loss', () => {
    for (const f of ['orderNumber', 'serviceChargePercent', 'isTokenSale']) {
      expect(toCamel(toSnake(f))).toBe(f);
    }
  });
});

describe('every mapped table name is snake_case', () => {
  it('no camelCase leaked into a table name', () => {
    // A camelCase table name would 404 at PostgREST and surface as the same
    // vague sync error.
    for (const table of Object.values(TABLE_FOR)) {
      expect(table).toBe(table.toLowerCase());
    }
  });
});

describe('order document persistence', () => {
  it('stores the complete bill inside the orders data column', () => {
    const bill = {
      id: 'order-1', orderNumber: 42, status: 'paid', grandTotal: 1332,
      branchId: 'branch-1', createdAt: '2026-08-19T20:00:00Z',
      items: [{ id: 'line-1', name: 'Tea', quantity: 4, lineTotal: 1332 }],
      payments: [{ id: 'pay-1', method: 'cash', amount: 1332 }],
    };
    const row = rowToDb('orders', bill);
    expect(row).toMatchObject({ order_number: 42, status: 'paid', total: 1332 });
    expect(row.data.items).toHaveLength(1);
    expect(row.items).toBeUndefined();
  });

  it('restores items and payments after a cloud refresh', () => {
    const restored = rowFromDb({
      id: 'order-1', order_number: 42, status: 'paid', total: 1332,
      created_at: '2026-08-19T20:00:00Z', updated_at: '2026-08-19T20:01:00Z',
      data: {
        id: 'order-1', createdAt: '2026-08-19T20:00:00Z',
        items: [{ id: 'line-1', name: 'Tea' }],
        payments: [{ id: 'pay-1', method: 'cash', amount: 1332 }],
      },
    });
    expect(restored.items).toHaveLength(1);
    expect(restored.payments).toHaveLength(1);
    expect(restored.grandTotal).toBe(1332);
  });

  it('makes legacy incomplete order rows safe to render', () => {
    const restored = rowFromDb({ id: 'legacy', order_number: 7, status: 'running', total: 50 });
    expect(restored.items).toEqual([]);
    expect(restored.payments).toEqual([]);
  });
});

// ============================================================
// v1.26.1 — a shift used to arrive at the cloud as a shell
//
// ALLOWED_COLUMNS.shifts lists the fifteen columns the table has, and rowToDb
// drops everything else. The app's Shift also carries staffName, staffEmail,
// payIns, payOuts, actualEndingCash and notes — none of which are columns.
// So every cash pay-in and pay-out, the counted closing cash, and the name of
// whoever ran the till were discarded at this boundary. Nothing errored. On a
// second device the shift existed but the cash-drawer report could not be
// reconstructed from it.
// ============================================================
describe('a shift survives the round trip to the database and back', () => {
  const shift = {
    id: 'shift-1',
    deviceId: 'till-2',
    staffId: 'u-9',
    staffName: 'Ayesha',
    staffEmail: 'ayesha@example.com',
    openedAt: '2026-08-22T09:00:00.000Z',
    closedAt: '2026-08-22T17:00:00.000Z',
    startingCash: 5000,
    payIns: [{ id: 'm1', at: '2026-08-22T11:00:00.000Z', amount: 2000, reason: 'Float top-up', by: 'Ayesha' }],
    payOuts: [{ id: 'm2', at: '2026-08-22T15:00:00.000Z', amount: 800, reason: 'Bank drop', by: 'Ayesha' }],
    actualEndingCash: 12450,
    status: 'closed' as const,
    notes: 'Drawer short by 50',
    _updatedAt: 1_700_000_000_000,
  };

  it('keeps the cash movements, the counted cash, the staff and the notes', () => {
    const row = rowToDb('shifts', shift);
    const back = rowFromDb({ ...row, id: 'shift-1', updated_at: '2026-08-22T17:00:00.000Z' }, 'shifts');

    expect(back.payIns).toHaveLength(1);
    expect(back.payIns[0].amount).toBe(2000);
    expect(back.payOuts).toHaveLength(1);
    expect(back.payOuts[0].reason).toBe('Bank drop');
    expect(back.actualEndingCash).toBe(12450);
    expect(back.staffName).toBe('Ayesha');
    expect(back.notes).toBe('Drawer short by 50');
  });

  it('still fills the typed columns the unique index and reports read', () => {
    // idx_one_open_shift is a partial unique index on (tenant, branch, device)
    // WHERE status = 'open'. If status stopped being a real column, two tills
    // could hold an open shift on the same device.
    const row = rowToDb('shifts', shift);
    expect(row.status).toBe('closed');
    expect(row.device_id ?? row.deviceId).toBeDefined();
    expect(row.starting_cash).toBe(5000);
  });

  it('reads a pre-v1.26.1 row, which has no document at all, unchanged', () => {
    const legacy = {
      id: 'shift-0', device_id: 'till-1', status: 'open',
      starting_cash: 3000, opened_at: '2026-08-01T09:00:00.000Z',
      updated_at: '2026-08-01T09:00:00.000Z', data: null,
    };
    const back = rowFromDb(legacy, 'shifts');
    expect(back.status).toBe('open');
    expect(back.startingCash).toBe(3000);
    expect(back.id).toBe('shift-0');
  });
});
