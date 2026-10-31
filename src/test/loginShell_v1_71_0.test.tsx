// ============================================================================
// v1.71.0 — the sign-in screen takes the reference look
//
// REQUESTED: copy the design of the DT POS reference (v1.21.0): a brand panel in
// the theme's colour on the left, a quiet card on the right. This is layout and
// colour only; none of how anyone signs in changed.
//
// Pinned: the frame renders what it should; nothing in it hard-codes a colour of
// its own (it follows the theme, light or dark); the only thing laid over the
// brand panel darkens; the text on the panel is readable in every theme; and
// the logic of the sign-in page is still where it was.
// ============================================================================
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mount, q } from './_dom';
import LoginShell from '@/components/LoginShell';
import DtMark, { DtAppIcon } from '@/components/DtMark';
import { themes } from '@/lib/themes';
import { contrast } from '@/lib/colorContrast';

const shell = readFileSync('src/components/LoginShell.tsx', 'utf8');
const page = readFileSync('src/pages/LoginPage.tsx', 'utf8');
let m: ReturnType<typeof mount> | null = null;
afterEach(() => { m?.unmount(); m = null; });

describe('the frame', () => {
  it('shows the brand panel, the product name, the form slot and the footer', () => {
    m = mount(<LoginShell logo="/restaurant-logo.png"><form data-testid="form">fields</form></LoginShell>);
    const text = document.body.textContent || '';
    expect(q('[data-login-shell]')).toBeTruthy();
    expect(q('[data-login-brand]')).toBeTruthy();
    for (const s of ['DIGITAL', 'TARGET', 'Smart POS Solutions', 'Restaurant', 'Multi-Branch', 'Kitchen', 'Reports',
      'Fast & reliable POS', 'Smarter Business with Digital Target', 'DT POS Enterprise', 'Powered by Digital Target']) {
      expect(text, s).toContain(s);
    }
    expect(q('[data-testid="form"]')).toBeTruthy();
    expect(q('[data-login-version]')!.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(text).toContain('digitaltarget.digital@gmail.com');
  });

  it('uses the restaurant logo it is given', () => {
    m = mount(<LoginShell logo="/restaurant-logo.png"><span /></LoginShell>);
    const imgs = Array.from(document.querySelectorAll('main img')) as HTMLImageElement[];
    expect(imgs.some(i => i.getAttribute('src') === '/restaurant-logo.png')).toBe(true);
  });

  it('claims only what the product does: offline-ready and separated data, not "fully offline" or "encrypted"', () => {
    expect(shell).not.toMatch(/fully offline/i);
    expect(shell).not.toMatch(/encrypted/i);
    expect(shell).toContain('Keeps working offline, syncs when online');
  });
});

describe('the logo is placed the way the reference places it', () => {
  it('brand panel: the mark and the wordmark sit directly on the colour — no tile, no raster logo', () => {
    m = mount(<LoginShell><span /></LoginShell>);
    const panel = q('[data-login-brand]')!;
    expect(panel.querySelector('svg[data-dt-mark]')).toBeTruthy();
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.textContent).toContain('DIGITAL');
    expect(panel.textContent).toContain('TARGET');
  });
  it('without a restaurant logo the header shows the Digital Target app icon (the mark on a primary squircle)', () => {
    m = mount(<LoginShell logo={null}><span /></LoginShell>);
    expect(q('[data-dt-app-icon]')).toBeTruthy();
    expect(q('[data-login-own-logo]')).toBeNull();
    expect(q('[data-dt-app-icon]')!.className).toMatch(/bg-primary text-primary-foreground/);
  });
  it('with a restaurant logo the header shows that logo, contained, and not the app icon', () => {
    m = mount(<LoginShell logo="/r.png"><span /></LoginShell>);
    const own = q('[data-login-own-logo]')!;
    expect(own).toBeTruthy();
    expect(own.querySelector('img')!.className).toContain('object-contain');
    expect(q('[data-dt-app-icon]')).toBeNull();
  });
  it('DtMark is four triangles filled with currentColor; the app icon scales its mark and radius with its size', () => {
    m = mount(<div><DtMark size={40} /><DtAppIcon size={100} /></div>);
    const svgs = Array.from(document.querySelectorAll('svg[data-dt-mark]'));
    expect(svgs[0].querySelectorAll('polygon')).toHaveLength(4);
    expect(svgs[0].getAttribute('fill')).toBe('currentColor');
    expect(svgs[0].getAttribute('aria-label')).toBe('Digital Target');
    const icon = q('[data-dt-app-icon]')!;
    expect(icon.style.width).toBe('100px');
    expect(icon.style.borderRadius).toBe('26px');
    expect(icon.querySelector('svg')!.getAttribute('width')).toBe('56');
    expect(icon.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');   // decorative inside the icon
  });
  it('the sign-in page hands the shell only a restaurant\'s own logo — never the Digital Target raster as a stand-in', () => {
    expect(page).toMatch(/settings\.appLogo \|\| settings\.logo \|\| null/);
    expect(page).not.toContain('digital-target-logo.png');
  });
});

describe('it follows the theme', () => {
  const colours = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\btext-white\b|\bborder-gold\b|\bbg-gold\b|\bfrom-white\b|\bto-white\b/;
  for (const [name, src] of [['LoginShell', shell], ['LoginPage', page]] as const) {
    it(`${name} hard-codes no colour of its own`, () => { expect(src).not.toMatch(colours); });
  }
  it('the only gradient on the brand panel darkens (a lightening one faded under white text in v1.68.0)', () => {
    const g = shell.match(/bg-gradient-to-[a-z]+ [^"']+/g) || [];
    expect(g.length).toBe(1);
    expect(g[0]).toMatch(/from-transparent to-black\/\d+/);
  });
  it('text on the panel is drawn in primary-foreground on the solid primary colour', () => {
    expect(shell).toMatch(/bg-primary text-primary-foreground/);
  });
});

describe('it is readable in every theme', () => {
  // The brand panel prints text in --primary-foreground on --primary. Shapes are borders, so that pair is the whole story.
  // teal-restaurant (an older theme, 3.47:1) is the one theme below 4.5:1; its buttons already carry the same pair.
  const KNOWN_BELOW_AA = new Set(['teal-restaurant']);
  const pair = (t: any) => contrast(t.variables['--primary'], t.variables['--primary-foreground']);

  it('covers every registered theme', () => { expect(themes.length).toBe(32); });
  for (const t of themes as any[]) {
    it(`${t.id}: primary-foreground on primary ${KNOWN_BELOW_AA.has(t.id) ? '≥ 3' : '≥ 4.5'}`, () => {
      expect(pair(t)).toBeGreaterThanOrEqual(KNOWN_BELOW_AA.has(t.id) ? 3 : 4.5);
    });
  }
  it('the exception list is exactly the themes that need it', () => {
    const below = (themes as any[]).filter(t => pair(t) < 4.5).map(t => t.id).sort();
    expect(below).toEqual(Array.from(KNOWN_BELOW_AA).sort());
  });
});

describe('the sign-in logic is still there', () => {
  it('keeps its handlers, its inputs and the forced password change', () => {
    for (const s of ['handleLogin', 'handleBackToOwner', 'handleRefreshCache', 'submitPasswordChange',
      'id="dt-new-pass"', 'id="dt-confirm-pass"', "e.key === 'Enter'", 'setShowContact', 'ContactDigitalTargetDialog',
      'onChange={e => setUsername', 'onChange={e => setPassword', 'disabled={loading}']) {
      expect(page, s).toContain(s);
    }
  });
  it('both screens sit in the same frame', () => {
    expect((page.match(/<LoginShell logo=\{brandLogo\}>/g) || []).length).toBe(2);
    expect(page).not.toContain('LoginMarketingPanel');
  });
});

describe('the owner portal sign-in uses the same frame (one brand across the product)', () => {
  const owner = readFileSync('src/pages/OwnerLoginPage.tsx', 'utf8');
  it('sits in LoginShell, with no dark-glass hard-codes and no second brand panel', () => {
    expect(owner).toContain("import LoginShell from '@/components/LoginShell'");
    expect(owner).toMatch(/<LoginShell>/);
    expect(owner).not.toContain('LoginMarketingPanel');
    expect(owner).not.toMatch(/#[0-9a-fA-F]{6}\b|\btext-white\b|\bborder-gold\b|\bbg-gold\b/);
  });
  it('keeps its handlers and its device-approval branch', () => {
    for (const s of ['handleSubmit', 'handleSwitchAccount', 'handleForgotPassword', 'cancelPendingWait', 'pendingDevice.deviceName',
      'disabled={loading}', 'setShowContact', 'ContactDigitalTargetDialog', 'isCloudConfigured()']) {
      expect(owner, s).toContain(s);
    }
  });
});
