// ============================================================================
// v1.61.0 — "Soft Light", and premium as a set
//
// REQUESTED: "bg pos ui white theme b add kro ok profassinal ... sary software
// ky asy table anl tu nhi ... taky softness ay software me, abi logo ko asan
// nhi lagta, khty han bohat feature ha ... me super admin sy us resturant ko
// allow kro ga tu who update py desine ui change hoj ga ... baki pos software
// mutaser na ho."
//
// The complaint is about DENSITY, not colour: every screen reads as a
// spreadsheet, so a restaurant sees work rather than a tool. The reference
// screens answer it the same way each time — white ground, generous radius,
// one quiet accent, borders light enough to separate without drawing a grid.
//
// The rollout needed no new mechanism. premiumThemeAllowed already exists and
// the Super Admin panel already toggles it; it simply only ever gated ONE
// theme id, hardcoded in three places. Soft Light joins that same gate, so
// allowing a restaurant hands them the look and revoking takes it back — and
// because the flag lives in tenant_settings, the web picks it up on the next
// refresh and Windows on the next restart, with nothing else to keep in step.
//
// "POS software mutaser na ho" is the constraint that shapes this: a theme is
// CSS variables and nothing else. No behaviour is touched.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { themes, type ThemeId } from '@/lib/themes';
import { PREMIUM_THEME_IDS, isPremiumTheme } from '@/lib/premiumTheme';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const soft = themes.find(t => t.id === 'soft-light');

describe('the theme exists and is light', () => {
  it('is registered', () => {
    expect(soft, 'soft-light is not in the theme list').toBeTruthy();
  });

  it('puts a white card on a near-white page', () => {
    expect(soft!.variables['--card']).toBe('0 0% 100%');
    // Lightness is the last number of the HSL triple.
    const bgL = Number(soft!.variables['--background'].split(' ')[2].replace('%', ''));
    expect(bgL).toBeGreaterThanOrEqual(96);
  });

  it('gives the sidebar a white ground too — that is most of the softness', () => {
    expect(soft!.variables['--pos-sidebar']).toBe('0 0% 100%');
    expect(soft!.variables['--sidebar-background']).toBe('0 0% 100%');
  });

  it('rounds the corners more than the app default of 0.625rem', () => {
    const r = parseFloat(soft!.variables['--radius']);
    expect(r).toBeGreaterThan(0.625);
  });

  it('keeps borders faint, so they separate without drawing a grid', () => {
    const borderL = Number(soft!.variables['--border'].split(' ')[2].replace('%', ''));
    expect(borderL).toBeGreaterThanOrEqual(88);
  });

  it('carries one warm accent for the action that matters', () => {
    // The red on Add to Cart / Checkout in every reference screen.
    const [h] = soft!.variables['--primary'].split(' ');
    expect(Number(h)).toBeGreaterThan(340);
  });
});

describe('the text stays readable on that light ground', () => {
  it('foreground is dark enough to read, and never pure black', () => {
    const fgL = Number(soft!.variables['--foreground'].split(' ')[2].replace('%', ''));
    expect(fgL).toBeLessThanOrEqual(20);
    expect(fgL).toBeGreaterThan(0);
  });

  it('muted text is still legible rather than decorative', () => {
    const mutedL = Number(soft!.variables['--muted-foreground'].split(' ')[2].replace('%', ''));
    expect(mutedL).toBeLessThanOrEqual(50);
  });
});

describe('Super Admin gates it, like every premium theme', () => {
  it('soft-light is premium, so it cannot be taken without allotment', () => {
    expect(isPremiumTheme('soft-light')).toBe(true);
    expect(PREMIUM_THEME_IDS).toContain('soft-light');
  });

  it('the original premium theme is still gated', () => {
    expect(isPremiumTheme('vince-premium')).toBe(true);
  });

  it('an ordinary theme is not gated', () => {
    expect(isPremiumTheme('dt-pos-purple' as ThemeId)).toBe(false);
    expect(isPremiumTheme('light-clean' as ThemeId)).toBe(false);
  });

  it('revocation checks the whole set, not just the first id', () => {
    // Left on the old `=== PREMIUM_THEME_ID`, a restaurant revoked while on
    // Soft Light would silently keep a look it is no longer entitled to.
    const src = stripTs(read('src/lib/premiumTheme.ts'));
    expect(src).toContain('isPremiumTheme(getActiveTheme()) && !isPremiumThemeAllowed()');
    expect(src).not.toContain("getActiveTheme() === PREMIUM_THEME_ID");
  });

  it('the settings screen gates on the set too', () => {
    const src = stripTs(read('src/pages/SettingsPage.tsx'));
    expect(src).toContain('PREMIUM_THEME_IDS.includes(theme.id)');
    expect(src).not.toContain("theme.id === 'vince-premium'");
  });
});

describe('POS behaviour is untouched', () => {
  it('the theme is CSS variables and nothing else', () => {
    const keys = Object.keys(soft!.variables);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.every(k => k.startsWith('--'))).toBe(true);
  });
});
