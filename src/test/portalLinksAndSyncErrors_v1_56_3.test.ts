// ============================================================================
// v1.56.3 — two things the operator photographed on their own till
//
// 1. TWO SCREENS, TWO DIFFERENT LINKS FOR THE SAME RESTAURANT
//
//    REPORTED: "ye sar portel sath link name wala ha, khi b dosry browser open
//    py data nhi ata ... just ak portel hota jo dusra pic ha us me thek han ...
//    equal type link ho".
//
//    Customer Portal / Websites handed out  /#/order/first-chef-pizza-burger
//    Settings -> Online Ordering handed out /#/order/64434fd6-3ea7-...
//
//    v1.42.0 changed the first to the readable slug and left the second alone,
//    so one restaurant advertised two different links from two screens — and
//    the operator could see for themselves which one opened in a fresh
//    browser. Both now hand out the id form: it is what every printed QR,
//    every APK and every saved bookmark already carries, and it needs no
//    lookup before the page can read anything.
//
//    NOT a server fault: public_tenant_by_slug('first-chef-pizza-burger')
//    answers correctly for anon, verified on the live database. Slug links
//    already shared still resolve; they are simply not what we generate.
//
// 2. A REJECTION THAT COULD NEVER SUCCEED, RETRIED SIX TIMES
//
//    REPORTED, as a toast mid-service: "Sync rejected (save
//    branches/mqpll26zktfpb1): new row violates row-level security policy
//    (USING expression) for table branches".
//
//    The cloud id is derived from the LOCAL id alone, so a record carried over
//    from another restaurant lands on that restaurant's row and RLS refuses
//    it. Verified: stableUuid('mqpll26zktfpb1') is
//    eb03f551-c836-5f50-a2f9-2c931ea522b2, a branch owned by a different
//    tenant. Isolation working as designed — the record is not this
//    restaurant's to save.
//
//    cloudFail() has classified this as "permanent" since v1.22.0, but the
//    queue never asked, so it burned six attempts on a backoff stretching to
//    five minutes, showing the same alarming sentence each round.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPermanentSyncError, explainSyncError } from '@/lib/syncErrors';
import { stableUuid } from '@/lib/supabaseStore';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const portal   = stripTs(read('src/pages/OnlinePortalPage.tsx'));
const settings = stripTs(read('src/pages/SettingsPage.tsx'));

const RLS_USING =
  'new row violates row-level security policy (USING expression) for table "branches"';

describe('both screens hand out the same link', () => {
  it('the portal page builds its links from the tenant id', () => {
    expect(portal).toContain('const tidSeg = tid ? `/${tid}` : \'\';');
  });

  it('no portal link is built from a slug any more', () => {
    // The whole point: one restaurant, one link. A leftover slug here would
    // put the two screens back out of step.
    expect(portal).not.toMatch(/\$\{slug\}/);
    expect(portal).not.toContain('slug ? `/${slug}`');
  });

  it('and Settings still builds the same shape, so the two agree', () => {
    expect(settings).toContain('`${origin}/#/order/${tid}`');
  });
});

describe('the derived id really does land on another restaurant', () => {
  it('reproduces the exact collision from the till', () => {
    // This is the measurement the fix rests on, kept executable so it cannot
    // quietly stop being true.
    expect(stableUuid('mqpll26zktfpb1'))
      .toBe('eb03f551-c836-5f50-a2f9-2c931ea522b2');
  });
});

describe('a rejection that can never succeed is recognised', () => {
  it('an RLS refusal is permanent', () => {
    expect(isPermanentSyncError({ message: RLS_USING })).toBe(true);
    expect(isPermanentSyncError({ code: '42501' })).toBe(true);
  });

  it('a network or server blip is NOT permanent, so it still retries', () => {
    // Getting this wrong would be far worse than the bug: a till that parks
    // its bills on one flaky request loses them from the queue.
    expect(isPermanentSyncError({ message: 'Failed to fetch' })).toBe(false);
    expect(isPermanentSyncError({ message: 'network timeout' })).toBe(false);
    expect(isPermanentSyncError({ code: '503' })).toBe(false);
    expect(isPermanentSyncError({})).toBe(false);
  });
});

describe('the message says what it means', () => {
  it('names the real cause instead of quoting Postgres', () => {
    const out = explainSyncError(RLS_USING);
    expect(out).toContain('belongs to a different restaurant');
    expect(out).not.toContain('USING expression');
    expect(out).not.toContain('row-level security');
  });

  it('says plainly that nothing was damaged', () => {
    expect(explainSyncError(RLS_USING)).toContain('Nothing was changed');
  });

  it('a plain permission refusal reads differently from a wrong-owner one', () => {
    const other = explainSyncError('permission denied for table orders', '42501');
    expect(other).toContain('not allowed to write');
    expect(other).not.toContain('belongs to a different restaurant');
  });

  it('an unrecognised message is passed through rather than invented', () => {
    expect(explainSyncError('some brand new postgres error')).toBe('some brand new postgres error');
  });
});

describe('the queue stops retrying what it already knows is hopeless', () => {
  const ds = stripTs(read('src/lib/deferredSync.ts'));

  it('parks a permanent failure on the first attempt', () => {
    expect(ds).toContain('cur.attempts = permanent ? MAX_ATTEMPTS : (cur.attempts || 0) + 1;');
  });

  it('asks on both the single and the batched path', () => {
    expect(ds).toContain('isPermanentFailure(e)');
    expect(ds).toContain('isPermanentFailure({ message: why })');
  });

  it('still parks it rather than dropping it — nothing is lost silently', () => {
    expect(ds).toContain("localDb.putRow('deferredOpsDeadLetter'");
  });
});
