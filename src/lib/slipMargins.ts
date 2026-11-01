// ============================================================
// PER-SLIP MARGINS — one set of numbers per KIND of slip.
//
// Why this is separate from printMargins.ts
// -----------------------------------------
// `printMargins` is per DEVICE and `PrinterConfig` is per PRINTER. Neither
// can express "the KOT needs 3mm on the right but the customer bill does
// not" — and that is a real need, because the slips are cut and handled
// differently. A KOT is torn off and spiked; a bill is handed to a customer;
// a token goes in a pocket. The right margin that makes a KOT sit square on
// the spike is not the one that centres a bill.
//
// Resolution order, most specific first:
//
//   1. this slip type's own margin, when the shop has set one
//   2. the printer's own calibration (PrinterConfig.left/rightMarginMm)
//   3. the device's Printer Settings margins
//
// EVERY TYPE DEFAULTS TO "INHERIT". An untouched installation therefore
// behaves exactly as it did before this module existed — nothing is applied
// until someone deliberately sets a number. That is deliberate: the printing
// geometry is working now and must not shift underneath anyone.
//
// Device-local, like the other print settings: one counter's paper and
// cutter are not another's, so these must not sync between machines.
// ============================================================

export type SlipKind = 'receipt' | 'kot' | 'token' | 'report';

export interface SlipMargin {
  /** Left margin in mm, or undefined to inherit. */
  left?: number;
  /** Right margin in mm, or undefined to inherit. */
  right?: number;
}

export type SlipMarginMap = Partial<Record<SlipKind, SlipMargin>>;

export const SLIP_KINDS: Array<{ kind: SlipKind; label: string; hint: string }> = [
  { kind: 'receipt', label: 'Customer Receipt', hint: 'The bill handed to the customer.' },
  { kind: 'kot', label: 'KOT (Kitchen)', hint: 'Torn off and spiked in the kitchen — often needs its own right margin.' },
  { kind: 'token', label: 'Token Receipt', hint: 'Department and counter tokens.' },
  { kind: 'report', label: 'Reports (POS / ATM / Shift)', hint: 'Shift reports and printed summaries.' },
];

const KEY = 'dtpos-slip-margins-v1';

/** Largest side margin worth honouring, matching receiptLayout's own clamp. */
const MAX_MM = 20;

function clean(n: unknown): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(MAX_MM, Math.round(v * 10) / 10));
}

export function loadSlipMargins(): SlipMarginMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) || {};
    const out: SlipMarginMap = {};
    for (const { kind } of SLIP_KINDS) {
      const m = parsed[kind];
      if (!m) continue;
      const left = clean(m.left);
      const right = clean(m.right);
      if (left !== undefined || right !== undefined) out[kind] = { left, right };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSlipMargins(map: SlipMarginMap): void {
  const safe: SlipMarginMap = {};
  for (const { kind } of SLIP_KINDS) {
    const m = map[kind];
    if (!m) continue;
    const left = clean(m.left);
    const right = clean(m.right);
    if (left !== undefined || right !== undefined) safe[kind] = { left, right };
  }
  try { localStorage.setItem(KEY, JSON.stringify(safe)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent('dtpos-slip-margins-changed', { detail: safe })); } catch { /* no window */ }
}

/** The stored override for one slip kind, or an empty object. */
export function slipMargin(kind: SlipKind): SlipMargin {
  return loadSlipMargins()[kind] || {};
}

export interface ResolvedSlipMargin {
  left?: number;
  right?: number;
  /** True when this slip kind carries its own numbers. */
  overridden: boolean;
}

/**
 * Resolve the margins for one slip, most specific source first.
 *
 * `printerLeft`/`printerRight` are the printer's own calibration and
 * `deviceLeft`/`deviceRight` the device defaults. Anything the slip kind does
 * not set falls straight through to them, so a shop that only wants to nudge
 * the KOT's right edge changes exactly that and nothing else.
 */
export function resolveSlipMargin(
  kind: SlipKind,
  printerLeft?: number,
  printerRight?: number,
  deviceLeft?: number,
  deviceRight?: number,
): ResolvedSlipMargin {
  const own = slipMargin(kind);
  const left = own.left ?? printerLeft ?? deviceLeft;
  const right = own.right ?? printerRight ?? deviceRight;
  return {
    left,
    right,
    overridden: own.left !== undefined || own.right !== undefined,
  };
}
