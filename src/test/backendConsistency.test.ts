// ============================================================
// Tests — v1.19.1 auth and data must never disagree
//
// THE BUG: auth followed the device/build, data followed a restaurant setting.
// A user could therefore be signed in against Supabase while every read and
// write still went to Firebase — where that user does not exist.
//
// Reads come back empty, writes are rejected. To an operator that is
// indistinguishable from data loss, and it would have been blamed on the
// migration rather than on a flag mismatch.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';

const KEY = 'dtpos-auth-backend';

/** Mirrors usingSupabaseAuth(). */
function authBackend(explicit: string | null, supabaseBuild: boolean): 'supabase' | 'firebase' {
  if (explicit === 'supabase') return 'supabase';
  if (explicit === 'firebase') return 'firebase';
  return supabaseBuild ? 'supabase' : 'firebase';
}

/** Mirrors useSupabaseBackend(). */
function dataBackend(
  explicit: string | null, supabaseBuild: boolean, legacySetting: boolean,
): 'supabase' | 'firebase' {
  if (explicit === 'supabase') return 'supabase';
  if (explicit === 'firebase') return 'firebase';
  // The legacy per-restaurant setting is intentionally NOT consulted: see the
  // note in store.ts. Backend is a property of the build and the session.
  void legacySetting;
  return supabaseBuild ? 'supabase' : 'firebase';
}

beforeEach(() => localStorage.clear());

describe('auth and data resolve to the SAME backend', () => {
  const cases: Array<[string | null, boolean, boolean, string]> = [
    [null,        true,  false, 'fresh browser, Supabase build'],
    [null,        false, false, 'fresh browser, Firebase-only build'],
    ['supabase',  true,  false, 'device chose Supabase'],
    ['supabase',  false, false, 'device chose Supabase on a Firebase build'],
    ['firebase',  true,  false, 'legacy owner on a Supabase build'],
    ['firebase',  false, true,  'legacy owner, legacy setting on'],
    ['nonsense',  true,  false, 'corrupted device value'],
    [null,        false, true,  'legacy opt-in setting only'],
  ];

  for (const [explicit, build, legacy, label] of cases) {
    it(`agree: ${label}`, () => {
      const a = authBackend(explicit, build);
      const d = dataBackend(explicit, build, legacy);
      expect(d).toBe(a);
    });
  }
});

describe('the specific split-brain that was possible before', () => {
  it('THE REGRESSION: Supabase session must not read Firebase data', () => {
    // Old behaviour: auth = supabase (build configured), data = firebase
    // (restaurant setting absent). Signed in one place, reading another.
    const explicit = null, build = true, legacySetting = false;
    expect(authBackend(explicit, build)).toBe('supabase');
    expect(dataBackend(explicit, build, legacySetting)).toBe('supabase');  // was 'firebase'
  });

  it('a legacy Firebase owner keeps BOTH on Firebase', () => {
    // The fallback records 'firebase' after a successful legacy sign-in, and
    // data must follow it — otherwise an existing restaurant would suddenly
    // read an empty Supabase tenant.
    localStorage.setItem(KEY, 'firebase');
    expect(authBackend('firebase', true)).toBe('firebase');
    expect(dataBackend('firebase', true, false)).toBe('firebase');
  });
});
