// ============================================================
// Tests — every module's data must reach the backend.
//
// REPORTED: "64 sab module ka data backend save ho, storage bhi".
//
// Several modules were still device-only: a browser reset or a second till
// lost them. They are now mirrored into public.module_documents, and picture
// uploads go to cloud storage instead of being inlined as base64 blobs.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MIRRORED_KEYS, MIRRORED_VALUE_KEYS } from '@/lib/cloudDocs';
import { isDocStoreCollection } from '@/lib/supabaseStore';

const read = (p: string) => readFileSync(p, 'utf8');

describe('no module is left device-only', () => {
  it('fraud controls (blocked customers / locations) are mirrored', () => {
    expect(MIRRORED_KEYS).toContain('pos-blocked-customers');
    expect(MIRRORED_KEYS).toContain('pos-blocked-locations');
    expect(read('src/lib/blocklist.ts')).toContain('mirrorList');
  });

  it('single-value modules (template, signatures) are mirrored', () => {
    for (const k of [
      'pos-marketing-template',
      'dt-admin-signature-dataurl',
      'dt-admin-stamp-dataurl',
      'dt-admin-agreement-custom',
    ]) {
      expect(MIRRORED_VALUE_KEYS).toContain(k as any);
    }
  });

  // v1.27.0 — customer accounts are no longer a mirrored blob.
  //
  // `dt-online-accounts-v2` held EVERY customer of a restaurant in one
  // localStorage object, PIN hashes included, and pushed the whole thing to a
  // cloud document. This suite's rule is "no module is left device-only", and
  // accounts now satisfy it far better: one row per customer in the customers
  // table, reachable only with that customer's own session token.
  it('customer accounts live on the server, not in a mirrored blob', () => {
    const page = read('src/pages/OnlineOrderPage.tsx');
    expect(page).not.toContain('ACCOUNTS_REGISTRY_KEY');
    expect(page).not.toContain('upsertRegistry');
    expect(page).toContain('customerLogin');
    expect(page).toContain('customerSignup');
    expect(read('src/lib/customerAccount.ts')).toContain('public_customer_login');
  });

  it('the writers actually call the mirror', () => {
    expect(read('src/lib/store.ts')).toContain('mirrorValue(MARKETING_TPL_KEY');
    expect(read('src/components/ClientAgreementDialog.tsx')).toContain('mirrorValue(SIG_KEY');
  });

  it('waiters and riders persist server-side', () => {
    expect(isDocStoreCollection('waiters')).toBe(true);
    expect(isDocStoreCollection('riders')).toBe(true);
  });
});

describe('pictures go to cloud storage, not into the record', () => {
  it('payment QR and promo images upload instead of inlining base64', () => {
    const s = read('src/pages/SettingsPage.tsx');
    expect(s).toContain("uploadTenantImage(file, 'payment-qr')");
    expect(s).toContain("uploadTenantImage(file, 'promo')");
    expect(s).not.toContain('customQrImage: reader.result');
  });

  it('online portal logo and banner upload to storage', () => {
    const s = read('src/pages/OnlinePortalPage.tsx');
    expect(s).toContain("uploadTenantImage(f, 'web-portal-logo')");
    expect(s).toContain("uploadTenantImage(f, 'online-banner')");
    expect(s).not.toContain('webPortalLogo: String(r.result)');
  });
});
