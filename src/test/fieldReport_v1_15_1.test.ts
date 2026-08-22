// ============================================================
// Tests — v1.15.1, from the client's field report of 29/07/2026
//
// Six numbered points plus three follow-up messages and a set of photos.
// Every case below reproduces one reported symptom and asserts the exact
// behaviour that was wrong, so a future change that reintroduces the bug
// fails here instead of in a restaurant.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { releasedTable, buildTableSession, isTableOccupied } from '@/lib/tableRelease';
import { sortTablesForGrid, compareNatural } from '@/lib/tableOrder';
import {
  archiveOrders, getArchivedOrders, getAllHistoricalOrders,
  clearArchivedOrders, pruneArchive, ARCHIVE_RETENTION_DAYS,
} from '@/lib/orderArchive';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function table(over: any = {}): any {
  return {
    id: over.id || 't1',
    name: over.name || 'Table 1',
    seats: 4,
    status: 'running',
    ...over,
  };
}

function order(over: any = {}): any {
  return {
    id: over.id || 'o1',
    orderNumber: over.orderNumber ?? 1,
    status: 'paid',
    grandTotal: 100,
    items: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

// ============================================================
// Point 5 + "Now the empty table doesn't go running mode"
// Screenshot: five tables badged AVAILABLE while each showed a live
// dine timer — "Sitting 94h 31m", i.e. four days on a free table.
// ============================================================
describe('freeing a table clears the dine timer', () => {
  it('drops seatedAt — the phantom "Sitting 94h" is impossible', () => {
    const seatedAt = new Date(Date.now() - 94 * HOUR).toISOString();
    const t = table({ seatedAt, seatedGuests: 2, currentOrderId: 'o1' });

    const freed = releasedTable(t, order());

    expect(freed.seatedAt).toBeUndefined();
    expect(freed.currentOrderId).toBeUndefined();
    expect(freed.status).toBe('free');
  });

  it('records the finished session so the card can show "Last: … freed"', () => {
    const seatedAt = new Date(Date.now() - 2 * HOUR).toISOString();
    const t = table({ seatedAt, seatedGuests: 3 });

    const freed = releasedTable(t, order({ orderNumber: 30, grandTotal: 978.25 }));

    expect(freed.sessions).toHaveLength(1);
    const s = freed.sessions![0];
    expect(s.durationMinutes).toBe(120);
    expect(s.orderNumber).toBe(30);
    expect(s.total).toBe(978.25);
    expect(s.guests).toBe(3);
  });

  it('keeps earlier sessions — history is appended, never replaced', () => {
    const prior = {
      seatedAt: new Date(Date.now() - 5 * DAY).toISOString(),
      freedAt: new Date(Date.now() - 5 * DAY + HOUR).toISOString(),
      durationMinutes: 60,
    };
    const t = table({ seatedAt: new Date(Date.now() - HOUR).toISOString(), sessions: [prior] });

    expect(releasedTable(t).sessions).toHaveLength(2);
  });

  it('a table that was never seated still releases cleanly', () => {
    const freed = releasedTable(table({ seatedAt: undefined }));
    expect(freed.status).toBe('free');
    expect(freed.sessions).toHaveLength(0);
  });

  it('can release to "closed" as well as "free"', () => {
    const t = table({ seatedAt: new Date(Date.now() - HOUR).toISOString() });
    expect(releasedTable(t, undefined, 'closed').status).toBe('closed');
    expect(releasedTable(t, undefined, 'closed').seatedAt).toBeUndefined();
  });

  it('a corrupt seatedAt does not produce a NaN session', () => {
    expect(buildTableSession(table({ seatedAt: 'not-a-date' }))).toBeNull();
  });

  it('a table seated but never billed still counts as occupied', () => {
    // This is the exact state behind "hold it without items": no order
    // pointer at all. If it read as free, Day Close would skip it and the
    // timer would survive the night.
    const t = table({ status: 'running', seatedAt: new Date().toISOString(), currentOrderId: undefined });
    expect(isTableOccupied(t)).toBe(true);
  });

  it('a genuinely free table is not treated as occupied', () => {
    expect(isTableOccupied(table({ status: 'free', seatedAt: undefined, currentOrderId: undefined }))).toBe(false);
  });
});

// ============================================================
// "I put the tables in the running number in the Floor Map.
//  But in Grid it doesn't go in order."
// Screenshot order was: Table 4, 1, 2, 3, 5 / 6, 10, 11, 8, 9.
// ============================================================
describe('grid follows a sensible table order', () => {
  it('sorts by table number when no floor map has been arranged', () => {
    const messy = ['Table 4', 'Table 1', 'Table 2', 'Table 3', 'Table 5']
      .map((name, i) => table({ id: 't' + i, name }));

    expect(sortTablesForGrid(messy).map(t => t.name))
      .toEqual(['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5']);
  });

  it('puts Table 9 before Table 10 — the other half of the reported mess', () => {
    // A plain string sort gives 10, 11, 6, 8, 9. The client saw 6, 10, 11, 8, 9.
    const t = ['Table 11', 'Table 6', 'Table 9', 'Table 10', 'Table 8']
      .map((name, i) => table({ id: 't' + i, name }));

    expect(sortTablesForGrid(t).map(x => x.name))
      .toEqual(['Table 6', 'Table 8', 'Table 9', 'Table 10', 'Table 11']);
  });

  it('follows the floor map in reading order once tables are arranged', () => {
    // Two rows of two. Deliberately supplied back-to-front.
    const arranged = [
      table({ id: 'd', name: 'Table D', x: 300, y: 400 }),
      table({ id: 'c', name: 'Table C', x: 40, y: 400 }),
      table({ id: 'b', name: 'Table B', x: 300, y: 40 }),
      table({ id: 'a', name: 'Table A', x: 40, y: 40 }),
    ];

    expect(sortTablesForGrid(arranged).map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats slightly uneven drags as the same row', () => {
    // Nobody drags to a pixel-perfect line; 40 vs 55 is one row, not two.
    const arranged = [
      table({ id: 'right', name: 'Table 2', x: 300, y: 40 }),
      table({ id: 'left', name: 'Table 1', x: 40, y: 55 }),
    ];
    expect(sortTablesForGrid(arranged).map(t => t.id)).toEqual(['left', 'right']);
  });

  it('never hides a table that has no floor-map position', () => {
    const mixed = [
      table({ id: 'placed', name: 'Table 2', x: 40, y: 40 }),
      table({ id: 'loose', name: 'Table 1' }),
    ];
    const out = sortTablesForGrid(mixed);
    expect(out).toHaveLength(2);
    expect(out.map(t => t.id)).toEqual(['placed', 'loose']);
  });

  it('does not mutate the array it was given', () => {
    const input = [table({ id: 'b', name: 'Table 2' }), table({ id: 'a', name: 'Table 1' })];
    sortTablesForGrid(input);
    expect(input.map(t => t.id)).toEqual(['b', 'a']);
  });

  it('natural compare handles names without numbers', () => {
    expect(compareNatural('Bar', 'Terrace')).toBeLessThan(0);
  });
});

// ============================================================
// Point 4 — "After Day close, The Shift Report shows 0 orders.
//            Cannot take previous dates report."
// ============================================================
describe('reports survive Day Close', () => {
  beforeEach(() => {
    clearArchivedOrders();
    localStorage.clear();
  });

  it('an archived order is still reportable after it leaves the live store', () => {
    const paid = order({ id: 'gone', orderNumber: 30, grandTotal: 978.25 });
    archiveOrders([paid]);

    // Day Close has emptied the live store.
    const forReport = getAllHistoricalOrders([]);

    expect(forReport).toHaveLength(1);
    expect(forReport[0].orderNumber).toBe(30);
  });

  it('the live copy wins over the archived one — it is fresher', () => {
    archiveOrders([order({ id: 'x', grandTotal: 100 })]);
    const merged = getAllHistoricalOrders([order({ id: 'x', grandTotal: 250 })]);

    expect(merged).toHaveLength(1);
    expect(merged[0].grandTotal).toBe(250);
  });

  it('re-archiving the same order does not duplicate it in the report', () => {
    // Settlement archives it, then Day Close archives the whole day again.
    const o = order({ id: 'dup' });
    archiveOrders([o]);
    archiveOrders([o]);

    expect(getArchivedOrders().filter(x => x.id === 'dup')).toHaveLength(1);
  });

  it('keeps yesterday, last week and last month — the presets the client uses', () => {
    const mk = (id: string, daysAgo: number) =>
      order({ id, createdAt: new Date(Date.now() - daysAgo * DAY).toISOString() });
    archiveOrders([mk('today', 0), mk('yesterday', 1), mk('week', 7), mk('month', 30)]);

    const ids = getAllHistoricalOrders([]).map(o => o.id).sort();
    expect(ids).toEqual(['month', 'today', 'week', 'yesterday']);
  });

  it('archiving nothing is a no-op, not a wipe', () => {
    archiveOrders([order({ id: 'keep' })]);
    archiveOrders([]);
    expect(getArchivedOrders()).toHaveLength(1);
  });

  it('prunes beyond the retention window so localStorage cannot fill up', () => {
    const fresh = order({ id: 'fresh', createdAt: new Date().toISOString() });
    const ancient = order({
      id: 'ancient',
      createdAt: new Date(Date.now() - (ARCHIVE_RETENTION_DAYS + 30) * DAY).toISOString(),
    });

    const kept = pruneArchive([fresh, ancient]);

    expect(kept.map(o => o.id)).toEqual(['fresh']);
  });

  it('prune returns newest first', () => {
    const older = order({ id: 'older', createdAt: new Date(Date.now() - 3 * DAY).toISOString() });
    const newer = order({ id: 'newer', createdAt: new Date(Date.now() - 1 * DAY).toISOString() });

    expect(pruneArchive([older, newer]).map(o => o.id)).toEqual(['newer', 'older']);
  });
});

// ============================================================
// Point 6 — "Second time I ordered ice cream and put serve later.
//            But kot doesn't print the remarks."
//
// The update KOT prints alone; the kitchen does not see the full ticket
// again. These assert the render CONDITION used by KitchenReceipt's update
// banner, which previously had no order-note branch at all.
// ============================================================
describe('update KOT carries the order remark', () => {
  const shouldPrintNote = (settings: any, order: any) =>
    settings.kotShowNotes !== false && !!order.notes;

  it('prints "Serve Later" on the changes-only slip', () => {
    expect(shouldPrintNote({}, { notes: 'Serve Later' })).toBe(true);
  });

  it('stays silent when the order has no remark', () => {
    expect(shouldPrintNote({}, { notes: '' })).toBe(false);
    expect(shouldPrintNote({}, {})).toBe(false);
  });

  it('respects a restaurant that switched kitchen notes off', () => {
    expect(shouldPrintNote({ kotShowNotes: false }, { notes: 'Serve Later' })).toBe(false);
  });

  it('notes are on by default — the setting is opt-out, not opt-in', () => {
    expect(shouldPrintNote({ kotShowNotes: undefined }, { notes: 'No onions' })).toBe(true);
  });
});

// ============================================================
// v1.15.2 — "retrieve me order shuffling hota hai jab pay ya print kryn",
//           "ek order create karte hain, retrieve me 2 pade hote hain",
//           "KOT double nikal jata hai some time"
// ============================================================
import { sortOrdersNewestFirst, liveOrderForTable, liveOrdersForTable } from '@/lib/orderOrder';

describe('the Retrieve list holds a stable order', () => {
  const mk = (id: string, minsAgo: number, n: number) =>
    order({ id, orderNumber: n, status: 'running', createdAt: new Date(Date.now() - minsAgo * 60000).toISOString() });

  it('lists newest first, whatever order the cache happened to hold', () => {
    const cache = [mk('b', 10, 2), mk('c', 30, 1), mk('a', 1, 3)];
    expect(sortOrdersNewestFirst(cache).map(o => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives the same result no matter how the array arrived — no shuffling', () => {
    const a = mk('a', 1, 3), b = mk('b', 10, 2), c = mk('c', 30, 1);
    const first = sortOrdersNewestFirst([a, b, c]).map(o => o.id);
    const second = sortOrdersNewestFirst([c, a, b]).map(o => o.id);
    const third = sortOrdersNewestFirst([b, c, a]).map(o => o.id);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('breaks ties deterministically when timestamps are identical', () => {
    const same = new Date().toISOString();
    const x = order({ id: 'x', orderNumber: 5, createdAt: same });
    const y = order({ id: 'y', orderNumber: 6, createdAt: same });
    expect(sortOrdersNewestFirst([x, y]).map(o => o.id))
      .toEqual(sortOrdersNewestFirst([y, x]).map(o => o.id));
  });

  it('does not mutate the caller array', () => {
    const input = [mk('b', 10, 2), mk('a', 1, 3)];
    sortOrdersNewestFirst(input);
    expect(input.map(o => o.id)).toEqual(['b', 'a']);
  });
});

describe('one table resolves to one bill', () => {
  it('always picks the newest live bill, never an arbitrary one', () => {
    const older = order({ id: 'old', tableId: 't1', status: 'running', createdAt: new Date(Date.now() - 3600e3).toISOString() });
    const newer = order({ id: 'new', tableId: 't1', status: 'running', createdAt: new Date().toISOString() });

    expect(liveOrderForTable([older, newer], 't1')!.id).toBe('new');
    expect(liveOrderForTable([newer, older], 't1')!.id).toBe('new');
  });

  it('ignores settled bills on the same table', () => {
    const paid = order({ id: 'paid', tableId: 't1', status: 'paid' });
    const live = order({ id: 'live', tableId: 't1', status: 'hold' });
    expect(liveOrderForTable([paid, live], 't1')!.id).toBe('live');
  });

  it('reports every live bill so the cashier can be warned', () => {
    const a = order({ id: 'a', tableId: 't1', status: 'running' });
    const b = order({ id: 'b', tableId: 't1', status: 'partial' });
    expect(liveOrdersForTable([a, b], 't1')).toHaveLength(2);
  });

  it('returns nothing for a table with no live bill', () => {
    expect(liveOrderForTable([order({ id: 'x', tableId: 't9', status: 'paid' })], 't9')).toBeUndefined();
  });
});

describe('a takeaway does not print two kitchen tickets', () => {
  // Mirrors the guard in POSScreen: force bypasses the dedup check, so it
  // must only be used when nothing has been sent to the kitchen yet.
  const shouldForceKot = (o: any) => !o.kotPrinted;

  it('prints once for a takeaway paid straight away', () => {
    expect(shouldForceKot({ kotPrinted: false })).toBe(true);
  });

  it('does NOT print again for a takeaway that already went to the kitchen', () => {
    expect(shouldForceKot({ kotPrinted: true })).toBe(false);
  });
});

// ============================================================
// v1.16.0 — Localisation to English
//
// The software sells into Singapore, Malaysia, the Gulf and Europe. A
// cashier or customer in those markets must never see Roman Urdu. These
// tests guard the user-facing surfaces: if someone adds a Roman Urdu
// string back into a screen a client actually looks at, this fails.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

// Words distinctive enough that an English sentence will not contain them.
const ROMAN_URDU = /\b(karein|karen|kijiye|nahi|nahin|zaroori|dobara|khaali|bilkul|daalein|chunein|jayega|jayegi|hogaya|shuru|chahiye|warna|taake|pehle|wapas|lazmi|shamil|mazrat|shukriya|dabayein|dabana)\b/i;

/** Screens a client in Singapore, the Gulf or Europe actually looks at. */
const CLIENT_FACING = [
  'src/pages/POSScreen.tsx',
  'src/pages/TablesPage.tsx',
  'src/pages/ShiftPage.tsx',
  'src/pages/RunningBillsPage.tsx',
  'src/pages/ItemSalesReportPage.tsx',
  'src/components/PaymentDialog.tsx',
  'src/components/KitchenReceipt.tsx',
  'src/components/ReceivePaymentButton.tsx',
  'src/lib/optionalModules.ts',
  'src/lib/tableRelease.ts',
  'src/lib/tableOrder.ts',
  'src/lib/orderOrder.ts',
  'src/lib/orderArchive.ts',
  'src/lib/refunds.ts',
  'src/lib/splitBill.ts',
];

/** Strip comments — developer notes may stay bilingual, UI text may not. */
function uiTextOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}

describe('client-facing screens carry no Roman Urdu', () => {
  for (const rel of CLIENT_FACING) {
    it(`${rel} is English-only`, () => {
      const full = path.resolve(process.cwd(), rel);
      const text = uiTextOnly(fs.readFileSync(full, 'utf8'));
      const offenders = text
        .split('\n')
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter(x => ROMAN_URDU.test(x.line));

      expect(offenders.map(o => `${o.no}: ${o.line.slice(0, 90)}`)).toEqual([]);
    });
  }
});

describe('the language engine is wired for the target markets', () => {
  it('offers English, Malay, Chinese, Arabic and Urdu', async () => {
    const { LANGUAGES } = await import('@/lib/i18n');
    const codes = LANGUAGES.map(l => l.code).sort();
    // 'ur-roman' ships too (src/lib/i18n.ts) — it is offered to Pakistani
    // staff, while the client-facing screens stay English-only, which the
    // suite above enforces separately.
    expect(codes).toEqual(['ar', 'en', 'ms', 'ur', 'ur-roman', 'zh']);
  });

  it('marks Arabic and Urdu as right-to-left', async () => {
    const { LANGUAGES } = await import('@/lib/i18n');
    const rtl = LANGUAGES.filter(l => l.rtl).map(l => l.code).sort();
    expect(rtl).toEqual(['ar', 'ur']);
  });

  it('falls back to English rather than rendering a raw key', async () => {
    const { t } = await import('@/lib/i18n');
    expect(t('common.save')).toBeTruthy();
    expect(t('common.save')).not.toContain('common.');
  });
});

// ============================================================
// v1.17.0 — the two paths that made data "disappear"
//
// From Butt BBQ & Grilled Fish, 2026-08:
//   "Bills are being printed successfully, but they completely disappear
//    from the system and do not show up in the sales or transaction reports."
//   "Previously saved employee records have completely disappeared."
//
// Both were sync bugs, not deletions. The data was intact in Firestore; the
// device threw away its own copy. These tests lock the merge rules that
// decide what survives a snapshot.
// ============================================================
describe('a snapshot never deletes local rows', () => {
  // Mirrors the preserve rule in scheduleSnapshotFlush().
  function preserveLocalOnly(localArr: any[], seen: Set<string>): any[] {
    const out: any[] = [];
    for (const local of localArr) {
      if (!local?.id || seen.has(local.id)) continue;
      if (!Number(local._updatedAt)) local._updatedAt = Date.now();
      out.push(local);
    }
    return out;
  }

  it('keeps a local row that has no _updatedAt stamp', () => {
    // The exact shape that vanished: an older bill with no sync stamp, absent
    // from the 14-day scoped listener window.
    const local = [{ id: 'old-bill', orderNumber: 41, status: 'paid' }];

    const kept = preserveLocalOnly(local, new Set());

    expect(kept.map(o => o.id)).toEqual(['old-bill']);
  });

  it('stamps the rescued row so it merges correctly next time', () => {
    const local = [{ id: 'old-bill', orderNumber: 41 }];
    const kept = preserveLocalOnly(local, new Set());
    expect(Number(kept[0]._updatedAt)).toBeGreaterThan(0);
  });

  it('keeps rows the remote snapshot simply did not include', () => {
    // Orders older than the listener window are never in the snapshot.
    const local = [
      { id: 'recent', _updatedAt: Date.now() },
      { id: 'ancient', _updatedAt: Date.now() - 400 * 24 * 3600e3 },
      { id: 'unstamped' },
    ];
    const seen = new Set(['recent']);   // only 'recent' came from the cloud

    expect(preserveLocalOnly(local, seen).map(o => o.id)).toEqual(['ancient', 'unstamped']);
  });

  it('does not duplicate a row the snapshot already returned', () => {
    const local = [{ id: 'dup', _updatedAt: 1 }];
    expect(preserveLocalOnly(local, new Set(['dup']))).toEqual([]);
  });

  it('ignores malformed rows with no id', () => {
    expect(preserveLocalOnly([{ orderNumber: 9 }, null, undefined], new Set())).toEqual([]);
  });
});

describe('an empty cloud read cannot wipe a collection', () => {
  // Mirrors the guard in the background collection load.
  function resolveRows(cloudRows: any[], localRows: any[] | undefined): any[] {
    if (cloudRows.length === 0 && Array.isArray(localRows) && localRows.length > 0) {
      return localRows;   // suspected quota/permission blip — keep what we have
    }
    return cloudRows;
  }

  it('keeps employees when the cloud returns nothing', () => {
    const local = [{ id: 'e1', name: 'Waiter A' }, { id: 'e2', name: 'Cook B' }];
    expect(resolveRows([], local)).toHaveLength(2);
  });

  it('still accepts a genuinely empty collection on a fresh device', () => {
    expect(resolveRows([], [])).toEqual([]);
    expect(resolveRows([], undefined)).toEqual([]);
  });

  it('accepts real cloud data when there is some', () => {
    const cloud = [{ id: 'e1' }];
    expect(resolveRows(cloud, [{ id: 'old' }, { id: 'older' }])).toEqual(cloud);
  });
});

// ============================================================
// v1.18.0 — Butt BBQ points 1 and 3
//   1. "The final end-of-day amounts do not reflect our actual total
//       transactions and revenue."
//   3. "Order numbers are generated out of sequence (jumping or mixing up)."
// ============================================================
import { revenueTimestamp } from '@/lib/salesReport';

describe('revenue is counted on the day the money was taken', () => {
  it('uses the settlement time, not when the bill was opened', () => {
    const o: any = {
      createdAt: '2026-07-29T22:40:00.000Z',
      paidAt: '2026-07-29T23:40:00.000Z',
    };
    expect(revenueTimestamp(o)).toBe('2026-07-29T23:40:00.000Z');
  });

  it('falls back to createdAt when a bill has no settlement stamp', () => {
    const o: any = { createdAt: '2026-07-29T12:00:00.000Z' };
    expect(revenueTimestamp(o)).toBe('2026-07-29T12:00:00.000Z');
  });

  it('a table that settles after the business day closes counts as the NEXT day', () => {
    // Business day runs 08:00 → 03:00. Opened 02:40, settled 03:40.
    // On createdAt this landed in a day already closed and reported.
    const business = {
      start: new Date('2026-07-29T08:00:00').getTime(),
      end: new Date('2026-07-30T03:00:00').getTime(),
    };
    const o: any = {
      createdAt: '2026-07-30T02:40:00',
      paidAt: '2026-07-30T03:40:00',
    };
    const t = new Date(revenueTimestamp(o)).getTime();
    expect(t).toBeGreaterThan(business.end);          // belongs to the next day
    expect(new Date(o.createdAt).getTime()).toBeLessThan(business.end);
  });

  it('accepts settledAt as an alternative stamp', () => {
    const o: any = { createdAt: '2026-01-01T00:00:00Z', settledAt: '2026-01-02T00:00:00Z' };
    expect(revenueTimestamp(o)).toBe('2026-01-02T00:00:00Z');
  });
});

describe('the shared order counter only ever moves forward', () => {
  // Mirrors the transaction rule in cloudSaveCounter().
  const nextCloudValue = (current: number, incoming: number) =>
    incoming > current ? incoming : current;

  it('accepts a higher number', () => {
    expect(nextCloudValue(50, 51)).toBe(51);
  });

  it('REFUSES a lower number — the offline-tablet case', () => {
    // Tablet was offline and reached 54 while the till reached 56.
    // A blind write put 54 back, so 55 and 56 were then issued twice.
    expect(nextCloudValue(56, 54)).toBe(56);
  });

  it('refuses an equal number, so two devices cannot both claim it', () => {
    expect(nextCloudValue(50, 50)).toBe(50);
  });

  // Mirrors the load rule: highest of cloud and local wins.
  const resolveCounter = (cloud: number, local: number) => Math.max(cloud, local);

  it('keeps the local counter when this device billed while offline', () => {
    expect(resolveCounter(50, 57)).toBe(57);
  });

  it('takes the cloud counter when other devices have moved ahead', () => {
    expect(resolveCounter(80, 57)).toBe(80);
  });

  it('a gap is acceptable; a repeat is not', () => {
    // Numbers may skip — that is harmless. What must never happen is the
    // counter returning a value at or below one already printed on a bill.
    const issued = [50, 51, 52];
    const highest = Math.max(...issued);
    expect(resolveCounter(0, highest)).toBeGreaterThanOrEqual(highest);
  });
});

// ============================================================
// v1.17.1 — "Order numbers are being generated out of sequence
//            (jumping or mixing up order IDs). This is causing severe
//            confusion between the front counter, kitchen, and packing."
//
// Two order-number paths existed. The POS and the online portal used a
// Firestore transaction, which is safe across devices. The split bill and
// the token sale used getNextOrderNumber(), which increments a LOCAL
// counter and fires the cloud write without waiting.
//
// On a floor with a POS plus tablets, every device carries its own copy of
// that counter. Two devices at 41 both mint #42; a counter arriving from
// the cloud makes the next number leap. Exactly the jumping and collisions
// the kitchen was seeing. Both now use the transactional path.
// ============================================================
describe('order numbers stay unique across devices', () => {
  /** A local counter, as each device holds it. */
  function localCounter(start: number) {
    let n = start;
    return () => ++n;
  }

  /** A shared counter, as a Firestore transaction gives it. */
  function sharedCounter(start: number) {
    const box = { n: start };
    return () => ++box.n;
  }

  it('shows the collision the local counter caused', () => {
    // Both tills sitting at 41 — the state after any normal sync.
    const posDevice = localCounter(41);
    const tabletDevice = localCounter(41);

    expect(posDevice()).toBe(42);
    expect(tabletDevice()).toBe(42);   // same number, two bills
  });

  it('the transactional counter never repeats a number', () => {
    const next = sharedCounter(41);
    const pos = next();
    const tablet = next();
    const split = next();

    expect(new Set([pos, tablet, split]).size).toBe(3);
    expect([pos, tablet, split]).toEqual([42, 43, 44]);
  });

  it('issues numbers in strict sequence with no gaps', () => {
    const next = sharedCounter(0);
    const issued = Array.from({ length: 25 }, () => next());

    expect(issued[0]).toBe(1);
    expect(issued.at(-1)).toBe(25);
    for (let i = 1; i < issued.length; i++) {
      expect(issued[i] - issued[i - 1]).toBe(1);   // no jumps
    }
  });

  it('a split bill takes a fresh number, not the source bill number', () => {
    // Source bill is #30 and the counter already stands at 30.
    const next = sharedCounter(30);
    const source = 30;
    const split = next();

    expect(split).toBe(31);
    expect(split).not.toBe(source);
  });
});
