// ============================================================
// RECEIPT SCAN — a receipt barcode scanned anywhere in the POS opens its bill.
//
// The barcode on a bill (Settings → Receipt → QR & Barcode) carries its
// reference, R + date + bill number (e.g. R2609241042). A USB scanner types
// it like a keyboard; this listener recognises that pattern only — item
// barcodes and ordinary typing are left alone — and opens the bill in
// Bill Reprint, read-only, where it can be viewed or reprinted.
// ============================================================
import { useEffect } from 'react';
import { useNavigate } from '@/lib/hash-router';
import { attachBarcodeScanner } from '@/lib/barcode';
import { parseReceiptRef } from '@/lib/receiptCodes';

export default function ReceiptScanListener() {
  const navigate = useNavigate();
  useEffect(() => attachBarcodeScanner((code) => {
    const ref = String(code || '').trim().toUpperCase();
    if (parseReceiptRef(ref)) navigate(`/bill-reprint?ref=${encodeURIComponent(ref)}`);
  }), [navigate]);
  return null;
}
