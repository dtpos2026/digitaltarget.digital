// ============================================================
// Printer brand auto-detect presets.
// Matches Windows printer names to known thermal-printer families
// and returns the safest starting profile (paper size + print mode).
// Used by PrinterSettingsPanel when the user adds/detects a printer.
// ============================================================
import type { PrinterConfig } from './printerSettings';

export interface PrinterBrandPreset {
  brand: string;
  match: RegExp;
  paperSize: '58mm' | '80mm';
  fallbackMode: NonNullable<PrinterConfig['fallbackMode']>;
  escposMode: boolean;
  notes: string;
}

export const PRINTER_PRESETS: PrinterBrandPreset[] = [
  { brand: 'BIXOLON',      match: /\b(bixolon|srp[- ]?[a-z0-9]+)\b/i,       paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Windows Driver mode — driver default page size (fixes 5–6" blank feed).' },
  { brand: 'Epson TM',     match: /\b(epson|tm[- ]?[a-z0-9]+|t20|t82|t88)\b/i, paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Epson TM series — official ESC/POS driver.' },
  { brand: 'Xprinter',     match: /\b(xprinter|xp[- ]?[a-z0-9]+)\b/i,      paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Xprinter 80mm — Windows driver stable.' },
  { brand: 'Black Copper', match: /\b(black[- ]?copper|bc[- ]?[a-z0-9]+)\b/i, paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Black Copper 80mm — Windows driver stable.' },
  { brand: 'Rongta',       match: /\b(rongta|rp[- ]?[a-z0-9]+)\b/i,        paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Rongta 80mm — Windows driver.' },
  { brand: 'SPRT / SpeedX',match: /\b(sprt|speedx|sp[- ]?[a-z0-9]+)\b/i,   paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'SPRT / SpeedX 80mm.' },
  { brand: 'Fujitsu',      match: /\b(fujitsu|fp[- ]?[a-z0-9]+)\b/i,       paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Fujitsu FP series — Windows driver.' },
  { brand: 'HPRT',         match: /\b(hprt|tp[- ]?[a-z0-9]+)\b/i,          paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'HPRT thermal.' },
  { brand: 'Star Micronics',match: /\b(star|tsp[- ]?[a-z0-9]+|sp[57]00)\b/i, paperSize: '80mm', fallbackMode: 'html', escposMode: false, notes: 'Star TSP — Windows driver.' },
  { brand: 'Citizen',      match: /\b(citizen|ct[- ]?s[0-9]+)\b/i,          paperSize: '80mm', fallbackMode: 'html',   escposMode: false, notes: 'Citizen CT-S — Windows driver.' },
  { brand: 'Generic 58mm', match: /\b(58 ?mm|pos[- ]?58)\b/i,               paperSize: '58mm', fallbackMode: 'text',   escposMode: false, notes: 'Generic 58mm — text fallback for stubborn drivers.' },
  { brand: 'Generic 80mm', match: /\b(80 ?mm|pos[- ]?80|generic|thermal|receipt)\b/i, paperSize: '80mm', fallbackMode: 'html', escposMode: false, notes: 'Generic 80mm — HTML render via Windows driver.' },
];

/** Detect brand from a Windows printer name + driver string. Returns null if unknown. */
export function detectPrinterBrand(name: string, driver?: string): PrinterBrandPreset | null {
  const hay = `${name || ''} ${driver || ''}`.toLowerCase();
  for (const p of PRINTER_PRESETS) {
    if (p.match.test(hay)) return p;
  }
  return null;
}

/** Apply a preset onto a printer config in-place (returns a new object). */
export function applyPreset(cfg: PrinterConfig, preset: PrinterBrandPreset): PrinterConfig {
  return {
    ...cfg,
    paperSize: preset.paperSize,
    fallbackMode: preset.fallbackMode,
    escposMode: preset.escposMode,
  };
}