// ============================================================
// THERMAL REPORT — one professional 80 mm layout for every report slip:
// POS Summary / Detailed, Shift, Goods Receiving (supplier), Accounts…
//
// WHY THIS EXISTS (the clipping bug)
// ----------------------------------
// The POS Summary, the POS Detailed report and the GRN slip were printed from
// a plain browser window sized to the PAPER width (80 mm). An 80 mm printer
// can only print about 72 mm of it, so everything laid out against the right
// edge — "PKR 12,345", the time, every right-aligned value — fell off the
// paper, and the left edge sat on the head's first dots. The shift report
// looked right because it went through printNode, which lays the slip out at
// the printer's real content width (printable width minus margins).
//
// So every report now goes through the same path as the shift report:
//   • laid out at the content width the printer settings resolve (fast
//     window / raster, or the driver),
//   • margins from Printer Settings → report slip margins,
//   • the text-mode (Fast Billing ESC/POS) path when the shop uses it,
// and every row is built to FIT: a long label wraps onto a second line, the
// value never leaves the paper, nothing is cut off. Fonts are not shrunk to
// make things fit — the layout is.
// ============================================================
import { getSettings } from '@/lib/store';
import { printNode } from '@/printing';
import { loadPrinterSettings, resolvePrinterForRole } from '@/lib/printerSettings';
import { wantsRaw } from '@/printing/printMode';
import { resolveSlipMargin } from '@/lib/slipMargins';
import { getDeviceId } from '@/lib/tenant';

export type ReportBlock =
  | { kind: 'section'; title: string }
  | { kind: 'row'; label: string; value: string; bold?: boolean; big?: boolean }
  | { kind: 'table'; head: string[]; rows: string[][]; foot?: string[] }
  | { kind: 'total'; label: string; value: string }
  | { kind: 'entry'; title: string; value: string; lines: string[] }
  | { kind: 'note'; text: string; center?: boolean }
  | { kind: 'rule'; style?: 'dashed' | 'solid' | 'double' };

export interface ThermalReportDoc {
  /** Printed in the title band, e.g. "SALES SUMMARY". */
  title: string;
  /** Label/value pairs under the title: period, staff, supplier… */
  meta?: Array<[string, string]>;
  blocks: ReportBlock[];
  /** Shop's own footer text (marketing footer), optional. */
  footer?: string;
  /** Hide the restaurant header (logo/name/address) — rarely wanted. */
  noHeader?: boolean;
}

// ---------- formatting ----------
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** "Rs 12,345" / "Rs 12,345.50" — grouped, no pointless ".00", never split. */
export function reportMoney(n: number, sym?: string): string {
  const s = (sym ?? currencySymbol()).trim();
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${s ? `${s}\u00a0` : ''}${body}`;
}

export function currencySymbol(): string {
  try { return String((getSettings() as any).currencySymbol || 'Rs').trim(); } catch { return 'Rs'; }
}

/** 23 Sep 2026, 14:05 — short enough to sit beside its label on 80 mm. */
export function reportTime(d: Date | number | string = new Date()): string {
  const t = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(t.getTime())) return '-';
  return t.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ---------- HTML ----------
/*
 * Sizing is in px at 96 dpi on a document the print path lays out at the
 * CONTENT width (≈ 64–70 mm = 242–265 px on 80 mm paper). Rows are flex with a
 * shrinkable label (min-width:0 + overflow-wrap) and a value that keeps its
 * natural width — so labels wrap and values stay whole and on the paper.
 */
const CSS = `
.dtr{width:100%;max-width:100%;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;font-size:12.5px;line-height:1.3;font-weight:700;-webkit-font-smoothing:none;text-rendering:geometricPrecision;overflow-wrap:anywhere;word-break:normal}
.dtr *{box-sizing:border-box;color:#000}
.dtr-c{text-align:center}
.dtr-logo{display:block;margin:0 auto 4px;max-width:70%;object-fit:contain}
.dtr-name{font-size:17px;font-weight:900;line-height:1.15;text-align:center;letter-spacing:.2px}
.dtr-sub{font-size:11px;font-weight:700;text-align:center;line-height:1.25}
.dtr-title{margin:6px 0 5px;padding:3px 0;border-top:2px solid #000;border-bottom:2px solid #000;text-align:center;font-size:14px;font-weight:900;letter-spacing:.6px;text-transform:uppercase}
.dtr-meta{font-size:11.5px;margin-bottom:2px}
.dtr-row{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:1px 0}
.dtr-row>.l{flex:1 1 0%;min-width:34%}
.dtr-row>.v{flex:0 1 auto;min-width:0;text-align:right}
.dtr-row.b{font-weight:900}
.dtr-row.big{font-size:14px;font-weight:900}
.dtr-sec{margin:8px 0 3px;padding-bottom:1px;border-bottom:1.5px solid #000;font-size:12.5px;font-weight:900;text-transform:uppercase;letter-spacing:.4px}
.dtr-tbl{display:grid;column-gap:6px;row-gap:1px;align-items:start}
.dtr-tbl>span{min-width:0}
.dtr-tbl>.n{text-align:right;white-space:nowrap}
.dtr-tbl>.h{font-weight:900;font-size:11.5px}
.dtr-tbl>.f{font-weight:900}
.dtr-tbl>.sep{grid-column:1/-1;border-top:1px dashed #000;margin:1px 0}
.dtr-tbl>.sep.s{border-top:1.5px solid #000;margin:2px 0 1px}
.dtr-total{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin:6px 0 2px;padding:4px 5px;border:2px solid #000;font-size:15px;font-weight:900}
.dtr-total>.l{flex:1 1 0%;min-width:30%}
.dtr-total>.v{flex:0 1 auto;min-width:0;text-align:right}
.dtr-entry{padding:3px 0;border-bottom:1px dotted #000}
.dtr-entry .s{font-size:11px;font-weight:700;line-height:1.25}
.dtr-note{font-size:11px;font-weight:700;margin:2px 0}
.dtr-rule{margin:5px 0;border-top:1px dashed #000}
.dtr-rule.solid{border-top:1.5px solid #000}
.dtr-rule.double{border-top:3px double #000}
.dtr-foot{margin-top:6px;padding-top:4px;border-top:1px dashed #000}
.dtr-credit{margin-top:4px;text-align:center;font-size:9.5px;font-weight:600}
.dtr-mkt{margin-top:4px;text-align:center;font-size:10.5px;white-space:pre-line}
`;

/*
 * Label and value: the value keeps its natural width and the label takes
 * what is left, wrapping when it must — but the label always keeps at least
 * a third of the line, so a long value (an item or supplier name) wraps
 * instead of crushing it. (Done with min-width, not max-width: the shared
 * print stylesheet forces max-width:100% on everything inside a slip.)
 * Amounts carry a non-breaking space, so "Rs 12,345" never splits.
 */
function rowHtml(label: string, value: string, cls = ''): string {
  return `<div class="dtr-row${cls ? ` ${cls}` : ''}"><span class="l">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}

function tableHtml(b: Extract<ReportBlock, { kind: 'table' }>): string {
  const n = Math.max(1, b.head.length);
  const cols = `minmax(0,1fr)${' auto'.repeat(n - 1)}`;
  const cell = (v: string, i: number, cls: string) => `<span class="${[i > 0 ? 'n' : '', cls].filter(Boolean).join(' ')}">${esc(v)}</span>`;
  const row = (r: string[], cls: string) => Array.from({ length: n }, (_, i) => cell(r[i] ?? '', i, cls)).join('');
  const body = b.rows.length ? b.rows.map(r => row(r, '')).join('') : `<span>-</span>${'<span></span>'.repeat(n - 1)}`;
  // Rules span the whole table (a border per cell would be cut by the gaps).
  return `<div class="dtr-tbl" style="grid-template-columns:${cols}">${row(b.head, 'h')}<span class="sep"></span>${body}${b.foot ? `<span class="sep s"></span>${row(b.foot, 'f')}` : ''}</div>`;
}

function blockHtml(b: ReportBlock): string {
  switch (b.kind) {
    case 'section': return `<div class="dtr-sec">${esc(b.title)}</div>`;
    case 'row': return rowHtml(b.label, b.value, [b.bold ? 'b' : '', b.big ? 'big' : ''].filter(Boolean).join(' '));
    case 'table': return tableHtml(b);
    case 'total': return `<div class="dtr-total"><span class="l">${esc(b.label)}</span><span class="v">${esc(b.value)}</span></div>`;
    case 'entry': return `<div class="dtr-entry">${rowHtml(b.title, b.value, 'b')}${b.lines.filter(Boolean).map(l => `<div class="s">${esc(l)}</div>`).join('')}</div>`;
    case 'note': return `<div class="dtr-note${b.center ? ' dtr-c' : ''}">${esc(b.text)}</div>`;
    case 'rule': return `<div class="dtr-rule${b.style && b.style !== 'dashed' ? ` ${b.style}` : ''}"></div>`;
  }
}

/** The restaurant header every report shares: logo, name, address, phones. */
export function reportHeaderHtml(s: any = getSettings()): string {
  const phones = [s.phone1, s.phone2].filter(Boolean).join(' | ');
  const logoH = Math.max(28, Math.min(56, Number(s.logoHeight) || 48));
  return [
    s.logo ? `<img class="dtr-logo" src="${esc(s.logo)}" style="max-height:${logoH}px" alt="" />` : '',
    `<div class="dtr-name">${esc(s.name || 'Restaurant')}</div>`,
    s.address ? `<div class="dtr-sub">${esc(s.address)}</div>` : '',
    phones ? `<div class="dtr-sub">${esc(phones)}</div>` : '',
  ].join('');
}

/** Full report HTML (styles included), laid out to the width it is given. */
export function thermalReportHtml(doc: ThermalReportDoc, s: any = getSettings()): string {
  const meta = (doc.meta || []).filter(([, v]) => v !== undefined && v !== null && String(v) !== '');
  const credit = s.receiptShowPoweredBy !== false ? '<div class="dtr-credit">Powered by Digital Target</div>' : '';
  return `<style>${CSS}</style><div class="dtr">`
    + (doc.noHeader ? '' : reportHeaderHtml(s))
    + `<div class="dtr-title">${esc(doc.title)}</div>`
    + (meta.length ? `<div class="dtr-meta">${meta.map(([l, v]) => rowHtml(l, String(v))).join('')}</div>` : '')
    + doc.blocks.map(blockHtml).join('')
    + `<div class="dtr-foot">${rowHtml('Printed', reportTime())}</div>`
    + (doc.footer?.trim() ? `<div class="dtr-mkt">${esc(doc.footer.trim())}</div>` : '')
    + credit
    + '</div>';
}

// ---------- ESC/POS text (Fast Billing) ----------
/** The same report as printer text, for shops on the ESC/POS text path. */
export async function thermalReportBytes(doc: ThermalReportDoc, s: any, geom: import('./escposBuilder').SlipGeometry): Promise<number[]> {
  const { EscposDoc, paperOf, docOptionsOf, finishSlip } = await import('./escposBuilder');
  const d = new EscposDoc(paperOf(s, geom), docOptionsOf(s, undefined, geom));
  if (!doc.noHeader) {
    d.center().bold(true).size(2, 2).fit(String(s.name || 'Restaurant')).size(1, 1).bold(false);
    if (s.address) d.fit(String(s.address));
    const phones = [s.phone1, s.phone2].filter(Boolean).join(' | ');
    if (phones) d.fit(phones);
  }
  d.center().rule('=').bold(true).fit(doc.title.toUpperCase()).bold(false).rule('=').left();
  for (const [l, v] of doc.meta || []) if (v !== undefined && v !== null && String(v) !== '') d.lr(`${l}:`, String(v));
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'section': d.feed(1).bold(true).fit(b.title.toUpperCase()).bold(false).rule('-'); break;
      case 'row': if (b.bold || b.big) d.bold(true); d.lr(b.label, b.value); if (b.bold || b.big) d.bold(false); break;
      case 'table': {
        const joinNums = (r: string[]) => r.slice(1).filter(x => x !== '').join('  ');
        d.bold(true).lr(b.head[0] || '', joinNums(b.head)).bold(false).rule('-');
        for (const r of b.rows) d.lr(r[0] || '', joinNums(r));
        if (b.foot) d.rule('-').bold(true).lr(b.foot[0] || '', joinNums(b.foot)).bold(false);
        break;
      }
      case 'total': d.rule('=').bold(true).lr(b.label, b.value).bold(false).rule('='); break;
      case 'entry': d.bold(true).lr(b.title, b.value).bold(false); for (const l of b.lines) if (l) d.fit(`  ${l}`); d.rule('.'); break;
      case 'note': if (b.center) d.center(); d.fit(b.text); d.left(); break;
      case 'rule': d.rule(b.style === 'double' ? '=' : '-'); break;
    }
  }
  d.rule('-').lr('Printed', reportTime());
  if (doc.footer?.trim()) d.center().fit(doc.footer.trim());
  if (s.receiptShowPoweredBy !== false) d.center().fit('Powered by Digital Target');
  finishSlip(d, geom);
  return d.bytes();
}

// ---------- printing ----------
/**
 * Print a report on the counter printer — the same route, margins and speed
 * as the shift report and the bills. Never opens a browser print window.
 */
export async function printThermalReport(doc: ThermalReportDoc): Promise<{ success: boolean; error?: string }> {
  const settings: any = getSettings();
  const paperWidth = (settings.paperSize as '58mm' | '80mm') || '80mm';
  let printerName: string | undefined;
  let cfg: any;
  try {
    const pset = await loadPrinterSettings();
    cfg = resolvePrinterForRole(pset, 'counter', getDeviceId());
    if (cfg && (cfg.connection || 'system') === 'system' && cfg.printerName) printerName = cfg.printerName;
  } catch { /* print with the shop default */ }
  if (!printerName) printerName = settings.defaultPrinter || undefined;

  const { loadPrintMargins } = await import('@/lib/printMargins');
  const device = loadPrintMargins();
  const margin = resolveSlipMargin('report', cfg?.leftMarginMm, cfg?.rightMarginMm, device.left, device.right);

  if (wantsRaw({ printerConfig: cfg, settings })) {
    try {
      const bytes = await thermalReportBytes(doc, settings, {
        paper: cfg?.paperSize, leftMm: margin.left, rightMm: margin.right, contentWidthMm: cfg?.printWidthMm,
        autoCut: cfg ? cfg.autoCut !== false : undefined, beep: cfg ? !!cfg.beep : undefined,
      });
      const api: any = (window as any).electronAPI;
      if (api?.printRaw && bytes.length > 40) {
        const res = await api.printRaw({ printerName, data: bytes, copies: 1 });
        if (res?.success) return { success: true };
        console.warn('[DT-Print] raw report unavailable, using the rendered path:', res?.error);
      }
    } catch (e: any) {
      console.warn('[DT-Print] raw report failed, using the rendered path:', e?.message || e);
    }
  }

  const portal = document.createElement('div');
  portal.className = 'receipt-print-portal';
  portal.setAttribute('aria-hidden', 'true');
  portal.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;';
  const inner = document.createElement('div');
  inner.className = 'print-receipt bg-white text-black';
  inner.setAttribute('data-paper-size', paperWidth);
  inner.style.cssText = `width:${paperWidth};background:#fff;color:#000;`;
  inner.innerHTML = thermalReportHtml(doc, settings);
  portal.appendChild(inner);
  document.body.appendChild(portal);
  try {
    const res = await printNode(portal, {
      paperWidth, printerName, silent: true, copies: 1,
      printMode: (cfg?.printMode || (settings.fastRawPrintMode ? 'raw' : undefined)) as any,
      compact: !!settings.receiptCompactMode,
      compactFontSize: settings.receiptCompactFontSize,
      compactLineHeight: settings.receiptCompactLineHeight,
      marginLeftMm: margin.left,
      marginRightMm: margin.right,
      contentWidthMm: cfg?.printWidthMm,
      logType: 'other',
    });
    return { success: !!res?.success, error: res?.success ? undefined : (res as any)?.error || (res as any)?.message };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  } finally {
    setTimeout(() => { try { portal.remove(); } catch { /* already gone */ } }, 500);
  }
}
