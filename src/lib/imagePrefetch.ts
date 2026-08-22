// Background image prefetcher
// Saare menu/deal/banner images ko background me download karta hai
// taa ke Service Worker unhe local cache (appdata) me save kar le.
// Result: offline pe bhi images visible.

import { getMenuItems, getSettings, onDataChange } from "./store";

let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
const prefetched = new Set<string>();

function fetchOne(url: string): Promise<void> {
  if (!url || prefetched.has(url)) return Promise.resolve();
  prefetched.add(url);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => {
      prefetched.delete(url);
      resolve();
    };
    try {
      img.src = url;
    } catch {
      resolve();
    }
  });
}

async function runPrefetch() {
  try {
    const urls: string[] = [];

    try {
      (getMenuItems() || []).forEach((m: any) => {
        if (m?.image) urls.push(m.image);
      });
    } catch {}

    try {
      const s: any = getSettings ? getSettings() : null;
      if (s?.onlineBanner) urls.push(s.onlineBanner);
      (s?.displayPromoImages || []).forEach((u: string) => {
        if (u) urls.push(u);
      });
    } catch {}

    const httpUrls = urls.filter((u) => /^https?:\/\//i.test(u));

    const batchSize = 4;
    for (let i = 0; i < httpUrls.length; i += batchSize) {
      await Promise.all(httpUrls.slice(i, i + batchSize).map(fetchOne));
    }
  } catch (e) {
    console.warn("[imagePrefetch] error:", e);
  }
}

function schedulePrefetch() {
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(runPrefetch, 2000);
}

export function startImagePrefetcher() {
  if (typeof window === "undefined") return;

  setTimeout(runPrefetch, 3000);

  try {
    onDataChange((coll) => {
      if (coll === "menuItems" || coll === "settings") schedulePrefetch();
    });
  } catch {}

  window.addEventListener("online", () => schedulePrefetch());
}
