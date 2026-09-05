// ============================================================================
// One profile photo uploader — customer, rider, order taker.
//
// REPORTED: "customer me pic lgana ha but nzr nhi aya", and "rider ka profile
// me pic lga sky apna name wgara b, or asy he order taker b".
//
// The customer upload already existed and worked on the website. It went to a
// TanStack server function, which lives on the WEBSITE'S OWN ORIGIN — and
// inside the packaged Android app the WebView is not serving that origin, so
// the request had nowhere to land. No error was shown, the photo simply never
// appeared, which is exactly what was reported.
//
// It now goes to a Supabase Edge Function instead. That origin is the one
// every surface already talks to: the website, the Windows app, and all three
// APKs. The server function is kept as a fallback for the website, so nothing
// that works today stops working.
//
// The browser never writes to storage: the customer-photos bucket has a public
// READ policy and no write policy at all. The Edge Function verifies the token
// with Postgres, and IT chooses the path — so no caller can overwrite somebody
// else's picture.
// ============================================================================
import { supabase } from '@/integrations/supabase/client';

export type PhotoKind = 'customer' | 'staff';
export type PhotoResult = { ok: true; url: string } | { ok: false; reason: string };

/** 2 MB — the bucket's own file_size_limit. Checked here so the user is told
 *  before a slow upload rather than after it. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoType = typeof ALLOWED[number];

/** What to show a person for each reason the server can return. */
export function photoErrorMessage(reason: string): string {
  const map: Record<string, string> = {
    no_session: 'Please sign in again, then try the photo once more.',
    inactive: 'This account is no longer active.',
    too_large: 'That photo is too large — please choose one under 2 MB.',
    bad_type: 'Please choose a JPG, PNG or WEBP image.',
    not_an_image: 'That file is not an image.',
    empty: 'That file appears to be empty.',
    app_disabled: 'The customer app is switched off for this restaurant.',
    bad_photo_url: 'The photo could not be saved. Please try again.',
    upload_failed: 'The photo could not be uploaded. Check your internet and try again.',
    save_failed: 'The photo uploaded but could not be saved. Please try again.',
    not_configured: 'Photo upload is not configured on the server yet.',
  };
  return map[reason] ?? 'The photo could not be saved.';
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.onload = () => {
      const s = String(fr.result || '');
      const at = s.indexOf(',');
      // The Edge Function wants the payload WITHOUT the data: prefix.
      resolve(at >= 0 ? s.slice(at + 1) : s);
    };
    fr.readAsDataURL(file);
  });
}

/**
 * Upload a profile photo and record it against the signed-in person.
 * `token` is the opaque session token — a customer's or a staff portal's.
 * Never throws: every failure comes back as { ok: false, reason }, because a
 * silent catch here is how the photo went missing in the first place.
 */
export async function uploadProfilePhoto(opts: {
  kind: PhotoKind;
  token: string;
  file: File;
}): Promise<PhotoResult> {
  const { kind, token, file } = opts;

  if (!token) return { ok: false, reason: 'no_session' };
  if (!ALLOWED.includes(file.type as PhotoType)) return { ok: false, reason: 'bad_type' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' };

  let base64: string;
  try { base64 = await toBase64(file); }
  catch { return { ok: false, reason: 'empty' }; }

  // --- the Edge Function: reachable from the website, Windows and the APKs ---
  try {
    const { data, error } = await supabase.functions.invoke('profile-photo', {
      body: { kind, token, contentType: file.type, base64 },
    });
    const r = data as PhotoResult | null;
    if (r?.ok) return r;
    // A refusal WITH a reason is the server's answer — report it, do not retry
    // somewhere else and confuse two different failures.
    if (r && !r.ok && r.reason) return r;
    if (error && kind === 'staff') {
      // A staff photo has no second route; say so rather than failing silently.
      return { ok: false, reason: 'upload_failed' };
    }
  } catch {
    if (kind === 'staff') return { ok: false, reason: 'upload_failed' };
  }

  // --- website fallback: the original server function, still there ----------
  try {
    const { uploadCustomerPhoto } = await import('@/lib/customerPhoto.functions');
    const r = await uploadCustomerPhoto({
      data: { token, contentType: file.type as PhotoType, base64 },
    });
    return r as PhotoResult;
  } catch {
    return { ok: false, reason: 'upload_failed' };
  }
}
