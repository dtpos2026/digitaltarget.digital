// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));

// ===== Desktop (Electron) build target =====
//
// The normal build is Cloudflare Pages: an SSR worker plus assets, with no
// index.html anywhere. A packaged desktop app has no server to run, so it needs
// a plain client bundle it can load from disk.
//
// DT_BUILD_TARGET=desktop turns on TanStack Start's SPA mode, which prerenders
// a single shell index.html that the router hydrates on the client. Everything
// else — routes, components, store, sync — is the same code as the web build.
//
// Gated on an env var on purpose: the Cloudflare build must not change shape.
const DESKTOP = process.env.DT_BUILD_TARGET === "desktop";

export default defineConfig({
  // Nitro is the Cloudflare deploy layer. The desktop build has no server to
  // deploy, and Nitro's cloudflare_pages preset writes `_worker.js` where the
  // SPA prerenderer expects `server/server.js`, so it is skipped entirely here.
  // Without it the build emits the stock TanStack layout: client/ + server/.
  ...(DESKTOP ? { nitro: false as const } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(DESKTOP
      ? {
          spa: {
            enabled: true,
            prerender: { enabled: true, outputPath: "/index.html", crawlLinks: false },
          },
        }
      : {}),
  },
  vite: {
    // The SPA prerender step boots a Vite preview server. Its default bind is
    // `::`, which fails outright on a host without IPv6 (this sandbox, and many
    // CI runners) with EAFNOSUPPORT. Pinning it to IPv4 costs nothing and makes
    // the desktop build reproducible anywhere.
    ...(DESKTOP
      ? {
          preview: { host: "127.0.0.1" as const },
          // Kept out of dist/ so a desktop build can never be mistaken for, or
          // overwrite, the Cloudflare Pages artifact the deploy script checks.
          build: { outDir: "dist-desktop" },
        }
      : {}),
    define: {
      __BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
      __APP_VERSION__: JSON.stringify(pkg.version ?? "1.25.2"),
    },
    resolve: {
      alias: {
        // The Firebase SDK is removed; every `firebase/*` import resolves to a
        // local stub so nothing can build against or connect to Firebase.
        "firebase/app": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
        "firebase/auth": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
        "firebase/firestore": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
        "firebase/storage": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
      },
    },
  },
});
