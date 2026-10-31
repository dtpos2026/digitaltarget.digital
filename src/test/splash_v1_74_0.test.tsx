// ============================================================================
// v1.74.0 — the welcome splash, as the offline DT POS opens
//
// REQUESTED: "jesy splash open hota hai offline software ka wesy hi ho — web or windows dono py": the animated
// welcome the offline software opens with (the mark popping in triangle by triangle, the product name rising, a
// progress bar), on the web and in the Windows app, in the restaurant's theme.
//
// Pinned: what it shows; its timing and the ways out of it; that it is made only of the theme's own colour pair
// and its only overlay darkens; that all motion stops for reduced-motion; that the boot screen before it needs
// no app code; and that the restaurant's colour is back before the first paint.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { mount, q } from './_dom';

vi.mock('@/lib/store', () => ({ getSettings: () => (globalThis as any).__settings ?? { name: 'First Chef Pizza & Burger' } }));
vi.mock('@/lib/version', () => ({ APP_VERSION: '1.2.3', getInstalledVersion: async () => '1.2.3' }));

import SplashScreen from '@/components/SplashScreen';
import BootSplash from '@/components/BootSplash';
import { applyTheme } from '@/lib/themes';
import { BOOT_COLORS_KEY, BOOT_THEME_SCRIPT, saveBootColors } from '@/lib/bootTheme';

const read = (f: string) => readFileSync(f, 'utf8');
let m: ReturnType<typeof mount> | null = null;
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); (globalThis as any).__settings = undefined; });
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers(); document.documentElement.removeAttribute('style'); });

describe('what it shows', () => {
  it('the product name, the restaurant, a progress bar and who made it', () => {
    m = mount(<SplashScreen onDone={() => {}} />);
    const el = q('[data-splash]')!;
    expect(el.querySelector('h1')!.textContent).toBe('DT POS ENTERPRISE');
    expect(el.querySelector('.dt-splash-tag')!.textContent).toBe('First Chef Pizza & Burger');
    expect(el.querySelector('.dt-splash-bar')).toBeTruthy();
    expect(el.querySelector('.dt-splash-foot')!.textContent).toBe('Developed by Digital Target · v1.2.3');
    expect(el.getAttribute('role')).toBe('status');
  });
  it('without a restaurant name it says what the product is', () => {
    (globalThis as any).__settings = { name: '  ' };
    m = mount(<SplashScreen onDone={() => {}} />);
    expect(q('.dt-splash-tag')!.textContent).toBe('Smart POS Solutions');
  });
  it('the mark pops in one triangle after another, 0.2 s apart', () => {
    m = mount(<SplashScreen onDone={() => {}} />);
    const tri = Array.from(document.querySelectorAll('[data-splash] svg[data-dt-mark] polygon')) as SVGElement[];
    expect(tri).toHaveLength(4);
    expect(tri.map(t => t.getAttribute('class'))).toEqual(Array(4).fill('dt-mark-tri'));
    expect(tri.map(t => t.style.animationDelay)).toEqual(['0.1s', '0.3s', '0.5s', '0.7s']);
  });
});

describe('timing and the ways out', () => {
  it('fades for the last 0.4 s and is gone at 1.8 s', () => {
    const done = vi.fn();
    m = mount(<SplashScreen onDone={done} />);
    expect(q('[data-splash]')!.className).toContain('opacity-100');
    act(() => { vi.advanceTimersByTime(1399); });
    expect(q('[data-splash]')!.className).toContain('opacity-100');
    act(() => { vi.advanceTimersByTime(1); });
    expect(q('[data-splash]')!.className).toContain('opacity-0');
    expect(done).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('honours a different duration', () => {
    const done = vi.fn();
    m = mount(<SplashScreen onDone={done} duration={600} />);
    act(() => { vi.advanceTimersByTime(600); });
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('a click or Enter / Space / Escape skips it; other keys do not', () => {
    const done = vi.fn();
    m = mount(<SplashScreen onDone={done} />);
    for (const k of ['a', 'Tab', 'ArrowDown']) act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
    expect(done).not.toHaveBeenCalled();
    for (const k of ['Enter', ' ', 'Escape']) act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
    expect(done).toHaveBeenCalledTimes(3);
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(done).toHaveBeenCalledTimes(4);
  });
  it('leaves no timer or listener behind when it goes away', () => {
    const done = vi.fn();
    m = mount(<SplashScreen onDone={done} />);
    m.unmount(); m = null;
    act(() => { vi.advanceTimersByTime(5000); window.dispatchEvent(new Event('pointerdown')); });
    expect(done).not.toHaveBeenCalled();
  });
  it('the app shows it once per session, with the default duration', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("sessionStorage.getItem('pos-splash-seen')");
    expect(app).toContain('<SplashScreen onDone={handleSplashDone} />');
    expect(app).not.toMatch(/<SplashScreen[^>]*duration=/);
  });
});

describe('it is made of the theme, and only darkens', () => {
  const src = read('src/components/SplashScreen.tsx') + read('src/components/BootSplash.tsx');
  const css = read('src/index.css');
  const block = css.slice(css.indexOf('Splash — the welcome'), css.indexOf('REFERENCE THEMES — shared rules'));
  it('no colour of its own in the components', () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\btext-white\b|\bbg-black\b/);
    expect(read('src/components/SplashScreen.tsx')).toContain('bg-primary text-primary-foreground');
  });
  it('the only gradient over the colour darkens; the orbs and the bar are in the text colour', () => {
    expect(block).toContain('rgb(0 0 0 / 0.18)');
    expect(block).not.toMatch(/linear-gradient\([^)]*(white|#fff|255 255 255)/i);
    expect(block).toMatch(/\.dt-splash-orb[^}]*hsl\(var\(--primary-foreground\)\)/);
    expect(block).toMatch(/\.dt-splash-bar > span[^}]*hsl\(var\(--primary-foreground\)\)/);
  });
  it('every animation is inside prefers-reduced-motion: no-preference', () => {
    const afterMedia = block.slice(block.indexOf('@media (prefers-reduced-motion: no-preference)'));
    const beforeMedia = block.slice(0, block.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(afterMedia).toContain('dtSplashPop');
    expect(beforeMedia.replace(/@keyframes[^\n]*\n/g, '')).not.toMatch(/animation:/);
  });
});

describe('the boot screen before the app has loaded', () => {
  it('is the splash\'s colour and light with a progress bar — and no mark, so nothing animates twice', () => {
    m = mount(<BootSplash />);
    const el = q('[data-boot-splash]')!;
    expect(el.className).toContain('bg-primary');
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('.dt-splash-bar')).toBeTruthy();
  });
  it('is the fallback of the route that loads the app, both times; the plain "Loading DT POS…" text is gone', () => {
    const route = read('src/routes/index.tsx');
    expect((route.match(/<BootSplash \/>/g) || []).length).toBe(2);
    expect(route).not.toContain('Loading DT POS');
  });
  it('imports nothing from the app (store, auth, sync) — it has to show before they exist', () => {
    const s = read('src/components/BootSplash.tsx');
    expect([...s.matchAll(/from '([^']+)'/g)].map(x => x[1])).toEqual(['@/lib/brand']);
  });
});

describe('the restaurant\'s colour before the first paint', () => {
  it('applyTheme saves the two colours the splash is made of', () => {
    applyTheme('ember');
    const saved = JSON.parse(localStorage.getItem(BOOT_COLORS_KEY)!);
    expect(saved).toEqual({ p: '16 88% 42%', f: '0 0% 100%' });
  });
  it('the head script puts them back; with nothing saved it changes nothing', () => {
    new Function(BOOT_THEME_SCRIPT)();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
    saveBootColors('16 88% 42%', '0 0% 100%');
    new Function(BOOT_THEME_SCRIPT)();
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('16 88% 42%');
    expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('0 0% 100%');
  });
  it('it never throws and never accepts anything but numbers, whatever is in storage', () => {
    for (const bad of ['{not json', 'null', '"x"', '{"p":1,"f":2}', '{"p":"red;}body{display:none","f":"0 0% 100%"}', '{"p":"url(x)","f":"1 1% 1%"}']) {
      localStorage.setItem(BOOT_COLORS_KEY, bad);
      expect(() => new Function(BOOT_THEME_SCRIPT)()).not.toThrow();
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
    }
  });
  it('saveBootColors ignores a theme that has no pair', () => {
    saveBootColors(undefined, '0 0% 100%');
    expect(localStorage.getItem(BOOT_COLORS_KEY)).toBeNull();
  });
  it('the root document carries the script in its head', () => {
    expect(read('src/routes/__root.tsx')).toContain('scripts: [{ children: BOOT_THEME_SCRIPT }]');
  });
});
