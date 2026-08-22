// ============================================================================
// BUILD STAMP
//
// ===== WHY THIS EXISTS =====
// A whole day was lost to one question that should have taken ten seconds:
// "is the deployed site actually running the new build?"
//
// Database fixes take effect immediately, but CODE fixes only apply once the
// bundle is redeployed — and there was no way to tell the two apart from the
// outside. The evidence had to be inferred from the shape of synced rows.
//
// This prints an identifiable line to the browser console on boot. Open
// devtools on the live site and you can read the build in one glance.
//
// The string below is deliberately unminifiable (a plain string literal in a
// console call), so it also survives into dist/ and can be grepped there.
// ============================================================================

export const BUILD_ID = 'DT-POS-1.25.21';

export const BUILD_INCLUDES = [
  'cloudFk-foreign-key-mapping',      // v1.25.19 — FKs derive, never null out
  'settings-save-no-throw',           // v1.25.16 — branding survives a mirror failure
  'cloudflare-workers-env-bindings',  // v1.25.11 — service role key is readable
  'order-document-columns',           // v1.25.15 — orders/items/payments accept writes
  'fail-safe-sync-merge',             // v1.25.21 — never drop a row on uncertainty
] as const;

export function logBuildStamp(): void {
  try {
    console.info(
      `%c${BUILD_ID}%c  ${BUILD_INCLUDES.join(' | ')}`,
      'background:#4f46e5;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
      'color:#666',
    );
  } catch { /* console unavailable — never let a diagnostic break boot */ }
}
