// ============================================================
// PER-SLIP MARGINS — the "inherit by default" lock.
//
// The printing geometry is working on real paper. This module must therefore
// change NOTHING until a shop deliberately types a number: every field
// defaults to inherit, and an untouched installation resolves to exactly the
// printer calibration and device defaults it used before.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSlipMargins, saveSlipMargins, resolveSlipMargin, slipMargin, SLIP_KINDS,
} from '@/lib/slipMargins';

describe('nothing is applied until a shop sets it', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(loadSlipMargins()).toEqual({});
    for (const { kind } of SLIP_KINDS) expect(slipMargin(kind)).toEqual({});
  });

  it('falls straight through to the printer, then the device', () => {
    // printer 3/4, device 1/1 -> printer wins, exactly as before this module.
    const r = resolveSlipMargin('kot', 3, 4, 1, 1);
    expect(r.left).toBe(3);
    expect(r.right).toBe(4);
    expect(r.overridden).toBe(false);
  });

  it('uses the device value when the printer has none', () => {
    const r = resolveSlipMargin('receipt', undefined, undefined, 2, 2);
    expect(r.left).toBe(2);
    expect(r.right).toBe(2);
  });
});

describe('a KOT can carry its own right margin', () => {
  beforeEach(() => localStorage.clear());

  it('overrides only the side that was set', () => {
    // The reported need: nudge the KOT's right edge for the cutter, leave
    // everything else exactly as it is.
    saveSlipMargins({ kot: { right: 3 } });

    const kot = resolveSlipMargin('kot', 1, 1, 0, 0);
    expect(kot.right).toBe(3);
    expect(kot.left).toBe(1);        // still the printer's own value
    expect(kot.overridden).toBe(true);
  });

  it('leaves the other slip kinds untouched', () => {
    saveSlipMargins({ kot: { right: 3 } });
    for (const kind of ['receipt', 'token', 'report'] as const) {
      const r = resolveSlipMargin(kind, 1, 1, 0, 0);
      expect(r.right, `${kind} was affected by the KOT setting`).toBe(1);
      expect(r.overridden).toBe(false);
    }
  });
});

describe('stored values are kept sane', () => {
  beforeEach(() => localStorage.clear());

  it('clamps to the same range the layout accepts', () => {
    saveSlipMargins({ kot: { left: -5, right: 999 } });
    const m = slipMargin('kot');
    expect(m.left).toBe(0);
    expect(m.right).toBe(20);
  });

  it('drops an entry that sets neither side', () => {
    saveSlipMargins({ kot: {}, receipt: { right: 2 } });
    const all = loadSlipMargins();
    expect(all.kot).toBeUndefined();
    expect(all.receipt?.right).toBe(2);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('dtpos-slip-margins-v1', '{not json');
    expect(loadSlipMargins()).toEqual({});
  });
});
