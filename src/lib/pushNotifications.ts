/**
 * Push notifications for the white-label customer app — v1.28.0
 *
 * Android only, through Capacitor + FCM. On the website this module is inert:
 * `Capacitor.isNativePlatform()` is false in a browser, so nothing is imported,
 * nothing is registered, and no permission prompt appears. That matters —
 * the same bundle serves the public ordering site.
 *
 * The token is stored on the customer's own row by `public_customer_push_token`,
 * which only ever writes the row belonging to the session token. Delivery is
 * handled by the `push-dispatch` edge function reading `notification_outbox`;
 * nothing here talks to FCM directly.
 */
import { customerPushToken, getCustomerToken } from '@/lib/customerAccount';

export type PushOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: 'not_native' | 'denied' | 'no_session' | 'unsupported' | 'error'; message: string };

/** True only inside the packaged Android app. */
export function isNativeApp(): boolean {
  try {
    const cap = (globalThis as any).Capacitor;
    return !!cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() === true;
  } catch {
    return false;
  }
}

let registered = false;
let lastToken = '';

/**
 * Ask for notification permission and hand the FCM token to the server.
 *
 * Android 13+ (API 33) requires the runtime POST_NOTIFICATIONS grant;
 * `requestPermissions()` is what raises that dialog, and on older Android it
 * resolves as already-granted. Call this only after the customer has signed
 * in — a permission prompt on first launch, before they have any reason to
 * want alerts, is the fastest way to get permanently denied.
 */
export async function registerPushNotifications(tenantId?: string | null): Promise<PushOutcome> {
  if (!isNativeApp()) {
    return { ok: false, reason: 'not_native', message: 'Push notifications are only available in the app.' };
  }
  if (!getCustomerToken(tenantId)) {
    return { ok: false, reason: 'no_session', message: 'Sign in before turning on notifications.' };
  }

  let PushNotifications: any;
  try {
    ({ PushNotifications } = await import('@capacitor/push-notifications'));
  } catch {
    return { ok: false, reason: 'unsupported', message: 'This build does not include push notifications.' };
  }

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return { ok: false, reason: 'denied', message: 'Notifications are turned off for this app.' };
    }

    const token = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
      // FCM hands the token back through an event, not a return value.
      void PushNotifications.addListener('registration', (t: { value: string }) => {
        done(() => resolve(String(t?.value || '')));
      });
      void PushNotifications.addListener('registrationError', (e: unknown) => {
        done(() => reject(new Error(String((e as any)?.error ?? 'registration failed'))));
      });
      void PushNotifications.register();
      setTimeout(() => done(() => reject(new Error('timed out waiting for a device token'))), 20_000);
    });

    if (!token) return { ok: false, reason: 'error', message: 'No device token was issued.' };

    // Re-posting the same token on every launch is wasted work.
    if (!registered || token !== lastToken) {
      const saved = await customerPushToken(token, tenantId);
      if (!saved.ok) return { ok: false, reason: 'error', message: saved.message };
      registered = true;
      lastToken = token;
    }
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: String(e?.message ?? 'Could not enable notifications.') };
  }
}

/**
 * Route a tapped notification. The payload carries `orderId`, so tapping
 * "Your order is on the way" opens that order rather than the home screen.
 */
export async function attachPushHandlers(onOpenOrder: (orderId: string) => void): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    void PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
      const id = action?.notification?.data?.orderId;
      if (typeof id === 'string' && id) onOpenOrder(id);
    });
  } catch {
    /* the plugin is absent on web — nothing to attach */
  }
}

/** Detach this device from the customer's row, e.g. on logout. */
export async function clearPushToken(tenantId?: string | null): Promise<void> {
  registered = false;
  lastToken = '';
  if (!getCustomerToken(tenantId)) return;
  try { await customerPushToken('', tenantId); } catch { /* best effort */ }
}
