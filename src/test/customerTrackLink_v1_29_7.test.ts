// ============================================================================
// v1.29.7 — a per-order tracking link the customer can send to someone else.
//
// REPORTED: "customer portal me har order ka clickable tracking link ho, jis
// par delivery order ka rider location dikhe."
//
// #/track has accepted ?o= and ?p= and auto-searched on open since it was
// written, and CustomerOrderTracker already draws the rider on a map. What was
// missing was anything that handed the customer that URL.
//
// The two files have to agree on the shape of the link, and this is what holds
// them together. Assertions read the source with comments stripped.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

const ORDER = src('src/pages/OnlineOrderPage.tsx');
const TRACK = src('src/pages/TrackOrderPage.tsx');

describe('the link the customer portal produces', () => {
  it('is built from the tenant, the order number and the phone', () => {
    expect(ORDER).toContain('#/track/${tid}?o=${o.orderNumber}&p=${last4}');
  });

  it('carries only the last four digits of the phone', () => {
    const at = ORDER.indexOf('const trackLinkFor');
    expect(at).toBeGreaterThan(-1);
    const fn = ORDER.slice(at, ORDER.indexOf('const shareTrackLink'));
    expect(fn).toContain(".slice(-4)");
    // A link with a partial number is no weaker than the page's own form,
    // which asks for exactly that. A full number would be.
    expect(fn).not.toMatch(/p=\$\{[^}]*account\?\.phone\}/);
  });

  it('produces nothing rather than a broken link when it cannot', () => {
    const at = ORDER.indexOf('const trackLinkFor');
    const fn = ORDER.slice(at, ORDER.indexOf('const shareTrackLink'));
    expect(fn).toContain('if (!tid || !o?.orderNumber || last4.length < 4) return null;');
    // and the button is only rendered when there IS a link
    expect(ORDER).toContain('{trackLinkFor(o) && (');
  });

  it('shares natively on a phone and falls back twice on anything else', () => {
    const at = ORDER.indexOf('const shareTrackLink');
    const fn = ORDER.slice(at, at + 1200);
    expect(fn).toContain('nav.share');
    expect(fn).toContain('navigator.clipboard.writeText');
    expect(fn).toContain('window.prompt');
  });
});

describe('the page the link opens honours it', () => {
  it('reads o and p out of the hash query', () => {
    expect(TRACK).toContain("sp.get('o')");
    expect(TRACK).toContain("sp.get('p')");
  });

  it('searches by itself, so the link lands on the order and not on a form', () => {
    expect(TRACK).toContain('if (ready && initial.o && !order) findOrder();');
  });

  it('matches on the last four digits, the way the link supplies them', () => {
    expect(TRACK).toContain("const last4 = phoneLast.replace(/\\D/g, '').slice(-4);");
  });

  it('still draws the rider for a delivery order', () => {
    expect(TRACK).toContain('DeliveryRouteMap');
  });
});
