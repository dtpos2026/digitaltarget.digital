// (jest-dom matchers are not used by this suite and the package is not installed.)
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
