// ============================================================================
// Am I running inside the packaged Android app, or in a browser?
//
// v1.30.0 — this used to live in pushNotifications.ts, which has been deleted
// along with FCM. The question itself has nothing to do with notifications:
// the update gate asks it too, because a website is never behind itself.
//
// One line of Capacitor, guarded, because the SAME bundle serves the public
// ordering website, where Capacitor is not present at all.
// ============================================================================

/** True only inside the packaged Android app. */
export function isNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() === true;
  } catch {
    return false;
  }
}
