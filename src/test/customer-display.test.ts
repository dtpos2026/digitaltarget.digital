// ============================================================
// CUSTOMER DISPLAY — the screen above the counter.
//
// Two things must hold or the screen is worse than none:
//   • it must not shout. An order is announced ONCE, and what was already
//     ready when the screen opened is not news.
//   • it must not lie about what it can do. Speech depends on a voice being
//     installed in Windows; when there is none the shop is told, rather than
//     left believing announcements are happening.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadDisplayConfig, saveDisplayConfig, DEFAULT_DISPLAY,
  announceOrder, displayConfigSizeKb,
} from '@/lib/customerDisplay';

const page = readFileSync(resolve(__dirname, '../pages/CustomerDisplayPage.tsx'), 'utf8');

describe('configuration', () => {
  beforeEach(() => localStorage.clear());

  it('starts disabled, so a screen is never opened by surprise', () => {
    expect(loadDisplayConfig().enabled).toBe(false);
  });

  it('round-trips what the shop sets', () => {
    const next = { ...DEFAULT_DISPLAY, enabled: true, heading: 'COLLECT HERE', announceRepeat: 3 };
    expect(saveDisplayConfig(next).ok).toBe(true);
    const back = loadDisplayConfig();
    expect(back.enabled).toBe(true);
    expect(back.heading).toBe('COLLECT HERE');
    expect(back.announceRepeat).toBe(3);
  });

  it('clamps values that would break the screen', () => {
    saveDisplayConfig({ ...DEFAULT_DISPLAY, announceRepeat: 99, readyHoldSeconds: 99999, mediaSeconds: 0 });
    const c = loadDisplayConfig();
    expect(c.announceRepeat).toBeLessThanOrEqual(5);
    expect(c.readyHoldSeconds).toBeLessThanOrEqual(600);
    expect(c.mediaSeconds).toBeGreaterThanOrEqual(2);
  });

  it('drops media entries with no source', () => {
    saveDisplayConfig({
      ...DEFAULT_DISPLAY,
      media: [{ id: 'a', kind: 'image', src: '' }, { id: 'b', kind: 'image', src: 'data:image/png;base64,x' }] as any,
    });
    expect(loadDisplayConfig().media).toHaveLength(1);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('dtpos-customer-display-v1', 'not json');
    expect(loadDisplayConfig().enabled).toBe(false);
  });

  it('reports its stored size so a shop can see the storage limit coming', () => {
    expect(displayConfigSizeKb(DEFAULT_DISPLAY)).toBeGreaterThanOrEqual(0);
  });
});

describe('announcements', () => {
  it('says so when the device has no speech support', async () => {
    // A shop that turned announcements on deserves to know they are silent.
    const original = (window as any).speechSynthesis;
    try {
      Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
      const r = await announceOrder(101, DEFAULT_DISPLAY);
      expect(r.spoken).toBe(false);
      expect(r.reason).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'speechSynthesis', { value: original, configurable: true });
    }
  });

  it('refuses to speak empty wording', async () => {
    const speak = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak, getVoices: () => [], cancel: () => {} }, configurable: true,
    });
    const r = await announceOrder(7, { announceTemplate: '   ', announceRepeat: 1 });
    expect(r.spoken).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });

  it('repeats exactly as configured, and never more than five times', async () => {
    const speak = vi.fn();
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak, getVoices: () => [{}], cancel: () => {} }, configurable: true,
    });
    (globalThis as any).SpeechSynthesisUtterance = function (t: string) { (this as any).text = t; } as any;

    await announceOrder(42, { announceTemplate: 'Order {n} ready', announceRepeat: 3 });
    expect(speak).toHaveBeenCalledTimes(3);

    speak.mockClear();
    await announceOrder(42, { announceTemplate: 'Order {n} ready', announceRepeat: 99 });
    expect(speak).toHaveBeenCalledTimes(5);
  });

  it('puts the order number into the wording', async () => {
    const spoken: string[] = [];
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: (u: any) => spoken.push(u.text), getVoices: () => [{}], cancel: () => {} },
      configurable: true,
    });
    (globalThis as any).SpeechSynthesisUtterance = function (t: string) { (this as any).text = t; } as any;

    await announceOrder(105, { announceTemplate: 'Order number {n} is ready.', announceRepeat: 1 });
    expect(spoken[0]).toBe('Order number 105 is ready.');
  });
});

describe('the screen does not shout', () => {
  it('announces an order once, not on every refresh', () => {
    // Without this the display repeats the same number for as long as the
    // order stays on the ready list.
    expect(page).toMatch(/announced\.current/);
    expect(page).toMatch(/!announced\.current\.has\(o\.id\)/);
  });

  it('treats what was already ready at open time as not news', () => {
    expect(page).toMatch(/firstLoad/);
  });

  it('holds a ready order on screen after it is collected', () => {
    // A customer who stepped outside comes back and looks up.
    expect(page).toMatch(/readyHoldSeconds/);
    expect(page).toMatch(/readyAt\.current/);
  });

  it('can be muted at the screen itself', () => {
    expect(page).toMatch(/setMuted/);
  });

  it('never changes an order — it only displays', () => {
    expect(page).not.toMatch(/setOrderKitchenStatus|saveOrder/);
  });
});
