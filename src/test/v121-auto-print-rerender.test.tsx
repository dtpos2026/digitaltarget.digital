// ============================================================
// AUTO-PRINT SURVIVES RE-RENDERS — "Retrieve → Pay prints 20 seconds late".
//
// The print host (AutoKotPrinter) lives in AppLayout, whose header clock
// re-renders it every second. Each re-render handed the receipt, KOT and
// token components new props; their auto-print effect's cleanup then
// cancelled the print it had just scheduled, and a ref stopped it from ever
// being scheduled again. Nothing printed until the host's 20-second safety
// timeout retried the job. A slow till (a big order history, a Retrieve →
// Pay that saves the order, the table and a KOT) makes the tick land in that
// gap on almost every bill.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import ReceiptPreview from '@/components/ReceiptPreview';
import KitchenReceipt from '@/components/KitchenReceipt';
import { buildSampleOrder } from '@/lib/sampleOrder';
import type { RestaurantSettings } from '@/lib/types';

const order = buildSampleOrder();
const settings = { name: 'Chai Corner', currencySymbol: 'Rs ', paperSize: '80mm', receiptDesign: 'classic', kotDesign: 'classic' } as unknown as RestaurantSettings;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('auto-print is not cancelled by a re-render', () => {
  it('receipt: a new render right after mount (the header clock) still prints once', async () => {
    const done = vi.fn();
    const el = (s: RestaurantSettings) => (
      <ReceiptPreview order={order} settings={s} autoPrint showPrintButton={false} onAutoPrintComplete={r => done(r)} />
    );
    const { rerender } = render(el(settings));
    // Before the scheduled print has started: new settings object, new callback.
    rerender(el({ ...settings }));
    rerender(el({ ...settings }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(done.mock.calls[0][0]).toMatchObject({ success: true });
    // ...and exactly once, however many renders followed.
    await new Promise(r => setTimeout(r, 300));
    expect(done).toHaveBeenCalledTimes(1);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('KOT: same', async () => {
    const done = vi.fn();
    const el = (s: RestaurantSettings) => (
      <KitchenReceipt order={order} settings={s} autoPrint autoPrintDelayMs={0} showPrintButton={false} onAutoPrintComplete={r => done(r)} />
    );
    const { rerender } = render(el(settings));
    rerender(el({ ...settings }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await new Promise(r => setTimeout(r, 300));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('unmounted before it starts, nothing prints (the host dropped the job)', async () => {
    const done = vi.fn();
    const { unmount } = render(
      <ReceiptPreview order={order} settings={settings} autoPrint showPrintButton={false} onAutoPrintComplete={r => done(r)} />,
    );
    unmount();
    await new Promise(r => setTimeout(r, 300));
    expect(done).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });
});
