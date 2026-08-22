import { firestoreUnavailable } from './legacyFirebaseGuard';
// Centralized app version metadata. Bump on release.
// Also exposes a Firestore-backed listener so admin can push a new
// "minClientVersion" without code change; clients see banner + reload.

import { fbDb, isFirebaseConfigured } from './firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export const APP_NAME = 'DT POS Enterprise';
/**
 * Web build version. For the Windows installer the EXE name is the
 * authoritative version — e.g. "DT POS Enterprise v1.0.2.exe". Electron
 * reads it from package.json at runtime via getInstalledVersion() and
 * the UI prefers that value when running inside Electron.
 */
/**
 * Injected from package.json at build time (see vite.config.ts). Previously
 * this was a hardcoded string and had drifted to 1.2.2 while the product was
 * on 1.3.x — so the app showed the wrong version everywhere. Now bumping
 * package.json is the ONLY step needed for a release.
 */
export const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') as string;
export const APP_VERSION_LABEL = `${APP_NAME} v${APP_VERSION}`;
// Build stamp from Vite define (see vite.config.ts).
export const BUILD_STAMP: string = (typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : '') as string;

/**
 * Returns the actual installed version. Inside Electron this reads from
 * app.getVersion() (package.json baked into the asar by electron-builder),
 * so once the user installs DT-POS-Enterprise-Setup-v1.0.2.exe the running
 * app reports 1.0.2 with no manual entry. In the browser it falls back to
 * the hard-coded APP_VERSION above.
 */
export async function getInstalledVersion(): Promise<string> {
  try {
    const api: any = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (api?.getAppVersion) {
      const v = await api.getAppVersion();
      if (v && typeof v === 'string') return v;
    }
  } catch { /* ignore */ }
  return APP_VERSION;
}

declare const __BUILD_STAMP__: string | undefined;
declare const __APP_VERSION__: string | undefined;

export interface SystemConfig {
  latestVersion?: string;
  minClientVersion?: string;
  forceUpgrade?: boolean;
  message?: string;
}

/** Compare semver-ish "1.2.3" strings. -1 / 0 / 1. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Subscribe to systemConfig/latest. Returns unsubscribe. */
export function listenSystemConfig(cb: (cfg: SystemConfig) => void): () => void {
  // v1.19.7 — on Supabase this Firestore subscription would never fire
  // AND never error, so the caller's spinner ran forever (the Releases tab
  // hung exactly this way). Call back once with an empty result so the UI
  // settles into an honest empty state instead of loading indefinitely.
  if (firestoreUnavailable()) {
    /* no snapshot to deliver; leave defaults in place */
    return () => {};
  }

  if (!isFirebaseConfigured()) return () => {};
  try {
    const ref = doc(fbDb(), 'systemConfig', 'latest');
    return onSnapshot(ref, snap => {
      const data = snap.data() as SystemConfig | undefined;
      if (data) cb(data);
    }, () => {});
  } catch { return () => {}; }
}
