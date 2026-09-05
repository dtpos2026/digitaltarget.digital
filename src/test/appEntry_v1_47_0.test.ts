// ============================================================================
// v1.47.0 — a portal APK must never open somebody else's screen.
//
// REPORTED, about the Order Taker APK: "refresh krny py Rider Portal khul jata
// hai" and "logout pe main software ka email login aa jata hai".
//
// One fault, seen twice: the ONLY thing that said which portal to show was the
// URL fragment, and Android drops the fragment on a WebView restore. These
// tests drive the real function against a real location.
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyAppEntry, portalAppFromQuery, rememberedPortalApp, clearPortalApp } from '@/lib/appEntry';

function go(url: string) {
  // jsdom allows a same-origin navigation via replace()
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  localStorage.clear();
  go('/');
});

describe('the packaged app states which app it is on every load', () => {
  it('reads the marker out of the query', () => {
    expect(portalAppFromQuery('?app=order-taker')).toBe('order-taker');
    expect(portalAppFromQuery('?app=rider')).toBe('rider');
    expect(portalAppFromQuery('?app=customer')).toBe('customer');
  });

  it('ignores anything it does not recognise', () => {
    expect(portalAppFromQuery('?app=admin')).toBeNull();
    expect(portalAppFromQuery('?app=')).toBeNull();
    expect(portalAppFromQuery('')).toBeNull();
  });
});

describe('the Order Taker APK cannot land anywhere else', () => {
  it('a restore with no fragment goes to the Order Taker, not the POS login', () => {
    go('/?app=order-taker');
    expect(applyAppEntry()).toBe('order-taker');
    expect(window.location.hash).toBe('#/order-taker');
  });

  it('a load that somehow carries the Rider route is corrected', () => {
    go('/?app=order-taker#/rider-portal');
    applyAppEntry();
    expect(window.location.hash).toBe('#/order-taker');
  });

  it('a deeper route inside its own app is left alone', () => {
    // Resetting to the first tab on every reload would be its own bug.
    go('/?app=order-taker#/order-taker/abc-123/tables');
    applyAppEntry();
    expect(window.location.hash).toBe('#/order-taker/abc-123/tables');
  });

  it('remembers itself, so a load with neither marker nor route still works', () => {
    go('/?app=order-taker#/order-taker');
    applyAppEntry();
    expect(rememberedPortalApp()).toBe('order-taker');

    go('/');
    expect(applyAppEntry()).toBe('order-taker');
    expect(window.location.hash).toBe('#/order-taker');
  });
});

describe('the Rider APK is held to the same rule', () => {
  it('goes to the Rider Portal, never the Order Taker', () => {
    go('/?app=rider#/order-taker');
    applyAppEntry();
    expect(window.location.hash).toBe('#/rider-portal');
  });
});

describe('the website is not hijacked', () => {
  it('a plain visit with no marker and no memory is left alone', () => {
    go('/');
    expect(applyAppEntry()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('a real page request is never redirected, even with a memory', () => {
    // Someone who once opened the rider portal in this browser must still be
    // able to use the POS in it.
    go('/?app=rider#/rider-portal');
    applyAppEntry();
    go('/#/settings');
    applyAppEntry();
    expect(window.location.hash).toBe('#/settings');
  });

  it('forgetting is possible, for a sign-out that resets the install', () => {
    go('/?app=rider#/rider-portal');
    applyAppEntry();
    clearPortalApp();
    go('/');
    expect(applyAppEntry()).toBeNull();
    expect(window.location.hash).toBe('');
  });
});

describe('the entry runs before anything reads the hash', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

  it('is called at module scope in App.tsx, not inside the component', () => {
    const callAt = app.indexOf('\napplyAppEntry();');
    const componentAt = app.search(/\nconst App\b|\nfunction App\b/);
    expect(callAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(componentAt);
  });
});

describe('signing out of a portal ends the SERVER session, not just the screen', () => {
  const strip = (f: string) =>
    readFileSync(resolve(process.cwd(), f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  it('the Order Taker calls portalLogout', () => {
    // Clearing the local user while leaving a thirty-day token on the phone
    // means the screen says "signed out" and the device can still read this
    // restaurant's menu, tables, orders and customers.
    expect(strip('src/pages/OrderTakerPortalPage.tsx')).toContain('portalLogout');
  });

  it('the Rider calls portalLogout', () => {
    expect(strip('src/pages/RiderAppPage.tsx')).toContain('portalLogout');
  });

  it('portalLogout deletes the session server-side and forgets the restaurant', () => {
    const lib = strip('src/lib/portalData.ts');
    expect(lib).toContain("rpc('portal_logout'");
    expect(lib).toContain("removeItem('dt-restaurant-identity')");
  });
});
