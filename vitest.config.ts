// Test-only config. The app build is driven by vite.config.ts; tests need a
// DOM (the store reads localStorage) and the same build-time defines/aliases.
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));

export default defineConfig({
  // @ts-expect-error vitest reads this block; vitest is run via bunx, not a dep
  plugins: [tsconfigPaths()],
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version ?? "1.25.2"),
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
      "firebase/app": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
      "firebase/auth": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
      "firebase/firestore": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
      "firebase/storage": path.resolve(process.cwd(), "./src/lib/firebaseStub.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    // The offline queue lives in IndexedDB; setup.ts installs fake-indexeddb.
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
