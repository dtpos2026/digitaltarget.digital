// ============================================================
// FIREBASE CONFIGURATION
// ============================================================
// 👉 PASTE YOUR FIREBASE WEB APP CONFIG HERE
// Get it from: Firebase Console → Project Settings → Your Apps → Web App
// (the object that looks like { apiKey: "...", authDomain: "...", ... })
// ============================================================

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, setPersistence, browserLocalPersistence, indexedDBLocalPersistence } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
} from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { AUTO_DETECT_LONG_POLLING } from './featureFlags';

// ===== v1.24.0 — Firebase configuration removed =====
// These were hardcoded production values (project dtpos-burewala) compiled
// into every bundle. Harmless while Firebase was live — web API keys are not
// secrets — but there is no reason to keep shipping another system's project
// identifiers in a build that can no longer reach it.
//
// The object stays only because this module still exports it; nothing uses it.
const firebaseConfig: Record<string, string | undefined> = {};


// ============================================================
// 👇 SUPER ADMIN EMAIL — sirf yeh email naye restaurants approve kar sakta hai.
// Pehle is email se Firebase Authentication mein account banayein,
// phir yahan paste karein (lowercase).
// ============================================================
// ===== v1.24.0 — the hardcoded allow-list is gone =====
// This array shipped in the bundle, so anyone could read which accounts held
// platform-wide power over every restaurant. Super admins now live in the
// `super_admins` table, checked by is_super_admin() with RLS — not readable
// from the client, and changeable without a new build.
//
// Kept as an empty array so the legacy Firebase branches still compile.
export const SUPER_ADMIN_EMAILS: string[] = [];

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}

// Firebase ENABLED — cloud sync, owner login, device approval, image storage all active.
// To run local-only again, change this to: return false;
/**
 * ===== v1.24.1 — this now means "is a CLOUD BACKEND configured" =====
 *
 * Despite the name, 40 call sites use this to decide whether the app runs in
 * cloud mode at all: whether the email login screen appears, whether device
 * management is available, whether the store syncs, whether sessions isolate.
 *
 * When the Firebase config was emptied in v1.24.0 this began returning false
 * everywhere, and the app silently fell back to standalone-local behaviour —
 * the owner login screen never appeared and Devices reported
 * "Cloud mode disabled — device management not available", on a build whose
 * cloud backend was working perfectly.
 *
 * The name is kept so those 40 call sites stay untouched; the meaning is now
 * "a cloud backend exists", which on this build means Supabase.
 *
 * Renaming it to isCloudConfigured() is a follow-up worth doing, but not in
 * the same change that fixes a production outage.
 */
export const isFirebaseConfigured = (): boolean => {
  const env = (import.meta as any).env ?? {};
  const supabaseReady = !!env.VITE_SUPABASE_URL
    && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
  if (supabaseReady) return true;
  // Legacy Firebase build (config restored by hand) — still honoured.
  return !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
};



let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

export function fbApp(): FirebaseApp {
  if (_app) return _app;
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Edit src/lib/firebase.ts and paste your config.');
  }
  _app = getApps()[0] ?? initializeApp(firebaseConfig);
  return _app;
}

export function fbAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(fbApp());
  // Force long-lived local persistence so users stay logged in across browser restarts
  // until they explicitly logout or clear browsing data.
  try {
    setPersistence(_auth, indexedDBLocalPersistence).catch(() => {
      try { setPersistence(_auth!, browserLocalPersistence); } catch {}
    });
  } catch {}
  return _auth;
}

export function fbDb(): Firestore {
  if (_db) return _db;
  // Per-browser pin: if a prior session detected WebChannel failure and set
  // this marker, always force long polling (legacy behavior) regardless of
  // the AUTO_DETECT_LONG_POLLING flag.
  let forcePinned = false;
  try { forcePinned = typeof localStorage !== 'undefined' && localStorage.getItem('dtpos-firestore-force-long-polling') === '1'; } catch {}

  if (AUTO_DETECT_LONG_POLLING && !forcePinned) {
    try {
      _db = initializeFirestore(fbApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        // Try normal WebChannel first; the SDK auto-detects and internally
        // switches to long polling if the stream can't be established. This
        // avoids doubling bandwidth for the majority of networks that work
        // fine, while still recovering on restrictive firewalls.
        experimentalAutoDetectLongPolling: true,
      } as any);
      // Best-effort auto-pin: if the very first operation errors with a
      // transport/stream failure, remember it so the next launch skips the
      // probe and goes straight to force-long-polling.
      try {
        setTimeout(() => {
          try {
            const orig = (window as any).addEventListener;
            // no-op — actual pinning happens in store bootstrap when a
            // Firestore error surfaces; this block is a placeholder hook
            // so future auto-pin logic can attach without touching init.
            void orig;
          } catch {}
        }, 0);
      } catch {}
      return _db!;
    } catch {
      // fall through to the legacy forced path below
    }
  }

  try {
    _db = initializeFirestore(fbApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Many restaurant networks / Windows firewalls block Firestore's default
      // WebChannel stream, which makes getDoc() hang during login. Force the
      // reliable HTTP long-polling transport so account/device checks return
      // quickly instead of waiting 20–25 seconds.
      experimentalForceLongPolling: true,
      experimentalLongPollingOptions: { timeoutSeconds: 5 },
    } as any);
  } catch {
    _db = getFirestore(fbApp());
  }
  return _db!;
}

let _storage: FirebaseStorage | null = null;
export function fbStorage(): FirebaseStorage {
  if (_storage) return _storage;
  _storage = getStorage(fbApp());
  return _storage;
}
