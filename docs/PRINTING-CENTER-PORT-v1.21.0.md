# Printing Center — brought across from the offline POS (v1.21.0)

**Release:** v1.76.0 · 2026-11-01
**Why:** the offline POS (v1.21.0) printed fast and found the printer by itself; the cloud app had drifted from it.
The owner asked for the same Printing Center, the same fast printing and the same margin settings, "100%".

This file says exactly what came across, what was kept from the cloud app on purpose, and what has **not** been
proved. It is written so a reader can check the claims, not so the port sounds finished.

---

## 1. What came across (same behaviour as v1.21.0)

### Windows shell (`dtpos-desktop`, commit `50ba462`)
| Piece | What it does |
|---|---|
| `src/main/printing-engine/engine.cjs` (+ `escposRaster`, `rawWorker`, `printerResolve`, `reversedText`, `textWeight`, `codeRegions`) | The v1.21.0 engine: HTML is rasterised and sent as **one** raw ESC/POS job to the spooler (the "fast printing" path), a hidden print worker, the Windows-driver path with a strategy memory, the printer-name matcher, LAN print/scan, spooler tools. |
| `src/main/mainWindow.ts`, `src/main/index.ts` | Hands the main window to the engine. |
| `src/main/ipc/printing.ts`, `src/shared/channels.ts` | The channel contract: 33 exposed methods, each with a handler (the boot-time completeness check covers them). |
| `scripts/copy-engine.mjs` + `package.json` build | Copies the `.cjs` engine into `out/` (the bundler does not). |

### Web app (this repository)
- **Printing Center** — a left module list, one module at a time: Status · Printers · Role mapping · Print mode & speed ·
  Receipt design · Margins · Alignment test · Print quality · Calibration · Test print · Print queue · Diagnostics ·
  Setup & support file · Tokens. Remembers the last module per device. Old `?tab=` links still resolve.
- **Fast printing** — `src/printing/*` (`fastPrint`, `directPrint`, `escposBuilder`, `receiptLayout`, `printGeometry`,
  `paperProfile`, `printMode`, `codeRaster`, `thermalReport`, `testSlip`, `alignmentTest`).
- **Printer detection** — `printerAutoDetect`, `printerMatch`: finds the installed printer, matches a saved name to what
  Windows reports now, and keeps a saved name selectable even if the printer is switched off.
- **Margins** — left / right / top / bottom in the v1.21.0 range (**−100 … +100**, i.e. "red / left type" shifts both ways),
  global per device and per slip type (bill, KOT, token); the top keeps its own ceiling so a mistyped value cannot
  push the slip off the paper.
- **Print quality** — darkness, three-level text weight, paper use.
- **Hold printing** — a bill entering Hold prints the bill (marked ON HOLD — UNPAID) and, if it never reached the kitchen,
  the KOT; once, through the queue's own de-duplication. Wired into the POS Hold button (new and edited bills), the POS
  retrieve list and Running Bills.
- **One-decision Kitchen Slip window** — the Kitchen button queues the KOT *and* used to open a window that printed it a
  second time. The window now prints by itself only when the queue has not just sent this order's KOT.
- **Tests** — 26 files ported from v1.21.0 (`src/test/v121-*`), 312 tests, all passing.

## 2. What was kept from the cloud app on purpose
These are cloud-only safeguards the offline POS never had. Removing them would have re-opened bugs already fixed.

- Margins auto/manual switch (v1.57.0).
- KOT is stamped as sent when it is **queued**, not when it prints (v1.2.4).
- The Firestore / Supabase guards and `legacyFirebaseGuard`; no module may start a Firebase subscription.
- The print-CSS fix that stops a print from taking over the screen.
- Storage uploads instead of base64 for images.
- The Kitchen Slip window also respects the order's own `kotPrinted` flag (an old, already-sent order opened from "last
  order" is not auto-printed again).

## 3. Differences from v1.21.0 a reader should know about
1. The offline POS's `offlineNoCloud` shim and its device-licence `printGuard` are **not** carried over; `printGuard`
   is a pass-through stub here (licensing in the cloud app is per-tenant).
2. Token records stay on the device (as in v1.21.0); they are not synced to Supabase.
3. The weighing-scale module, offline licensing and the ShiftReport wiring are not part of this port.
4. The cloud app has no separate "Retrieve" page, so that path is covered by the POS retrieve list and Running Bills.
5. The cloud POS has five openers for the Kitchen Slip window (no "More" menu entry), not six.
6. Settings → Receipt / KOT / Printer tabs were replaced by the v1.21.0 tab components.
7. Where a cloud test pinned a design that the port replaces on purpose (margin range, bold model, slip height
   measurement), the test was updated and the reason is written in a comment beside it.

## 4. Verification — what is proved and what is not

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full test suite | **157 files · 2,424 tests pass** (1 skipped: `version.test.ts`, the installer-name check, skipped before this release) |
| Ported v1.21.0 tests | 26 files · 312 tests pass. Some of them read the shell's engine files and only run when `dtpos-desktop` sits next to this repository (as it does in the delivered ZIP); in a lone checkout (e.g. Lovable) they are skipped and say so. |
| `npm run build` | OK |
| Shell tests (`dtpos-desktop`) | 33 pass (`npm test`: security + printing-engine) |
| **A real thermal printer, a real Windows install** | **NOT VERIFIED — cannot be done in this environment.** |
| Windows installer (`npm run dist`) | **NOT VERIFIED** here; it must be built and run on a Windows PC. |
| Android apps | not changed by this release; printing from them is **NOT VERIFIED**. |

### First-day acceptance on the real till (do this before selling the build)
1. Install the Windows build, open **Printing Center → Printers**, press detect: the printer name should fill itself in.
2. **Role mapping:** set bill / KOT / token printers; the "queue as Pending" warning must disappear.
3. **Alignment test:** print the ruled slip; adjust left/right until both edges touch the rules; save.
4. **Test print** each slip type once. Then ring one real sale: bill and KOT must come out once each.
5. Press **Kitchen** on a new order: exactly **one** KOT must print (not two).
6. Put an order on **Hold**: one bill marked ON HOLD — UNPAID (and one KOT if the kitchen never got it).
7. Pull the USB cable, print, plug it back: the job should appear in **Print queue** as pending/failed, and print when retried.

Record the printer model and result of each step in `docs/qa/` — until then the printing claim is "tested in code",
not "tested on a printer".
