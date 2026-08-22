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

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
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
