# Printing Module — Single Source of Truth

All receipt / KOT printing for DT POS goes through this folder.
Do NOT add print CSS, page-size, or `webContents.print` options anywhere else.

## The 15 Rules

1. No browser default margins.
2. `@page { margin: 0 }`.
3. `body { margin: 0; padding: 0 }`.
4. Receipt container `margin-top: 0; padding-top: 0`.
5. No fixed page height.
6. Receipt height = `auto` (content driven).
7. `overflow: visible` (never `hidden` / `clip`).
8. Electron `webContents.print` uses:
   - `silent: true`
   - `printBackground: true`
   - `margins: { marginType: 'none' }`
   - `scaleFactor: 100`
9. No paper feed before print.
10. No form-feed (`\x0C`) before print.
11. 500–1000ms render delay before printing.
12. Test short and long receipts separately.
13. Browser print and EXE print must match exactly.
14. All printer config lives in `printConfig.ts` only.
15. Debug mode = Preview + Silent print comparator.

## Usage

```ts
import { printNode } from '@/printing';

const portal = document.querySelector('.receipt-print-portal') as HTMLElement;
await printNode(portal, { paperWidth: '80mm', printerName: 'POS-80' });
```

## Why we removed fixed height

Earlier `thermal-print.ts` forced a minimum page height of `paperWidth + 5mm`
to "avoid landscape flip". On short receipts this padded ~85mm of blank paper
after content. We now rely on `@page size: 80mm auto` + `usePrinterDefaultPageSize`
so the printer feeds only as much paper as the content needs.
