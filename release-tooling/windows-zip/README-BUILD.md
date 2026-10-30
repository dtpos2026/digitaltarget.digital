# DT POS Enterprise — Windows desktop build

This ZIP holds everything needed to build the **Windows installer** of DT POS:

| Folder | What it is |
|---|---|
| `digitaltarget.digital/` | The POS itself — the web application (React + TanStack Start + Supabase client). |
| `dtpos-desktop/` | The Electron shell that turns it into an installed Windows program. |
| `scripts/build-all.mjs` | Runs the two in the right order. |

The desktop program is **not** a second system. It loads the *same* POS code and talks to the *same* Supabase
project as the website. There is no second database. (The POS keeps its offline-first behaviour: a bill saves
locally and uploads when the connection is there.)

Before you hand this to a restaurant, read `digitaltarget.digital/docs/RELEASE-CHECKLIST.md` — it lists the open blockers,
the 10-minute smoke test for the website and for the installed app, and how to roll back.

## What you need (once)

- **Windows 10 / 11, 64-bit**
- **Node.js 22 LTS or newer** — https://nodejs.org (this also installs `npm`)
- About **3 GB** of free disk and an internet connection (it downloads Electron and the installer tools the first time)

You do **not** need Git, Visual Studio or Python.

## Build it (CMD or PowerShell)

```bat
cd DT-POS-Enterprise-Windows

npm install
npm run build
npm run dist
```

1. `npm install` — installs both projects (takes a few minutes).
2. `npm run build` — builds the POS client bundle, copies it into the shell, compiles the shell.
3. `npm run dist` — runs step 2 again if needed, then packages the installer.

**Result** (in `dtpos-desktop\release\`):

- `DT-POS-Setup-<version>.exe` — the installer (per-machine, lets the operator choose the folder, desktop + Start-menu shortcuts)
- `DT-POS-Portable-<version>.exe` — a single file for a PC where installing is not allowed

`<version>` is the POS version (it is stamped into the shell by `build-all.mjs`, so the installer is named after
what it contains and an installed copy is not forever "out of date").

Publish the **website** (do this *before* you give the Windows app to anyone — the installed app sends its login and
admin calls to the website, so the website should be the same version):

```bat
npm install -g wrangler      :: once
wrangler login               :: once
npm run deploy               :: builds the website and publishes it to Cloudflare Pages (project dt-pos)
```

Then open the site, press Ctrl+F5, and check that the version shown is the one in `digitaltarget.digital\package.json`.
(The Cloudflare Pages environment variables — Supabase service key etc. — are set once in the Cloudflare dashboard;
see `digitaltarget.digital\DEPLOY.md`.)

Other commands:

```bat
npm test                      :: web test suite + the shell's own tests
cd dtpos-desktop && npm start :: run the desktop app without packaging (after npm run build)
```

## Settings

| Setting | Where | Default |
|---|---|---|
| Supabase URL and public key | `digitaltarget.digital\.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) — these are *publishable* browser keys, not secrets | the production project |
| API origin the desktop shell proxies server calls to | environment variable `DTPOS_API_ORIGIN` on the PC running the app | `https://digitaltarget.digital` |
| Build from a client bundle somewhere else | environment variable `DTPOS_RENDERER` | `digitaltarget.digital\dist-desktop\client` |
| Sign the installer | `DT_ALLOW_SIGNING=1`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | not signed |

No secret key belongs in this folder, and none is needed to build. The Supabase *service* key lives only on the
server (Cloudflare) and never reaches the desktop app.

## Things that go wrong

- **Windows SmartScreen warns on first run.** The installer is not code-signed (that needs a certificate you buy).
  Choose *More info → Run anyway*. Add a certificate later with the settings above.
- **"Cannot create symbolic link … A required privilege is not held by the client"** while packaging
  (it follows several `downloading … winCodeSign` lines). Windows will not let an ordinary user create the
  symbolic links inside electron-builder's `winCodeSign` download, and the step that stamps the icon and version into
  `DT POS.exe` needs that download even for an unsigned build. Everything before this point (install, build) has
  already worked. Fix:
  1. Open **Command Prompt as Administrator** (Start → type `cmd` → right-click → *Run as administrator*).
  2. `cd /d "<the folder that holds package.json>"` (the `/d` is needed when the folder is on another drive).
  3. `rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"` (removes the half-extracted download).
  4. `npm run dist`

  Alternative: turn on Windows *Developer Mode* (Settings → For developers), open a **new** CMD, repeat steps 2–4.
  Admin is the surer of the two.
- **`npm install` is slow or fails behind a company proxy.** Set `HTTPS_PROXY` first.
- **"No client bundle at …"** — run `npm run build` before `npm run dist`.
- **Upgrading keeps your data.** The installer leaves the app's local data folder alone on upgrade and on uninstall.

## What is NOT covered by this ZIP

- The Android apps (Rider, Order Taker, Customer) — they have their own repository (`dtpos.apk`).
- Deploying the website: `npm run deploy` inside `digitaltarget.digital` (Cloudflare Pages).
- Database changes: `digitaltarget.digital\supabase\migrations`.
- PRA tax submission is switched **off** by default and needs the restaurant's own PRA registration and credentials.
