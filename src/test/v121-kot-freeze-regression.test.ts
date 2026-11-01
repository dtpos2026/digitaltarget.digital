// ============================================================
// KOT FREEZE — regression lock on the real Electron main process.
//
// The reported fault: after a KOT print the POS showed a white screen with
// a slip in the corner, stopped responding and had to be restarted.
//
// The cause was a crash, not a hang. While a slip prints, the print CSS
// hides the whole POS UI (body.thermal-printing); the screen comes back
// only when the renderer's print function runs its cleanup. That cleanup
// was being skipped because:
//
//   runPrintJob assigned `strategies.custom.deviceName` unconditionally,
//   but `custom` only exists when an explicit page height was sent. Every
//   KOT uses the printer's default page size, so `custom` was undefined and
//   the assignment threw. The throw escaped both runPrintJob's try block
//   and the `print-receipt` handler (which had no try/catch), so the
//   renderer's `await` REJECTED and never reached its cleanup.
//
// This drives the real electron/main.cjs against a stubbed Electron with
// exactly the options a KOT sends, and asserts the handler resolves with a
// dispatched job instead of throwing. Running it against the pre-fix file
// reproduces `Cannot set properties of undefined (setting 'deviceName')`.
// ============================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { HAS_ENGINE, ENGINE_DIR } from './_shellEngine';

const require_ = createRequire(import.meta.url);

interface Harness {
  handlers: Map<string, (event: unknown, options: unknown) => Promise<any>>;
  printCalls: { deviceName?: string; pageSize?: unknown }[];
}

/** Load electron/main.cjs with a stubbed `electron` module. */
function loadMain(): Harness {
  const handlers = new Map<string, (event: unknown, options: unknown) => Promise<any>>();
  const printCalls: { deviceName?: string; pageSize?: unknown }[] = [];

  const webContents = () => ({
    isDestroyed: () => false,
    getPrintersAsync: async () => [
      { name: 'BIXOLON SRP-352plusIII', displayName: 'BIXOLON SRP-352plusIII' },
    ],
    print: (opts: any, cb: (ok: boolean, reason: string | null) => void) => {
      printCalls.push({ deviceName: opts?.deviceName, pageSize: opts?.pageSize });
      cb(true, null);
    },
    executeJavaScript: async () => ({ width: 300, height: 600 }),
    capturePage: async () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }),
    setZoomFactor: () => {},
    openDevTools: () => {},
    closeDevTools: () => {},
    setWindowOpenHandler: () => {},
    insertCSS: async () => {},
    setZoomLevel: () => {},
    send: () => {},
    session: { setPermissionRequestHandler: () => {} },
    on: () => {}, once: () => {}, removeListener: () => {},
  });

  class BrowserWindow {
    webContents = webContents();
    isDestroyed = () => false;
    loadFile = async () => {};
    loadURL = async () => {};
    setContentSize = () => {};
    on = () => {}; once = () => {};
    show = () => {}; destroy = () => {}; focus = () => {}; center = () => {};
    maximize = () => {}; restore = () => {}; setTitle = () => {};
    setMenu = () => {}; setMenuBarVisibility = () => {}; removeMenu = () => {};
    isMinimized = () => false;
    static getAllWindows() { return []; }
  }

  const electronStub = {
    app: {
      whenReady: () => Promise.resolve(),
      on: () => {}, quit: () => {},
      getPath: () => '/tmp', getVersion: () => '0.0.0-test', getName: () => 'dtpos',
      setLoginItemSettings: () => {}, getLoginItemSettings: () => ({ openAtLogin: false }),
      isPackaged: false, requestSingleInstanceLock: () => true,
    },
    BrowserWindow,
    ipcMain: { handle: (ch: string, fn: any) => handlers.set(ch, fn), on: () => {} },
    dialog: {}, shell: {},
    Menu: { setApplicationMenu: () => {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } }) },
  };

  const Module = require_('node:module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === 'electron') return 'electron-stub';
    return originalResolve.call(this, request, ...rest);
  };
  require_.cache['electron-stub'] = {
    id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: electronStub,
  } as any;

  try {
    // The shell now keeps this code in printing-engine/engine.cjs and registers it through
    // registerPrintingEngine (the handlers keep their v1.21.0 code); drive it the same way main.cjs was driven.
    const enginePath = path.resolve(ENGINE_DIR, 'engine.cjs');
    delete require_.cache[enginePath];
    const { registerPrintingEngine } = require_(enginePath);
    const win = new BrowserWindow();
    registerPrintingEngine({
      app: electronStub.app,
      handle: (ch: string, fn: any) => handlers.set(ch, fn),
      getMainWindow: () => win,
      appendLog: () => {},
      dataDir: '/tmp',
    });
  } finally {
    Module._resolveFilename = originalResolve;
  }

  return { handlers, printCalls };
}

let harness: Harness;

beforeAll(async () => {
  if (!HAS_ENGINE) return;
  harness = loadMain();
  // Let app.whenReady() callbacks run so the main window exists.
  await new Promise(resolve => setTimeout(resolve, 50));
});

describe.skipIf(!HAS_ENGINE)('printReceipt with the printer default page size (the KOT case)', () => {
  /** Exactly what KitchenReceipt sends: named printer, no explicit height. */
  const kotOptions = {
    printerName: 'BIXOLON SRP-352plusIII',
    silent: true,
    usePrinterDefaultPageSize: true,
    pageWidthMicrons: 80000,
    paperLabel: '80mm',
    autoCut: true,
  };

  it('registers the handler', () => {
    expect(harness.handlers.has('printReceipt')).toBe(true);
  });

  it('resolves instead of throwing, so the renderer reaches its cleanup', async () => {
    const handler = harness.handlers.get('printReceipt')!;
    // A rejection here is the bug: it skipped the cleanup that takes the POS
    // out of print mode, leaving the white stuck screen.
    await expect(handler({}, kotOptions)).resolves.toBeDefined();
  });

  it('actually dispatches the job to the requested printer', async () => {
    const handler = harness.handlers.get('printReceipt')!;
    harness.printCalls.length = 0;
    const res = await handler({}, kotOptions);
    expect(res.success).toBe(true);
    expect(harness.printCalls.length).toBeGreaterThan(0);
    expect(harness.printCalls[0].deviceName).toBe('BIXOLON SRP-352plusIII');
  });

  it('does not send a pageSize when the printer default was asked for', async () => {
    // Forcing a custom page size is what made BIXOLON/Epson drivers pre-feed
    // blank paper, so the strategy chosen here matters.
    const handler = harness.handlers.get('printReceipt')!;
    harness.printCalls.length = 0;
    await handler({}, kotOptions);
    expect(harness.printCalls[0].pageSize).toBeUndefined();
  });

  it('still resolves when no printer name is given', async () => {
    const handler = harness.handlers.get('printReceipt')!;
    const res = await handler({}, { silent: true, usePrinterDefaultPageSize: true });
    expect(res).toBeDefined();
    expect(res.success).toBe(true);
  });

  it('reports a failure as a value rather than rejecting', async () => {
    // Anything that goes wrong in the main process must come back as
    // { success: false }, never as a rejected invoke.
    const handler = harness.handlers.get('printReceipt')!;
    const res = await handler({}, { printerName: 'No Such Printer', silent: true, usePrinterDefaultPageSize: true });
    expect(res).toBeDefined();
    expect(typeof res.success).toBe('boolean');
  });
});
