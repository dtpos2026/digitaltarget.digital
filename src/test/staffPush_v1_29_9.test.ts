// ============================================================================
// v1.29.9 — a rider's and an order taker's phone can be reached.
//
// The customer app has had push since v1.27.x. Staff had nothing: no column,
// no RPC, nowhere for a token to go — so the rider's phone could not be
// addressed at all, whatever was sent.
//
// The token lives on the SESSION, not on the user. staff_portal_sessions is
// per device and it expires, so a sign-out stops the alerts and an ex-
// employee's handset cannot be paged months later. A column on user_profiles
// would have needed hand cleanup at both points, and would not have got it.
//
// Assertions read the sources with comments stripped.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260830160000_v1_29_9_staff_push_tokens.sql'),
  'utf8',
).replace(/^\s*--.*$/gm, '');

function ts(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

const PORTAL = ts('src/lib/portalData.ts');
const RIDER  = ts('src/pages/RiderAppPage.tsx');
const TAKER  = ts('src/pages/OrderTakerPortalPage.tsx');

describe('where the token lives', () => {
  it('hangs off the session, which expires and is per device', () => {
    expect(SQL).toContain('alter table public.staff_portal_sessions');
    expect(SQL).toContain('add column if not exists push_token text');
    // never on the user — that row outlives the device and the employment
    expect(SQL).not.toContain('alter table public.user_profiles');
  });

  it('is written only onto the caller\'s own session', () => {
    const at = SQL.indexOf('create or replace function public.portal_push_token');
    expect(at).toBeGreaterThan(-1);
    const body = SQL.slice(at, SQL.indexOf('$function$;', at));
    expect(body).toContain('portal_identity(p_token)');
    expect(body).toContain('where token_hash = s.token_hash');
    expect(body).toContain("'no_session'");
  });

  it('refuses a token that is obviously not one', () => {
    const at = SQL.indexOf('create or replace function public.portal_push_token');
    const body = SQL.slice(at, SQL.indexOf('$function$;', at));
    expect(body).toContain('length(v_push) > 4096');
    expect(body).toContain("'bad_token'");
  });
});

describe('reading the tokens back', () => {
  it('is service_role only — a browser must never enumerate on-duty riders', () => {
    expect(SQL).toContain(
      'revoke all on function public.staff_push_targets(uuid, text) from public, anon, authenticated');
    expect(SQL).toContain(
      'grant execute on function public.staff_push_targets(uuid, text) to service_role');
  });

  it('skips expired sessions and deactivated staff', () => {
    const at = SQL.indexOf('create or replace function public.staff_push_targets');
    const body = SQL.slice(at, SQL.indexOf('$function$;', at));
    expect(body).toContain('s.expires_at > now()');
    expect(body).toContain('p.is_active');
    expect(body).toContain('s.push_token is not null');
  });

  it('lets the phone file its own token without a Supabase session', () => {
    expect(SQL).toContain(
      'grant execute on function public.portal_push_token(text, text) to anon, authenticated, service_role');
  });
});

describe('the client', () => {
  it('clears the token before the session is destroyed on sign-out', () => {
    const at = PORTAL.indexOf('export async function portalLogout');
    const body = PORTAL.slice(at, at + 700);
    expect(body).toContain('portalPushToken(null)');
    // order matters: once the row is gone there is nothing left to clear
    expect(body.indexOf('portalPushToken(null)')).toBeLessThan(body.indexOf('setPortalToken(null)'));
  });

  it('asks for nothing in a browser', () => {
    const at = PORTAL.indexOf('export async function portalRegisterPush');
    const body = PORTAL.slice(at, PORTAL.length);
    expect(body).toContain('if (!isNativeApp()) return \'skipped\'');
    expect(body).toContain("if (!getPortalToken()) return 'skipped'");
  });

  it('treats a refusal as an answer, not a failure', () => {
    const at = PORTAL.indexOf('export async function portalRegisterPush');
    const body = PORTAL.slice(at);
    expect(body).toContain("return 'denied'");
    expect(body).not.toContain('throw new Error');
  });

  it('never hangs when FCM does not answer', () => {
    const at = PORTAL.indexOf('export async function portalRegisterPush');
    const body = PORTAL.slice(at);
    expect(body).toMatch(/setTimeout\(\(\) => done\('failed'\), \d+\)/);
  });

  it('registers from both staff portals', () => {
    expect(RIDER).toContain('portalRegisterPush');
    expect(TAKER).toContain('portalRegisterPush');
  });

  it('registers once on the rider, whose poll runs every fifteen seconds', () => {
    expect(RIDER).toContain('pushRegisteredRef');
    const at = RIDER.indexOf('if (!pushRegisteredRef.current) {');
    expect(at).toBeGreaterThan(-1);
    const block = RIDER.slice(at, at + 400);
    // the flag is set BEFORE the await, or two polls race into two prompts
    expect(block.indexOf('pushRegisteredRef.current = true'))
      .toBeLessThan(block.indexOf('portalRegisterPush'));
  });
});
