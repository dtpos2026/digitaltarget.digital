// ============================================================================
// v1.65.0 — a poll that stops when nobody is looking
//
// Running Bills, Pending Payments, Pickup Orders and the Rider App each keep a
// cloud pull on a timer. A till with three of them open in three tabs polled
// all three all day; two were never on screen. startVisiblePoll keeps the
// interval while the tab is visible, skips it while hidden, and refreshes the
// moment the tab returns — so nobody ever looks at a stale screen.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { startVisiblePoll } from '@/lib/visiblePoll';

let state: 'visible' | 'hidden' = 'visible';
function setVisibility(v: 'visible' | 'hidden') {
  state = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  state = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe('startVisiblePoll', () => {
  it('ticks on its interval while the tab is visible — behaviour unchanged', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    vi.advanceTimersByTime(35_000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does NOT call the function on start — callers do their own first pull', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('skips every tick while the tab is hidden', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(120_000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('refreshes immediately when the tab comes back, not at the next tick', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    setVisibility('hidden');
    vi.advanceTimersByTime(60_000);
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a hide event itself does not fire a pull', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    setVisibility('hidden');
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('cleanup stops the timer AND the visibility listener', () => {
    const fn = vi.fn();
    const stop = startVisiblePoll(fn, 10_000);
    stop();
    vi.advanceTimersByTime(60_000);
    setVisibility('hidden');
    setVisibility('visible');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('the four screens use it', () => {
  // A wiring guard, kept deliberately narrow: the behaviour is proved above,
  // this only stops a screen quietly going back to a bare setInterval pull.
  const pages: Array<[string, RegExp]> = [
    ['RunningBillsPage', /startVisiblePoll\(pull, 10000\)/],
    ['PendingPaymentsPage', /startVisiblePoll\(pull, 10000\)/],
    ['PickupOrdersPage', /startVisiblePoll\(pull, 8000\)/],
    ['RiderAppPage', /startVisiblePoll\(pull, 15000\)/],
  ];
  for (const [name, re] of pages) {
    it(`${name} polls through startVisiblePoll, at its original interval`, () => {
      const src = readFileSync(`src/pages/${name}.tsx`, 'utf8');
      expect(src).toMatch(re);
      expect(src).not.toMatch(/setInterval\(pull,/);
    });
  }
});
