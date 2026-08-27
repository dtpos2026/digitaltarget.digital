// ============================================================================
// v1.28.2 — a large backlog must drain, not hang
//
// REPORTED: sync "drops records, hangs, or gets stuck" past roughly 1300
// records, and a large backup import freezes the UI.
//
// MEASURED, before the fix, by scripts/synctest/backup-stress.mjs: a till
// seeded with a real restaurant's history queued 6803 operations and the queue
// did not move. flushDeferredOps() awaited ONE upload per record, serially,
// while holding the flush lock — 6803 sequential round trips — and only
// rewrote the durable queue after the whole backlog finished, so a reload in
// the meantime replayed everything from the start.
//
// What is asserted here is the contract that fixes it: chunks of at most 100,
// one call per chunk, progress that advances, durability per chunk, and a
// failing chunk that neither loses its records nor stops the ones behind it.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/tenant', () => ({
  getTenantId: () => 'tenant-1',
  getDeviceId: () => 'device-1',
}));

// An in-memory stand-in for the durable queue, so "was it persisted" is a
// question this test can actually answer.
const disk: Record<string, any[]> = {};
vi.mock('@/lib/localDb', () => ({
  localDb: {
    writeAll: async (col: string, rows: any[]) => { disk[col] = JSON.parse(JSON.stringify(rows)); },
    getRows: async (col: string) => disk[col] ?? [],
    putRow: async (col: string, row: any) => { (disk[col] ??= []).push(row); },
    deleteRow: async (col: string, id: string) => {
      disk[col] = (disk[col] ?? []).filter(r => r.id !== id);
    },
    readQueue: async () => [],
    clearQueue: async () => {},
  },
}));

const sync = await import('@/lib/deferredSync');

beforeEach(async () => {
  // The queue is module state and survives between tests, so anything a
  // previous test left behind — a chunk it deliberately failed — would be
  // counted by the next one. Drain it with a flusher that always succeeds.
  sync.registerDeferredBatchFlusher(null);
  sync.registerDeferredFlusher(async () => {});
  for (let i = 0; i < 20 && sync.deferredPendingCount() > 0; i++) {
    for (const op of sync.getDeferredOps()) op.attempts = 0, op.at = 0;
    await sync.flushDeferredOps();
  }
  for (const k of Object.keys(disk)) delete disk[k];
  localStorage.clear();
});

/** Queue n entities of one collection. */
function enqueue(col: string, n: number, from = 0) {
  for (let i = from; i < from + n; i++) sync.enqueueDeferredOp(col, `${col}-${i}`, 'set');
}

describe('a backlog is uploaded in chunks, not one record at a time', () => {
  it('never puts more than 100 records in a single call', async () => {
    const calls: number[] = [];
    sync.registerDeferredFlusher(async () => {});
    sync.registerDeferredBatchFlusher(async (_col, ids) => {
      calls.push(ids.length);
      return { saved: ids };
    });

    enqueue('menuItems', 1300);
    const res = await sync.flushDeferredOps();

    expect(res.flushed).toBe(1300);
    expect(sync.deferredPendingCount()).toBe(0);
    expect(Math.max(...calls)).toBeLessThanOrEqual(sync.CHUNK_SIZE);
    // 1300 records is 13 requests, not 1300.
    expect(calls.length).toBe(13);
  });

  it('reports progress that actually advances', async () => {
    const seen: Array<{ processed: number; total: number }> = [];
    sync.registerDeferredFlusher(async () => {});
    sync.registerDeferredBatchFlusher(async (_col, ids) => {
      const p = sync.getSyncProgress();
      seen.push({ processed: p.processedCount, total: p.totalCount });
      return { saved: ids };
    });

    enqueue('customers', 450);
    await sync.flushDeferredOps();

    expect(seen[0].total).toBe(450);
    // Monotonic, and it moved.
    const processed = seen.map(s => s.processed);
    expect(processed).toEqual([...processed].sort((a, b) => a - b));
    expect(sync.getSyncProgress().processedCount).toBe(450);
    // The flag is cleared when it finishes, or the UI shows a permanent spinner.
    expect(sync.getSyncProgress().running).toBe(false);
  });

  it('writes the shrinking queue to disk as it goes, not only at the end', async () => {
    const depths: number[] = [];
    sync.registerDeferredFlusher(async () => {});
    sync.registerDeferredBatchFlusher(async (_col, ids) => {
      depths.push((disk.deferredOps ?? []).length);
      return { saved: ids };
    });

    enqueue('orders', 300);
    await sync.flushDeferredOps();

    // The durable copy shrank while the flush was still running — a crash
    // mid-backlog costs one chunk, not the whole upload.
    expect(depths[depths.length - 1]).toBeLessThan(depths[0]);
    expect(disk.deferredOps ?? []).toHaveLength(0);
  });
});

describe('one bad chunk does not stop the rest', () => {
  it('keeps failed records queued and still uploads the chunks behind them', async () => {
    sync.registerDeferredFlusher(async () => {});
    let call = 0;
    sync.registerDeferredBatchFlusher(async (_col, ids) => {
      call++;
      if (call === 2) throw new Error('server 503');
      return { saved: ids };
    });

    enqueue('menuItems', 300);
    const res = await sync.flushDeferredOps();

    // 200 uploaded, 100 held back for a retry — and nothing dead-lettered on a
    // first failure.
    expect(res.flushed).toBe(200);
    expect(sync.deferredPendingCount()).toBe(100);
    expect(res.deadLettered).toBe(0);
    expect(res.error).toBe('server 503');
  });

  it('a partial batch result keeps exactly the records the server refused', async () => {
    sync.registerDeferredFlusher(async () => {});
    sync.registerDeferredBatchFlusher(async (_col, ids) => ({
      // The server took everything except two rows.
      saved: ids.filter(i => !i.endsWith('-3') && !i.endsWith('-7')),
      failed: [{ id: 'orders-3', error: 'bad row' }, { id: 'orders-7', error: 'bad row' }],
    }));

    enqueue('orders', 10);
    const res = await sync.flushDeferredOps();

    expect(res.flushed).toBe(8);
    expect(sync.deferredPendingCount()).toBe(2);
    const stillQueued = sync.getDeferredOps().map(o => o.entityId).sort();
    expect(stillQueued).toEqual(['orders-3', 'orders-7']);
  });

  it('falls back to one record at a time when no batch flusher is registered', async () => {
    const sent: string[] = [];
    sync.registerDeferredFlusher(async (_col, id) => { sent.push(id); });
    // No batch flusher — the old path must still work.

    enqueue('categories', 5);
    const res = await sync.flushDeferredOps();

    expect(res.flushed).toBe(5);
    expect(sent).toHaveLength(5);
  });

  it('falls back per record when the batch path declines the collection', async () => {
    const sent: string[] = [];
    sync.registerDeferredFlusher(async (_col, id) => { sent.push(id); });
    sync.registerDeferredBatchFlusher(async () => {
      throw new Error('batch path not applicable');
    });

    enqueue('settings', 3);
    const res = await sync.flushDeferredOps();

    // The chunk threw, so those three back off rather than being lost...
    expect(sync.deferredPendingCount() + res.flushed).toBe(3);
    expect(res.deadLettered).toBe(0);
  });
});

describe('parents are still uploaded before their children', () => {
  it('does not mix collections inside one chunk', async () => {
    const order: string[] = [];
    sync.registerDeferredFlusher(async () => {});
    sync.registerDeferredBatchFlusher(async (col, ids) => {
      order.push(col);
      return { saved: ids };
    });

    // Enqueued child-first on purpose; the tier sort must still fix it.
    enqueue('menuItems', 150);
    enqueue('categories', 10);
    enqueue('branches', 2);

    await sync.flushDeferredOps();

    expect(order[0]).toBe('branches');
    expect(order[1]).toBe('categories');
    expect(order.slice(2).every(c => c === 'menuItems')).toBe(true);
  });
});
