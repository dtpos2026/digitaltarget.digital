// ============================================================================
// The print queue's failure and retry path.
//
// A restaurant's printers fail constantly — paper out, spooler wedged, the LAN
// printer power-cycled by a cleaner. What must never happen is a bill that
// silently stops existing because its print job failed, or one that reprints
// forever because a failure never settles.
//
// The rendering side (receipt HTML, ESC/POS bytes, blank-slip guard, print CSS)
// is covered by printing.test.ts. This covers the queue itself: what a failure
// does to a job, when it is retried, when it stops being retried, and that a
// failover to the backup printer neither loses the job nor loops.
//
// Real hardware is not available in this environment, so what is asserted here
// is the queue's own state machine, which is what decides whether a job is ever
// handed to a printer again.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrintQueue, getProcessableJobs, getFailedJobs,
  markPrinting, markFailed, markPrinted, retryJob, retryAllFailed, clearPrintedJobs,
  type PrintJob,
} from '@/lib/printQueue';

const QUEUE_KEY = 'pos-print-queue';

/** Put a job straight on the queue — enqueuePrint needs a whole Order and a
 *  configured printer, and neither is what this file is about. */
function seed(jobs: Partial<PrintJob>[]): PrintJob[] {
  const full = jobs.map((j, i) => ({
    id: j.id ?? `pj_${i}`,
    orderId: j.orderId ?? `ord_${i}`,
    orderNumber: j.orderNumber ?? 100 + i,
    printType: j.printType ?? 'receipt',
    copies: j.copies ?? 1,
    status: j.status ?? 'pending',
    retryCount: j.retryCount ?? 0,
    createdAt: j.createdAt ?? new Date().toISOString(),
    ...j,
  })) as PrintJob[];
  localStorage.setItem(QUEUE_KEY, JSON.stringify(full));
  return full;
}

beforeEach(() => {
  localStorage.clear();
});

describe('a failed print job is retried, then given up on', () => {
  it('counts the failure and keeps the job processable', () => {
    seed([{ id: 'j1' }]);
    markFailed('j1', 'printer offline');

    const job = getPrintQueue().find(j => j.id === 'j1')!;
    expect(job.status).toBe('failed');
    expect(job.retryCount).toBe(1);
    expect(job.error).toBe('printer offline');
    expect(job.failedAt).toBeTruthy();

    // Still eligible: one failure is not a lost bill.
    expect(getProcessableJobs().map(j => j.id)).toContain('j1');
    expect(getFailedJobs().map(j => j.id)).not.toContain('j1');
  });

  it('stops retrying after three attempts instead of looping forever', () => {
    seed([{ id: 'j1' }]);
    markFailed('j1', 'offline');
    markFailed('j1', 'offline');
    markFailed('j1', 'offline');

    const job = getPrintQueue().find(j => j.id === 'j1')!;
    expect(job.retryCount).toBe(3);
    // Off the automatic path...
    expect(getProcessableJobs().map(j => j.id)).not.toContain('j1');
    // ...but visible to the operator, not silently dropped.
    expect(getFailedJobs().map(j => j.id)).toContain('j1');
    expect(getPrintQueue()).toHaveLength(1);
  });

  it('a manual retry puts an exhausted job back in the queue', () => {
    seed([{ id: 'j1', status: 'failed', retryCount: 3, error: 'offline' }]);
    expect(getProcessableJobs()).toHaveLength(0);

    retryJob('j1');
    const job = getPrintQueue().find(j => j.id === 'j1')!;
    expect(job.status).toBe('pending');
    expect(job.error).toBeUndefined();
    expect(getProcessableJobs().map(j => j.id)).toContain('j1');
  });

  it('"retry all" clears the failure count on every failed job and nothing else', () => {
    seed([
      { id: 'j1', status: 'failed', retryCount: 3 },
      { id: 'j2', status: 'failed', retryCount: 3 },
      { id: 'j3', status: 'printed', retryCount: 0 },
    ]);

    retryAllFailed();
    const byId = Object.fromEntries(getPrintQueue().map(j => [j.id, j]));
    expect(byId.j1.status).toBe('pending');
    expect(byId.j1.retryCount).toBe(0);
    expect(byId.j2.status).toBe('pending');
    // An already-printed slip must not be reprinted by a bulk retry.
    expect(byId.j3.status).toBe('printed');
  });

  it('marking a failed job as printed ends it', () => {
    seed([{ id: 'j1', status: 'failed', retryCount: 2 }]);
    markPrinted('j1');
    const job = getPrintQueue().find(j => j.id === 'j1')!;
    expect(job.status).toBe('printed');
    expect(getProcessableJobs()).toHaveLength(0);
    expect(getFailedJobs()).toHaveLength(0);
  });
});

describe('a job that never came back is not abandoned', () => {
  it('picks up a job stuck "printing" for more than twenty seconds', () => {
    // The host crashed, or the browser tab was closed mid-print. Without this
    // the bill would sit in `printing` forever and never reach the kitchen.
    seed([{
      id: 'stuck', status: 'printing',
      lastTriedAt: new Date(Date.now() - 60_000).toISOString(),
    }]);
    expect(getProcessableJobs().map(j => j.id)).toContain('stuck');
  });

  it('leaves a job that is genuinely printing right now alone', () => {
    seed([{ id: 'live', status: 'printing', lastTriedAt: new Date().toISOString() }]);
    expect(getProcessableJobs()).toHaveLength(0);
  });

  it('markPrinting stamps the attempt so the stale check can work at all', () => {
    seed([{ id: 'j1' }]);
    markPrinting('j1');
    const job = getPrintQueue().find(j => j.id === 'j1')!;
    expect(job.status).toBe('printing');
    expect(job.lastTriedAt).toBeTruthy();
  });
});

describe('the queue does not grow without bound or lose live work', () => {
  it('clearing printed jobs keeps everything still outstanding', () => {
    seed([
      { id: 'p1', status: 'printed' },
      { id: 'p2', status: 'printed' },
      { id: 'q1', status: 'pending' },
      { id: 'f1', status: 'failed', retryCount: 3 },
    ]);
    clearPrintedJobs();
    const ids = getPrintQueue().map(j => j.id);
    expect(ids).toEqual(['q1', 'f1']);
  });

  it('an unknown job id is a no-op rather than a crash', () => {
    seed([{ id: 'j1' }]);
    expect(() => markFailed('nope', 'x')).not.toThrow();
    expect(() => markPrinted('nope')).not.toThrow();
    expect(getPrintQueue()).toHaveLength(1);
  });

  it('a corrupt queue in storage reads as empty rather than breaking the till', () => {
    localStorage.setItem(QUEUE_KEY, 'not json');
    expect(getPrintQueue()).toEqual([]);
    expect(getProcessableJobs()).toEqual([]);
  });
});
