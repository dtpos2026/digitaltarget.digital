// v1.109.0 — the DT Owner APK declares itself like the Rider and Order Taker APKs, so a restored WebView cannot land on the
// full POS and its email login.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyAppEntry, portalAppFromQuery, rememberedPortalApp } from '@/lib/appEntry';

const go = (url: string) => window.history.replaceState(null, '', url);
beforeEach(() => { localStorage.clear(); go('/'); });

describe('?app=owner', () => {
  it('is recognised, and the other markers still are', () => {
    expect(portalAppFromQuery('?app=owner')).toBe('owner');
    expect(portalAppFromQuery('?app=rider')).toBe('rider');
    expect(portalAppFromQuery('?app=admin')).toBeNull();
  });

  it('a restore with no fragment goes to the Owner app, not the POS login', () => {
    go('/?app=owner');
    expect(applyAppEntry()).toBe('owner');
    expect(window.location.hash).toBe('#/owner-app');
  });

  it('a deeper route inside the Owner app is left alone', () => {
    go('/?app=owner#/owner-app/orders');
    applyAppEntry();
    expect(window.location.hash).toBe('#/owner-app/orders');
  });

  it("another app's route is corrected to the Owner app", () => {
    go('/?app=owner#/rider-portal');
    applyAppEntry();
    expect(window.location.hash).toBe('#/owner-app');
  });

  it('remembers itself, so a load with neither marker nor route still opens the Owner app', () => {
    go('/?app=owner');
    applyAppEntry();
    go('/');
    expect(rememberedPortalApp()).toBe('owner');
    expect(applyAppEntry()).toBe('owner');
    expect(window.location.hash).toBe('#/owner-app');
  });

  it('the website is untouched: no marker, nothing remembered, no redirect', () => {
    go('/#/dashboard');
    expect(applyAppEntry()).toBeNull();
    expect(window.location.hash).toBe('#/dashboard');
  });

  it('the Owner config opens the app with the marker', () => {
    const cfg = JSON.parse(readFileSync('capacitor.owner.config.json', 'utf8'));
    expect(cfg.server.url).toBe('https://digitaltarget.digital/?app=owner#/owner-app');
    expect(cfg.appId).toBe('com.digitaltarget.dtowner');
  });
});
