// ============================================================================
// v1.73.0 — the brand system
//
// REQUESTED: "brand system bnado" — one brand across the software, the owner portal, the invoices and the apps:
// the Order Taker icon should say order taker, the Rider icon rider, all matching the Digital Target brand.
//
// Pinned: one source (src/lib/brand.ts) that every branded component reads; every app has an icon colour that a
// white mark reads on; the three phone apps carry their job in a badge; the Android sizes are the ones Android
// and the existing apps use; the artwork is vector with no font or raster dependency; the guide is one
// self-contained page; and no branded component types a phone number or an e-mail address itself.
// ============================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { mount, q } from './_dom';
import { BRAND, BRAND_APPS, MARK_TRIANGLES, PALETTE, ANDROID_DENSITIES, ICON_GEOMETRY } from '@/lib/brand';
import { contrast, hexToHsl } from '@/lib/colorContrast';
import BrandLockup from '@/components/BrandLockup';
import DtMark from '@/components/DtMark';

const c = (a: string, b: string) => contrast(hexToHsl(a), hexToHsl(b));
let m: ReturnType<typeof mount> | null = null;
afterEach(() => { m?.unmount(); m = null; });

describe('the apps', () => {
  it('are the POS and the phone apps, once each (DT Owner added in v1.86.0)', () => {
    expect(BRAND_APPS.map(a => a.id)).toEqual(['pos', 'customer', 'rider', 'ordertaker', 'owner']);
    expect(new Set(BRAND_APPS.map(a => a.accent.mid)).size).toBe(5);   // five distinct colours
  });
  it('the phone apps have the package ids the Android projects use, and a glyph for their job', () => {
    const phone = BRAND_APPS.filter(a => a.androidFolder);
    expect(phone.map(a => [a.androidFolder, a.packageId, a.glyph])).toEqual([
      ['Customer', 'com.digitaltarget.dtcustomer', 'ShoppingBag'],
      ['Rider', 'com.digitaltarget.dtrider', 'Motorbike'],
      ['OrderTaker', 'com.digitaltarget.dtordertaker', 'ClipboardList'],
      ['Owner', 'com.digitaltarget.dtowner', 'Crown'],
    ]);
    expect(BRAND_APPS.find(a => a.id === 'pos')!.glyph).toBeUndefined();   // the POS is the brand itself
  });
  it('the Android labels the apps already carry match the brand labels', () => {
    expect(BRAND_APPS.map(a => a.label)).toEqual(['DT POS', 'DT Customer', 'DT Rider', 'DT Order Taker', 'DT Owner']);
  });
});

describe('colour', () => {
  for (const a of BRAND_APPS) {
    it(`${a.id}: the white mark reads on the whole gradient (≥ 3 : 1) and on the mid colour as text (≥ 4.5 : 1)`, () => {
      expect(c('#ffffff', a.accent.light)).toBeGreaterThanOrEqual(3);
      expect(c('#ffffff', a.accent.mid)).toBeGreaterThanOrEqual(4.5);
      expect(c('#ffffff', a.accent.dark)).toBeGreaterThanOrEqual(7);
    });
  }
  it('the palette pairs the guide shows are readable', () => {
    expect(c('#ffffff', PALETTE.purpleDeep)).toBeGreaterThanOrEqual(7);
    expect(c('#ffffff', PALETTE.purple)).toBeGreaterThanOrEqual(7);
    expect(c(PALETTE.ink, '#ffffff')).toBeGreaterThanOrEqual(7);
    expect(c(PALETTE.ink, PALETTE.lavender)).toBeGreaterThanOrEqual(7);
    expect(c(PALETTE.muted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Android sizes', () => {
  it('are the standard densities, and the existing apps\' own splash sizes', () => {
    expect(ANDROID_DENSITIES.map(d => d.d)).toEqual(['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']);
    expect(ANDROID_DENSITIES.map(d => d.icon)).toEqual([48, 72, 96, 144, 192]);
    expect(ANDROID_DENSITIES.map(d => d.fg)).toEqual([108, 162, 216, 324, 432]);
    expect(ANDROID_DENSITIES.map(d => d.port.join('x'))).toEqual(['320x480', '480x800', '720x1280', '960x1600', '1280x1920']);
    expect(ANDROID_DENSITIES.map(d => d.land.join('x'))).toEqual(['480x320', '800x480', '1280x720', '1600x960', '1920x1280']);
  });
  it('the adaptive mark stays inside the 61 % safe zone', () => { expect(ICON_GEOMETRY.adaptiveMarkRatio).toBeLessThan(66 / 108); });
});

describe('components', () => {
  it('DtMark draws the brand\'s four triangles', () => {
    m = mount(<DtMark />);
    const pts = Array.from(document.querySelectorAll('svg[data-dt-mark] polygon')).map(p => p.getAttribute('points'));
    expect(pts).toEqual([...MARK_TRIANGLES]);
    expect(document.querySelector('svg')!.getAttribute('aria-label')).toBe(BRAND.name);
  });
  it('BrandLockup prints the wordmark in two lines next to the mark', () => {
    m = mount(<BrandLockup size={60} />);
    const l = q('[data-brand-lockup]')!;
    expect(l.querySelector('svg[data-dt-mark]')).toBeTruthy();
    expect(l.textContent).toBe(BRAND.wordmark[0] + BRAND.wordmark[1]);
    expect(l.querySelector('img')).toBeNull();
  });
});

describe('one source of truth', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  const branded = ['src/components/LoginShell.tsx', 'src/components/A4Invoice.tsx', 'src/components/BrandLockup.tsx', 'src/components/DtMark.tsx', 'src/pages/OwnerLoginPage.tsx', 'src/pages/LoginPage.tsx'];
  it('no branded component types a phone number or the e-mail address itself', () => {
    for (const f of branded) {
      const src = read(f);
      expect(src, f).not.toMatch(/\+92\s?3\d\d|0345-?\s?18|gmail\.com/);
    }
  });
  it('the sign-in frame, the invoice and the lockup import the brand file', () => {
    for (const f of ['src/components/LoginShell.tsx', 'src/components/A4Invoice.tsx', 'src/components/BrandLockup.tsx', 'src/components/DtMark.tsx']) {
      expect(read(f), f).toContain("from '@/lib/brand'");
    }
  });
  it('the lockup is shared: the frame and the invoice use BrandLockup, not their own copy', () => {
    expect(read('src/components/LoginShell.tsx')).toContain('<BrandLockup');
    expect(read('src/components/A4Invoice.tsx')).toContain('<BrandLockup');
  });
  it('the lockup uses inline styles only: the invoice prints in a bare window that has none of the app\'s CSS', () => {
    const src = read('src/components/BrandLockup.tsx');
    expect(src).not.toMatch(/className="[^"]*(flex|font-|leading-|tracking-)/);
    expect(src).toContain("display: 'inline-flex'");
  });
  it('brand.ts has no imports, so Node can read it to generate the assets', () => {
    expect(read('src/lib/brand.ts')).not.toMatch(/^\s*import\s/m);
  });
});

describe('the artwork', () => {
  const svg = (f: string) => readFileSync(f, 'utf8');
  it('every app has a 1024 vector icon, with no text and no embedded picture', () => {
    for (const a of BRAND_APPS) {
      const s = svg(`branding/icons/${a.id}.svg`);
      expect(s, a.id).toContain('viewBox="0 0 1024 1024"');
      expect(s, a.id).toContain(a.accent.mid);
      expect(s, a.id).not.toMatch(/<text|<image|font-family/);
    }
  });
  it('the phone apps lead with their job as one big white symbol and keep the mark small beneath it; the POS is the mark alone (v1.111.0)', () => {
    for (const a of BRAND_APPS) {
      const s = svg(`branding/icons/${a.id}.svg`);
      expect(/stroke="#ffffff" stroke-width="2\.1"/.test(s), a.id).toBe(!!a.glyph);
      expect(/<circle cx="700" cy="700"/.test(s), a.id).toBe(false);          // the old corner badge is gone
      expect((s.match(/<polygon/g) || []).length, a.id).toBe(4);              // the mark: always four triangles, once
    }
  });
  it('each role glyph differs from the others (the icons are told apart by shape, not only by colour)', () => {
    const glyphs = ['customer', 'rider', 'ordertaker'].map(id => svg(`branding/icons/${id}.svg`).match(/stroke-linejoin="round">([\s\S]*?)<\/g>/)![1]);
    expect(new Set(glyphs).size).toBe(3);
  });
  it('the marks are four triangles in white, purple and ink', () => {
    for (const [f, fill] of [['white', '#ffffff'], ['purple', PALETTE.purpleDeep], ['ink', PALETTE.ink]]) {
      const s = svg(`branding/marks/mark-${f}.svg`);
      expect((s.match(/<polygon/g) || []).length, f).toBe(4);
      expect(s, f).toContain(`fill="${fill}"`);
    }
  });
});

describe('the guide', () => {
  it('is one self-contained page that shows every app and every rule', () => {
    expect(existsSync('branding/brand-guide.html')).toBe(true);
    const g = readFileSync('branding/brand-guide.html', 'utf8');
    for (const a of BRAND_APPS) expect(g, a.label).toContain(a.label);
    for (const s of ['The mark and the lockup', 'App icons', 'Colour', 'Splash screens', 'Do', "Don't", BRAND.poweredBy]) expect(g, s).toContain(s);
    expect(g).not.toMatch(/(?:src|href)="https?:/);
  });
});
