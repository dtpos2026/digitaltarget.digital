// jest-dom matchers (toBeInTheDocument, toHaveTextContent …): the offline POS's component tests use them.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only cleans up between tests by itself when vitest runs with globals on (the offline POS did). Here it
// is off, so a render in one test would stay in the document for the next — clean up explicitly.
afterEach(() => { cleanup(); });
// v1.8.0 — jsdom has no IndexedDB. Our offline-first queue lives in it,
// so tests need a real IDB implementation to reproduce enterprise
// behaviour end-to-end.
import "fake-indexeddb/auto";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom ships window.print() as a stub; happy-dom has none. The print components call it as the last-resort path and the
// offline POS's tests spy on it, so give happy-dom the same stub.
if (typeof window.print !== "function") {
  Object.defineProperty(window, "print", { writable: true, configurable: true, value: () => {} });
}
