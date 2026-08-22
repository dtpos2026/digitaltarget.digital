// ============================================================
// Minimal ESC/POS command builder for thermal printers.
// Used for LAN/Network printers (raw TCP to port 9100) where
// we can't go through Windows driver.
//
// HTML -> clean text conversion preserves table layout so receipts
// don't come out as a blank slip (Phase-4 fix v1.0.4).
// ============================================================

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function bytes(...vals: number[]): number[] { return vals; }

export interface EscposOptions {
  paperWidth?: '58mm' | '80mm';
  copies?: number;
  autoCut?: boolean;
  beep?: boolean;
  topFeedLines?: number;
  bottomFeedLines?: number;
}

/** Convert HTML to a clean text representation for ESC/POS. */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  let s = html
    // strip non-content blocks first
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // table layout: rows -> newline, cells -> two-space separator
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<(tr|td|th)[^>]*>/gi, '')
    // line-level blocks
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    // label/value rows are usually adjacent <span>s inside a flex <div>;
    // without a separator they merged into one word (e.g. "PAYMENTCASH").
    .replace(/<\/span>/gi, '  ')
    // horizontal rules -> dashed separator line
    .replace(/<hr[^>]*>/gi, '\n--------------------------------\n')
    // strip remaining tags
    .replace(/<[^>]+>/g, '');
  // decode common entities
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // collapse runs of inline whitespace (NOT newlines) into a single space
  s = s.replace(/[ \t\f\v]+/g, ' ');
  // tidy blank lines
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** Build raw ESC/POS bytes from plain text. */
export function buildEscposFromText(text: string, opts: EscposOptions = {}): number[] {
  const out: number[] = [];
  // Initialize
  out.push(...bytes(ESC, 0x40));            // ESC @
  out.push(...bytes(ESC, 0x74, 0x00));      // codepage CP437
  out.push(...bytes(ESC, 0x52, 0x00));      // international charset USA (Black Copper clones)
  out.push(...bytes(ESC, 0x61, 0x00));      // left align

  // Top feed
  for (let i = 0; i < (opts.topFeedLines || 0); i++) out.push(LF);

  // Body: pass non-ASCII through as UTF-8 bytes. Most thermal printers
  // can render extended Latin in their active codepage; if not, they print
  // a glyph — far better than the previous '?' fallback that masked content.
  const enc = new TextEncoder();
  for (const ch of text) {
    if (ch === '\n') { out.push(LF); continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out.push(code);
    } else {
      const bs = enc.encode(ch);
      for (let i = 0; i < bs.length; i++) out.push(bs[i]);
    }
  }
  out.push(LF);

  // Bottom feed
  for (let i = 0; i < (opts.bottomFeedLines || 3); i++) out.push(LF);

  // Beep
  if (opts.beep) out.push(...bytes(ESC, 0x42, 0x02, 0x02));

  // Auto cut (full cut)
  if (opts.autoCut !== false) out.push(...bytes(GS, 0x56, 0x00));

  return out;
}

/** Blank-receipt guard. */
class BlankReceiptError extends Error {
  constructor() { super('Receipt content empty — refusing to send blank slip to printer'); }
}

/** Convenience: HTML -> ESC/POS bytes. Throws if extracted text is empty. */
export function buildEscposFromHtml(html: string, opts: EscposOptions = {}): number[] {
  const text = htmlToPlainText(html);
  if (text.replace(/\s+/g, '').length < 5) {
    // Don't print a blank slip — let caller surface the error.
    throw new BlankReceiptError();
  }
  return buildEscposFromText(text, opts);
}
