// The "verify this invoice online" block printed on every Digital Target invoice: a QR code and the address it opens.
// The QR is drawn as inline SVG (no canvas), so it prints crisply, exports through html2canvas and renders in tests.
import { useEffect, useState } from 'react';
import { verifyUrl } from '@/lib/invoiceVerify';

interface Props {
  invoiceId: string;
  /** QR size in px. */
  size?: number;
  /** Narrow thermal layout: stacked, centred, smaller text. */
  compact?: boolean;
  color?: string;
}

export default function InvoiceVerifyBadge({ invoiceId, size = 92, compact = false, color = '#3c096c' }: Props) {
  const url = verifyUrl(invoiceId);
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const QR = (await import('qrcode')).default;
        const out = await QR.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } });
        if (!off) setSvg(out);
      } catch { if (!off) setSvg(''); }
    })();
    return () => { off = true; };
  }, [url]);

  return (
    <div
      data-invoice-verify
      style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: compact ? 4 : 12, textAlign: compact ? 'center' : 'left', maxWidth: compact ? 240 : 220 }}
    >
      <div
        data-invoice-qr
        aria-label="QR code that opens the online verification page for this invoice"
        role="img"
        style={{ width: size, height: size, flex: '0 0 auto', background: '#fff', padding: 4, border: '1px solid #ddd', borderRadius: 6, boxSizing: 'content-box' }}
        // The SVG is generated from our own URL by the qrcode library — never from user-supplied markup.
        dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `) }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, color, fontSize: compact ? 10 : 12 }}>Verify this invoice online</div>
        <div style={{ fontSize: compact ? 8 : 10, color: '#555', lineHeight: 1.35 }}>Scan the code, or open</div>
        <div data-invoice-verify-url style={{ fontSize: compact ? 7.5 : 9, color: '#222', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', lineHeight: 1.3 }}>{url}</div>
      </div>
    </div>
  );
}
