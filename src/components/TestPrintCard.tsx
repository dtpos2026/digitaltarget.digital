// ============================================================
// Test Print Card — ek button se sample receipt print karta hai
// taake silent print + margins ek hi baar me verify ho jayen.
// ============================================================
import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { printNode, isElectronPrintAvailable } from '@/printing';
import { loadPrintMargins } from '@/lib/printMargins';

export default function TestPrintCard() {
  const portalRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const stamp = now.toLocaleString();
  const m = loadPrintMargins();

  const handleTest = async (silent: boolean) => {
    if (!portalRef.current || busy) return;
    setBusy(true);
    try {
      const res = await printNode(portalRef.current, {
        paperWidth: '80mm',
        silent,
        preferElectron: silent,
        copies: 1,
      });
      if (res.success) {
        toast.success(silent ? 'Silent test print sent' : 'The browser print dialog has opened');
      } else {
        toast.error('Test print fail: ' + (res.error || 'unknown'));
      }
    } catch (e: any) {
      toast.error('Test print error: ' + (e?.message || String(e)));
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Printer Test Print</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Print a sample receipt to verify silent printing, margins (T:{m.top} R:{m.right} B:{m.bottom} L:{m.left} mm)
          and paper alignment. Save the <b>Margins Save</b> first, then press Test Print.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleTest(true)} disabled={busy}>
          {busy ? 'Printing…' : (isElectronPrintAvailable() ? 'Silent Test Print' : 'Test Print')}
        </Button>
        <Button variant="outline" onClick={() => handleTest(false)} disabled={busy}>
          Browser Print Dialog
        </Button>
      </div>

      {/* Hidden portal — printService activates this */}
      <div
        ref={portalRef}
        className="receipt-print-portal"
        aria-hidden="true"
        style={{ position: 'fixed', left: '-10000px', top: 0, width: '80mm', visibility: 'hidden' }}
      >
        <div className="print-receipt">
          <div className="receipt-print-content">
            <h1 style={{ textAlign: 'center', margin: 0 }}>DT POS</h1>
            <h3 style={{ textAlign: 'center', margin: '2px 0' }}>*** TEST PRINT ***</h3>
            <div style={{ textAlign: 'center', fontSize: 12 }}>{stamp}</div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Item A</span><span>Rs. 250.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Item B x2</span><span>Rs. 400.00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sample Variant (Large)</span><span>Rs. 550.00</span>
            </div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div className="grand-total" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
              <span>TOTAL</span><span>Rs. 1,200.00</span>
            </div>
            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
            <div style={{ textAlign: 'center', fontSize: 11 }}>
              Margins T:{m.top} R:{m.right} B:{m.bottom} L:{m.left} mm
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
              If the text is even on both sides, the alignment is correct.
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
              — Thank you —
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
