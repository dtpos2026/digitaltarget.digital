// v1.111.0 — each phone app opens on its own start screen; the software's splash is never shown inside an app; and the
// page is painted in the app's colour from the first frame (no restaurant-purple flash).
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import AppSplash, { AppSplashArt, appBrand } from '@/components/AppSplash';
import { appSplashKind } from '@/lib/appEntry';
import { APP_BOOT_COLORS, BOOT_THEME_SCRIPT } from '@/lib/bootTheme';
import { BRAND_APPS } from '@/lib/brand';

const read = (f: string) => readFileSync(f, 'utf8');
afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-public-route');
  document.documentElement.removeAttribute('data-app');
  location.hash = '';
  window.history.replaceState(null, '', '/');
});

describe('which app is this load', () => {
  it('the packaged app says so with ?app=, a browser visit says so with the route, the website and the till say nothing', () => {
    expect(appSplashKind('', '?app=owner')).toBe('owner');
    expect(appSplashKind('#/order-taker', '?app=rider')).toBe('rider');     // the marker wins over a stale fragment
    expect(appSplashKind('#/owner-app/inventory', '')).toBe('owner');
    expect(appSplashKind('#/rider-portal/abcd', '')).toBe('rider');
    expect(appSplashKind('#/order-taker/abcd/tables', '')).toBe('order-taker');
    expect(appSplashKind('#/order/abcd1234', '')).toBeNull();               // the customer site
    expect(appSplashKind('#/', '')).toBeNull();                              // the till
    expect(appSplashKind('', '?app=customer')).toBeNull();                   // the parked Customer app has no start screen of its own
  });
});

describe('the start screens', () => {
  it.each([['owner', 'DT Owner'], ['rider', 'DT Rider'], ['order-taker', 'DT Order Taker']] as const)('%s: its own name, colour and symbol, and "Powered by Digital Target"', (app, name) => {
    render(<AppSplashArt app={app} />);
    const el = screen.getByRole('status', { name: `${name} is starting` });
    expect(el).toHaveTextContent(name);
    expect(el).toHaveTextContent('Powered by Digital Target');
    expect(el.getAttribute('data-app-splash')).toBe(app);
    expect(el.querySelector('[data-app-splash-tile] svg')).toBeTruthy();       // the app's symbol
    expect(el.querySelectorAll('[data-dt-mark]').length).toBe(1);               // the 4-triangle mark: once, small, at the foot
    expect(el.querySelector('[data-dt-mark]')!.getAttribute('width')).toBe('14');
  });
  it('the three apps are three different colours, taken from the brand file', () => {
    const colours = (['owner', 'rider', 'order-taker'] as const).map(a => appBrand(a).mid);
    expect(new Set(colours).size).toBe(3);
    expect(appBrand('rider').mid).toBe(BRAND_APPS.find(a => a.id === 'rider')!.accent.mid);
  });
  it('it goes by itself after its time, and a touch skips it', () => {
    let done = 0;
    const { unmount } = render(<AppSplash app="rider" onDone={() => { done++; }} duration={20} />);
    fireEvent.pointerDown(window);
    expect(done).toBeGreaterThanOrEqual(1);
    unmount();
    let timed = 0;
    render(<AppSplash app="owner" onDone={() => { timed++; }} duration={15} />);
    return act(async () => { await new Promise(r => setTimeout(r, 60)); }).then(() => expect(timed).toBe(1));
  });
});

describe('the software\'s splash stays out of the apps', () => {
  const app = read('src/App.tsx');
  it('App draws the app splash first and never the software splash while inside an app', () => {
    expect(app).toContain('const appKind = appSplashKind();');
    expect(app).toContain('if (appKind && !appSplashDone) {');
    expect(app).toContain('if (showSplash && !isPublicOrderRoute && !appKind) {');
    expect(app.indexOf('if (appKind && !appSplashDone)')).toBeLessThan(app.indexOf('<SplashScreen onDone'));
  });
  it('the waiting screens on an app route are the app\'s own picture, not a grey "Loading…"', () => {
    expect(app).toContain('if (!slugResolved) return appKind ? <AppSplashArt app={appKind} /> : <PageFallback />;');
    expect(app).toContain('<Suspense fallback={appKind ? <AppSplashArt app={appKind} bar={false} /> : <PageFallback />}>');
  });
});

describe('the first frame', () => {
  it('?app= paints the page in the app\'s colour, marks it and skips the POS boot screen', () => {
    for (const a of ['owner', 'rider', 'order-taker'] as const) {
      document.documentElement.removeAttribute('style');
      window.history.replaceState(null, '', `/?app=${a}`);
      new Function(BOOT_THEME_SCRIPT)();
      expect(document.documentElement.getAttribute('data-app')).toBe(a);
      expect(document.documentElement.hasAttribute('data-public-route')).toBe(true);
      expect(document.documentElement.style.backgroundColor).not.toBe('');
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');   // the restaurant's colour is never applied in an app
    }
    expect(APP_BOOT_COLORS.owner).toBe(BRAND_APPS.find(a => a.id === 'owner')!.accent.mid);
    expect(APP_BOOT_COLORS.rider).toBe(BRAND_APPS.find(a => a.id === 'rider')!.accent.mid);
    expect(APP_BOOT_COLORS['order-taker']).toBe(BRAND_APPS.find(a => a.id === 'ordertaker')!.accent.mid);
  });
  it('the Owner route alone is enough, and an ordinary page is untouched', () => {
    location.hash = '#/owner-app';
    new Function(BOOT_THEME_SCRIPT)();
    expect(document.documentElement.getAttribute('data-app')).toBe('owner');
    document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-app'); document.documentElement.removeAttribute('data-public-route');
    location.hash = '#/';
    new Function(BOOT_THEME_SCRIPT)();
    expect(document.documentElement.hasAttribute('data-app')).toBe(false);
  });
  it('the script survives a hostile query string', () => {
    window.history.replaceState(null, '', '/?app=owner%22;alert(1);//');
    expect(() => new Function(BOOT_THEME_SCRIPT)()).not.toThrow();
    expect(document.documentElement.hasAttribute('data-app')).toBe(false);
  });
});

describe('the app icons and native splash', () => {
  const gen = read('scripts/brand/build-brand-assets.mjs');
  it('one big symbol, the mark small beneath it (not a big mark in the corner)', () => {
    expect(gen).toContain('const HERO = {');
    expect(gen).toContain('const SIGN = {');
    expect(gen).not.toContain('const BADGE');
  });
  it('the native splash is the same picture the app draws: gradient, symbol tile, name, small mark at the foot', () => {
    expect(gen).toContain('linear-gradient(160deg, ${a.light} 0%, ${a.mid} 55%, ${a.dark} 100%)');
    expect(gen).toContain('background:rgba(255,255,255,0.16)');
  });
});
