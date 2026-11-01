// ============================================================
// Printer Center, on the real screen: a Black Copper prints the test slip
// blank on the image route → "Came out blank" → the printer is switched to
// the Windows driver, SAVED, and the test prints again that way; "Yes, it
// printed" confirms. Blank in every mode → the paper/hardware guidance.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const printNode = vi.hoisted(() => vi.fn(async (_portal: any, opts: any) => ({
  success: true,
  attempts: [opts?.printMode === 'driver' ? 'fast-window:driver' : 'fast-window:raster'],
})));
vi.mock('@/printing', async (orig) => ({ ...(await orig() as any), printNode }));

const PRINTER = {
  id: 'bc1', name: 'Counter', connection: 'system', printerName: 'BlackCopper BC-85AC', role: 'counter', paperSize: '80mm',
  printMode: 'auto', leftMarginMm: 2, rightMarginMm: 2, topFeedMm: 0, bottomFeedMm: 0, autoCut: true, beep: false, copies: 1,
  escposMode: false, enabled: true,
};

describe('Printer Center — "Came out blank" on a Black Copper', () => {
  beforeEach(() => {
    localStorage.clear();
    printNode.mockClear();
    localStorage.setItem('dtpos-printer-settings-v1', JSON.stringify({ printers: [PRINTER], deviceAssignments: {} }));
    const known: Record<string, any> = {
      getPrinters: async () => [{ name: 'BlackCopper BC-85AC', displayName: 'BlackCopper BC-85AC', isDefault: true, options: { system_driverinfo: 'BlackCopper 80mm Series' } }],
      printRaw: vi.fn(async () => ({ success: true })),
    };
    // Every other desktop call the panel makes on mount answers harmlessly.
    (window as any).electronAPI = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : async () => ({ success: true, data: [] })) });
  });
  afterEach(() => { delete (window as any).electronAPI; });

  it('switches Automatic → Windows driver, saves it, re-tests; then confirms', async () => {
    const { default: PrinterSettingsPanel } = await import('@/components/PrinterSettingsPanel');
    render(<PrinterSettingsPanel />);
    const testButtons = await screen.findAllByRole('button', { name: /^Test Print$/ });
    fireEvent.click(testButtons[0]);

    // The test used the bill's route (image sent as RAW) — and asks.
    const feedback = await screen.findByTestId('test-feedback');
    expect(feedback).toHaveTextContent(/Test sent via image sent as RAW \(Print Mode: Automatic \(image sent as RAW\)\)/);
    expect(printNode).toHaveBeenCalledTimes(1);
    expect(printNode.mock.calls[0][1]).toMatchObject({ printerName: 'BlackCopper BC-85AC', printMode: undefined });

    // The shop saw a blank slip.
    fireEvent.click(screen.getByRole('button', { name: /Came out blank — try Windows driver/ }));
    await waitFor(() => expect(printNode).toHaveBeenCalledTimes(2));
    expect(printNode.mock.calls[1][1]).toMatchObject({ printMode: 'driver' });
    const saved = JSON.parse(localStorage.getItem('dtpos-printer-settings-v1') || '{}');
    expect(saved.printers[0].printMode).toBe('driver');
    expect(await screen.findByTestId('test-feedback')).toHaveTextContent(/Test sent via Windows driver \(Print Mode: Windows driver\)/);

    // It printed this time.
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it printed' }));
    expect(screen.getByTestId('test-feedback')).toHaveTextContent(/This mode works on this printer/);
  });

  it('blank in every mode ends with the paper/hardware checks, not another switch', async () => {
    const { default: PrinterSettingsPanel } = await import('@/components/PrinterSettingsPanel');
    render(<PrinterSettingsPanel />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Test Print$/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Came out blank — try Windows driver/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Came out blank — try Raw ESC\/POS text/ }));
    await waitFor(() => expect((window as any).electronAPI.printRaw).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /^Came out blank$/ }));
    expect(await screen.findByText(/Blank in every mode/)).toBeInTheDocument();
    expect(screen.getByText(/Scratch the paper with a fingernail/)).toBeInTheDocument();
  });
});
