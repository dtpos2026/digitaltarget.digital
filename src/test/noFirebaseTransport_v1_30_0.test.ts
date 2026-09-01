// ============================================================================
// v1.30.0 — Firebase out. Supabase only.
//
// INSTRUCTED, twice: "Firebase ye q ha?? del — Supabase he lgy."
//
// The Firebase SDK went in v1.24.0. What was left was FCM — Android's push
// transport, reached through @capacitor/push-notifications, which pulls
// com.google.firebase:firebase-messaging into the APK. That is now gone too.
//
// This test is the guard that keeps it gone. It is deliberately about the
// TRANSPORT, not about the legacy Firestore call sites, which are dead code
// behind backend guards and aliased to a stub at build time — see
// vite.config.ts and src/lib/firebaseStub.ts.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

/**
 * Every SHIPPED .ts/.tsx under src — tests excluded.
 *
 * v1.32.0: this used to exclude only itself, and then flagged
 * customerCodeAndPhoto_v1_32_0.test.ts, whose assertions necessarily contain
 * the very strings this guard forbids ("push_token") in order to prove they
 * are gone. A test that checks for an absence has to name the thing. Scanning
 * shipped code only keeps the guard strict where it matters — src/test is not
 * compiled into the bundle — and matches how securityAudit_v1_31_0 already
 * walks the tree.
 */
function sources(dir = resolve(ROOT, 'src'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'test') sources(full, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('the FCM transport is gone and cannot come back quietly', () => {
  it('is not a dependency', () => {
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(all)).not.toContain('@capacitor/push-notifications');
    // and no other Firebase package crept in
    for (const name of Object.keys(all)) {
      expect(name, name).not.toMatch(/^firebase$|^@firebase\//);
    }
  });

  it('has no module importing it', () => {
    const offenders = sources().filter(f =>
      /@capacitor\/push-notifications/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(f => f.replace(ROOT + '/', ''))).toEqual([]);
  });

  it('deleted the modules that existed only to serve it', () => {
    expect(existsSync(resolve(ROOT, 'src/lib/pushNotifications.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'supabase/functions/push-dispatch'))).toBe(false);
  });

  it('kept isNativeApp, which was never about push', () => {
    // The update gate asks the same question: a website is never behind itself.
    expect(existsSync(resolve(ROOT, 'src/lib/nativeApp.ts'))).toBe(true);
    expect(readFileSync(resolve(ROOT, 'src/lib/appUpdate.ts'), 'utf8'))
      .toContain("from './nativeApp'");
  });

  it('leaves no push-token plumbing behind', () => {
    const offenders: string[] = [];
    for (const f of sources()) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      if (/push_token|registerPushToken|customerPushToken|portalPushToken|portalRegisterPush|staff_push_targets/.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the migration removes the right things and spares the rest', () => {
  const SQL = readFileSync(
    resolve(ROOT, 'supabase/migrations/20260831100000_v1_30_0_remove_fcm.sql'), 'utf8',
  ).replace(/^\s*--.*$/gm, '');

  it('drops the FCM-only functions and columns', () => {
    for (const gone of [
      'drop function if exists public.portal_push_token(text, text)',
      'drop function if exists public.staff_push_targets(uuid, text)',
      'drop function if exists public.public_customer_push_token(text, text)',
    ]) expect(SQL).toContain(gone);
    expect(SQL).toContain('alter table public.customers             drop column if exists push_token');
    expect(SQL).toContain('alter table public.staff_portal_sessions drop column if exists push_token');
  });

  it('does NOT touch the OTP path, which was never Firebase', () => {
    // notification_outbox holds channel='sms' OTP rows. claim_notification_batch
    // drains them. Removing those to spite a transport that was never wired
    // would have broken customer sign-in.
    expect(SQL).not.toContain('drop table');
    expect(SQL).not.toContain('drop function if exists public.claim_notification_batch');
    expect(SQL).not.toContain('public_customer_request_otp');
  });

  it('lets the outbox accept the channel the trigger now writes', () => {
    // The first version of this migration applied cleanly and enqueued
    // nothing, because the CHECK allowed only sms/whatsapp/push and the
    // trigger's own exception handler swallowed the violation.
    const at = SQL.indexOf('add constraint notification_outbox_channel_check');
    expect(at).toBeGreaterThan(-1);
    const check = SQL.slice(at, SQL.indexOf(';', at));
    for (const ch of ['sms', 'whatsapp', 'push', 'realtime']) {
      expect(check, ch).toContain(`'${ch}'`);
    }
  });

  it('stops the trigger discarding every status change', () => {
    const at = SQL.indexOf('create or replace function public.enqueue_order_push');
    const body = SQL.slice(at, SQL.indexOf('$function$;', at));
    // the token lookup that made this a no-op is gone
    expect(body).not.toContain('c.push_token');
    expect(body).not.toContain('if v_push is null');
    expect(body).toContain("'realtime'");
    expect(body).toContain("new.customer_id::text");
    // an alert must never be the reason an order fails to save
    expect(body).toContain('exception when others then');
  });

  it('drops the FCM half of settle_notification and keeps the retry half', () => {
    expect(SQL).toContain('drop function if exists public.settle_notification(uuid, boolean, text, boolean)');
    const at = SQL.indexOf('create or replace function public.settle_notification');
    const body = SQL.slice(at, SQL.indexOf('$function$;', at));
    expect(body).not.toContain('p_drop_token');
    expect(body).toContain('attempts >= 5');
  });
});
