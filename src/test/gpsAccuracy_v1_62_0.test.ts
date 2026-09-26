// ============================================================================
// v1.62.0 — "accorate pin loacition q nhi btata ... on time location"
//
// Three separate faults, and the first is the worst kind: a documented option
// that was never read.
//
//  1. getBrowserLocation() promised, in its own doc comment, "stop early once
//     accuracy <= this many meters (default 50m)". The body never mentioned
//     opts.desiredAccuracyM. It resolved on the FIRST fix the browser offered,
//     so a 2 km network estimate and a 5 m GPS fix were treated identically,
//     and every caller passing that option was passing it into nothing.
//
//  2. It asked for STALE positions on purpose: maximumAge 60000 on the fast
//     path, 300000 on the fallback. A rider on the move was placed where they
//     had been up to five minutes earlier.
//
//  3. The accuracy never left the function, so no screen could say a pin was
//     a kilometre out — and a rider is sent to that pin.
//
// The device heartbeat, which draws the dot on the Super Admin map, was wrong
// twice over: enableHighAccuracy unset (so FALSE — wifi/cell triangulation)
// and maximumAge 300000.
//
// One correction to my own first reading, recorded because it changed what I
// touched: staffLocation.captureOnce() ALREADY passed enableHighAccuracy and
// already recorded accuracyM. Only its maximumAge (30s) was wrong for a moving
// rider. I had started to "fix" what was not broken.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeAccuracy } from '@/lib/geo';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const geo    = stripTs(read('src/lib/geo.ts'));
const sync   = stripTs(read('src/lib/supabaseSync.ts'));
const staff  = stripTs(read('src/lib/staffLocation.ts'));
const picker = stripTs(read('src/components/LocationCapture.tsx'));

describe('the accuracy target is actually honoured now', () => {
  it('reads the option it documents', () => {
    expect(geo).toContain('const desired = opts.desiredAccuracyM ?? 50;');
    expect(geo).toContain('<= desired) finish();');
  });

  it('waits for better fixes instead of taking the first', () => {
    // A GPS chip reports progressively better fixes; asking once gets the
    // worst one.
    expect(geo).toContain('navigator.geolocation.watchPosition(');
    expect(geo).toContain('clearWatch');
  });

  it('keeps the tightest fix, not merely the newest', () => {
    expect(geo).toContain('< (best.coords.accuracy ?? Infinity)');
  });

  it('returns the best seen when the deadline passes, rather than nothing', () => {
    expect(geo).toContain('const timer = setTimeout(finish, timeoutMs);');
  });

  it('gives up immediately when permission is refused', () => {
    // Waiting out a 15s timeout on a denial only makes the screen feel broken.
    expect(geo).toContain('PERMISSION_DENIED');
  });
});

describe('no screen is handed a stale position', () => {
  it('the shared helper never accepts a cached fix', () => {
    expect(geo).toContain('maximumAge: 0');
    expect(geo).not.toContain('maximumAge: 300000');
    expect(geo).not.toContain('maximumAge: 60000');
  });

  it('the device heartbeat asks for GPS and refuses the cache', () => {
    expect(sync).toContain('enableHighAccuracy: true, timeout: 12000, maximumAge: 0');
    expect(sync).not.toContain('{ timeout: 8000, maximumAge: 300000 }');
  });

  it('a moving rider is not drawn where they were 30 seconds ago', () => {
    expect(staff).toContain('enableHighAccuracy: true, timeout: 15000, maximumAge: 0');
  });
});

describe('the operator can judge the pin, not just see it', () => {
  it('accuracy comes back with the position', () => {
    expect(geo).toContain('export interface LocationFix');
    expect(geo).toContain('approximate: accuracyM > desired');
  });

  it('describes a fix in words a person can act on', () => {
    expect(describeAccuracy(8)).toContain('GPS pin');
    expect(describeAccuracy(60)).toContain('Good');
    expect(describeAccuracy(300)).toContain('move outside');
    expect(describeAccuracy(2400)).toContain('not GPS');
  });

  it('says kilometres when it is kilometres', () => {
    expect(describeAccuracy(2400)).toContain('2.4 km');
  });

  it('does not invent a number it does not have', () => {
    expect(describeAccuracy(Number.POSITIVE_INFINITY)).toBe('Accuracy unknown');
  });

  it('the pin picker shows it, and warns when it is poor', () => {
    expect(picker).toContain('describeAccuracy(accuracy)');
    expect(picker).toContain('fix.accuracyM > 500');
  });
});
