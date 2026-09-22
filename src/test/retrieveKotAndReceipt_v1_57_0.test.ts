// ============================================================================
// v1.57.0 — five things reported from the till, inspected before anything moved
//
// 1. TWO "Retrieve" MODULES, ONE OF THEM EXTRA
//    "retrive name ky 2 medul han, jo void ky nechy wala retrive medul ha who
//    del krdo, ye azafi ha". The sidebar carried both `bills` ("Retrieve") and
//    `retray` ("Retray (Reprint/Pay)"), the second sitting under Void. They
//    overlapped almost entirely — and the duplicate is where item 2 came from.
//
// 2. CANCEL NO LONGER TOLD THE KITCHEN
//    "jb cancal kry tu cancle wala print cross line wala ata tha jo kot me jata
//    tha". RunningBillsPage cancels and calls enqueueKotCancel(). RetrayPage
//    cancelled with a bare saveOrder() and a toast — no cancel ticket, ever. So
//    cancelling from the duplicate page silently left the kitchen cooking.
//    Deleting that page is the fix; the surviving page already does it right.
//
// 3. KOT PRINT FROM RETRIEVE DID NOTHING
//    "retrive me jo bi hota, me wha sy kot print kro, nhi ata print".
//    enqueueKot() RETURNS NULL when it declines — order awaiting approval, KOT
//    switched off, duplicate already queued — and the return value was thrown
//    away, with an unconditional "sent to the kitchen" toast after it. A job
//    that IS queued still never prints when no KOT printer is resolved; that
//    was recorded in the print log and nowhere the operator could see.
//
// 4. CRM HUNG ON CLICK
//    "custumer tu crm medul clik kry atk jata". getCustomers()/getOrders()
//    return a fresh array on every call, they were called in the component body, and
//    the useMemo listed those arrays as dependencies — so the memo never once
//    hit, and every render re-sorted every customer and re-reduced every order.
//
// 5. MARGINS: AUTO NEVER WORKED
//    "left rige margin printer ky hesab sy adjest ho sky auto or menualy b".
//    getEffectiveReceiptMargins did `deviceMargins.left ?? settings.
//    receiptMarginLeft`, but loadPrintMargins() always returns numbers, so the
//    right-hand side was unreachable and every preset's margins were dead.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = (p: string) => join(process.cwd(), p);
const read = (p: string) => readFileSync(root(p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const perms    = stripTs(read('src/lib/permissions.ts'));
const plans    = stripTs(read('src/lib/plans.ts'));
const app      = stripTs(read('src/App.tsx'));
const layout   = stripTs(read('src/components/AppLayout.tsx'));
const bills    = stripTs(read('src/pages/RunningBillsPage.tsx'));
const crm      = stripTs(read('src/pages/CrmInsightsPage.tsx'));
const margins  = stripTs(read('src/lib/printMargins.ts'));
const thermal  = stripTs(read('src/lib/thermal-print.ts'));
const preview  = stripTs(read('src/components/ReceiptPreview.tsx'));

describe('the duplicate Retrieve module is gone', () => {
  it('its page no longer exists', () => {
    expect(existsSync(root('src/pages/RetrayPage.tsx'))).toBe(false);
  });

  it('nothing still routes to, lists or links it', () => {
    for (const [name, src] of Object.entries({ perms, plans, app, layout })) {
      expect(src, `${name} still mentions retray`).not.toMatch(/retray/i);
    }
  });

  it('the Retrieve that remains is the bills module', () => {
    expect(perms).toContain("title: 'Retrieve'");
    expect(perms).toContain("path: '/bills'");
  });
});

describe('cancelling still tells the kitchen', () => {
  it('the surviving page sends a cancel KOT', () => {
    // This is the behaviour the deleted page lacked, so it must stay.
    expect(bills).toContain('enqueueKotCancel(updated)');
    expect(bills).toContain("settings.printKotOnCancel !== false");
    expect(bills).toContain('order.kotPrinted');
  });
});

describe('a KOT that was not sent never reports success', () => {
  it('the enqueue result is checked rather than discarded', () => {
    expect(bills).toContain('const job = enqueueKot(order, { force: true });');
    expect(bills).toContain('if (!job) {');
  });

  it('names the reason the operator can act on', () => {
    expect(bills).toContain('awaiting approval');
    expect(bills).toContain('no KOT printer is configured');
  });

  it('the update path is checked too', () => {
    expect(bills).toContain('const job = enqueueKotUpdate(order);');
  });

  it('the diff failure is no longer swallowed', () => {
    // `catch {}` here turned "could not work out the diff" into "nothing
    // changed", and the next line then sent a full reprint.
    expect(bills).toContain("console.error('[kot] could not compute the kitchen diff'");
  });
});

describe('CRM reads its data once instead of on every render', () => {
  it('the arrays come from state initialisers, not the render body', () => {
    expect(crm).toContain('useState(() => getCustomers())');
    expect(crm).toContain('useState(() => getBranches())');
    expect(crm).toContain('useState(() =>\n    getOrders().filter');
  });

  it('nothing calls the store directly in the body any more', () => {
    // A bare `const customers = getCustomers();` is the bug itself.
    expect(crm).not.toMatch(/^\s*const customers = getCustomers\(\);/m);
    expect(crm).not.toMatch(/^\s*const allOrders = getOrders\(\)/m);
  });
});

describe('margins: automatic by preset, manual per device', () => {
  it('a device knows whether it has margins of its own', () => {
    expect(margins).toContain('export function hasDevicePrintMargins()');
    expect(margins).toContain('localStorage.getItem(KEY) !== null');
  });

  it('the unreachable ?? fallback is gone', () => {
    expect(thermal).not.toContain('deviceMargins.left ?? settings.receiptMarginLeft');
    expect(thermal).not.toContain('deviceMargins.right ?? settings.receiptMarginRight');
  });

  it('an untuned device follows the preset', () => {
    expect(thermal).toContain('const manual = hasDevicePrintMargins();');
    expect(thermal).toContain('manual ? safeMm(device, fallback, max) : safeMm(fromSettings, fallback, max)');
  });

  it('reset hands the device back to auto instead of pinning defaults', () => {
    // Saving the defaults left the key in place, which would have made auto
    // unreachable for any device that had ever been tuned.
    expect(margins).toContain('localStorage.removeItem(KEY)');
    expect(margins).not.toMatch(/resetPrintMargins[\s\S]{0,200}savePrintMargins\(\{ \.\.\.DEFAULT_MARGINS \}\)/);
  });
});

describe('bold receipt text works on every design', () => {
  it('is a setting, not a preset', () => {
    expect(read('src/lib/types.ts')).toContain('receiptBoldText?: boolean;');
  });

  it('thickens the glyphs rather than only setting a weight', () => {
    // A weight is overridden the moment a design sets its own; a stroke is not,
    // and it reflows nothing, so Compact stays compact.
    expect(preview).toContain("WebkitTextStroke: '0.3px currentColor'");
    expect(preview).toContain('settings.receiptBoldText ? 800 : 700');
  });
});
