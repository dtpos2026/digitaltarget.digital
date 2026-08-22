// Startup auth verification.
//
// Item 6 + 8 from upgrade plan: on app boot, validate the cached Firebase
// session is real, the tenant doc exists, and the restaurant is active.
// If any check fails -> forceLogoutAndWipe so a stale cache never resurrects
// a deleted/disabled account.

import { fbAuth, fbDb, isFirebaseConfigured, isSuperAdminEmail } from './firebase';
import { doc, getDocFromServer } from 'firebase/firestore';
import { waitForAuthReady, currentAuthUser } from './authProvider';
import { usingSupabaseAuth } from './authProvider';
import { forceLogoutAndWipe } from './sessionIsolation';

let verifying = false;

export async function verifyStartupAuth(opts: { onInvalid?: (reason: string) => void } = {}): Promise<void> {
  // Supabase sessions are validated by the auth adapter and RLS. The Firebase
  // tenant-document check below must never run for them: the compatibility
  // cloud flag is true even though Firebase itself has been removed.
  if (usingSupabaseAuth() || !isFirebaseConfigured() || verifying) return;
  verifying = true;
  try {
    const user = await new Promise<any>((resolve) => {
      // v1.18.0 — adapter resolves from whichever backend is active.
      waitForAuthReady().then(() => resolve(currentAuthUser() as any));
      // Safety timeout — if auth never resolves in 8s, assume signed-out.
      setTimeout(() => resolve(currentAuthUser() as any ?? null), 8000);
    });
    if (!user) return; // signed out — nothing to verify
    if (isSuperAdminEmail(user.email || '')) return; // super admin — skip tenant check

    // Tenant doc must exist + be active + approved.
    const ref = doc(fbDb(), 'tenants', user.uid);
    let snap;
    try { snap = await getDocFromServer(ref); }
    catch (e) {
      // Network failure: do NOT wipe — user may simply be offline.
      console.warn('[startupVerify] tenant fetch failed, skipping', e);
      return;
    }
    if (!snap.exists()) {
      await forceLogoutAndWipe('Restaurant account not found. Please contact support.');
      opts.onInvalid?.('not_found');
      return;
    }
    const data = snap.data() as any;
    const status = (data?.status || 'active').toLowerCase();
    if (status === 'disabled' || status === 'suspended' || status === 'deleted') {
      await forceLogoutAndWipe(`Account is ${status}. Please contact Digital Target support.`);
      opts.onInvalid?.(status);
      return;
    }
    if (data?.restaurantApproved === false) {
      await forceLogoutAndWipe('Restaurant account is not approved yet.');
      opts.onInvalid?.('not_approved');
      return;
    }
  } finally {
    verifying = false;
  }
}
