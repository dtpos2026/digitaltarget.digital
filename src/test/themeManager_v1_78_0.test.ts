// ============================================================================
// v1.78.0 — the offline POS's Theme Manager, Modern shell, More launcher and Module Management, in the cloud app.
//
// What these pin is the part that is specific to the cloud: the default stays the DT Enterprise (Classic) look, the
// Modern look is a premium allotment Super Admin controls, a restaurant that was on one of the v1.68.0 reference themes
// keeps its look, and the shell keeps every cloud status chip. The offline POS's own behaviour is pinned by the ported
// v121-ui-themes / v121-ui-style / v121-dt-retail-look / v121-custom-theme / v121-modern-shell suites.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const root = () => document.documentElement;
const STORE_KEY = 'desi-pos-data';

function seed(settings: Record<string, unknown> = {}) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ settings: { name: 'Chai Corner', ...settings }, users: [], orders: [], menuItems: [], categories: [] }));
}

beforeEach(() => {
  localStorage.clear();
  ['data-ui', 'data-ui-theme', 'data-theme', 'data-look', 'data-ui-mode', 'data-sidebar'].forEach(a => root().removeAttribute(a));
  root().removeAttribute('style');
  vi.resetModules();
});

describe('the default is the look every restaurant already has', () => {
  it('Classic (DT Enterprise) until a restaurant chooses Modern', async () => {
    const ui = await import('@/lib/uiStyle');
    expect(ui.getUiStyle()).toBe('classic');
    ui.applyUiStyle();
    expect(root().getAttribute('data-ui')).toBeNull();
  });

  it('Classic still paints its own palette; Modern clears it and owns the palette', async () => {
    const ui = await import('@/lib/uiStyle');
    const themes = await import('@/lib/themes');
    themes.applyTheme('dt-pos-purple');
    expect(root().style.getPropertyValue('--primary')).not.toBe('');
    ui.setUiStyle('modern');
    themes.applyTheme('dt-pos-purple');
    expect(root().style.getPropertyValue('--primary')).toBe('');
    expect(root().getAttribute('data-ui')).toBe('modern');
    ui.setUiStyle('classic');
    themes.applyTheme('dt-pos-purple');
    expect(root().style.getPropertyValue('--primary')).not.toBe('');
    expect(root().getAttribute('data-ui')).toBeNull();
  });
});

describe('a restaurant on a v1.68.0 reference theme keeps its look', () => {
  it('is moved to the Modern style with the same theme, once, and Classic returns to the brand default', async () => {
    localStorage.setItem('desi-pos-theme', 'dtr-royal');
    localStorage.setItem('dt-theme-migrated-brand', '1');
    const boot = await import('@/lib/uiBoot');
    const ui = await import('@/lib/uiStyle');
    const themes = await import('@/lib/themes');
    expect(ui.getUiStyle()).toBe('modern');
    expect(ui.getThemeId()).toBe('dtr-royal');
    expect(themes.getActiveTheme()).toBe('dt-pos-purple');
    // once only: a restaurant that then goes back to Classic is not pulled forward again
    ui.setUiStyle('classic');
    expect(boot.migrateReferenceThemeSelection()).toBe(false);
    expect(ui.getUiStyle()).toBe('classic');
  });

  it('leaves a restaurant on an ordinary Classic theme alone', async () => {
    localStorage.setItem('desi-pos-theme', 'emerald-prestige');
    localStorage.setItem('dt-theme-migrated-brand', '1');
    await import('@/lib/uiBoot');
    const ui = await import('@/lib/uiStyle');
    const themes = await import('@/lib/themes');
    expect(ui.getUiStyle()).toBe('classic');
    expect(themes.getActiveTheme()).toBe('emerald-prestige');
  });
});

describe('Modern is a premium allotment, like the other premium themes', () => {
  it('a restaurant that was not allotted it is put back on Classic', async () => {
    seed({ premiumThemeAllowed: false });
    localStorage.setItem('dtpos-ui-style', 'modern');
    const gate = await import('@/lib/premiumTheme');
    const ui = await import('@/lib/uiStyle');
    gate.enforcePremiumThemeGate();
    expect(ui.getUiStyle()).toBe('classic');
  });

  it('an allotted restaurant keeps Modern', async () => {
    seed({ premiumThemeAllowed: true });
    localStorage.setItem('dtpos-ui-style', 'modern');
    const gate = await import('@/lib/premiumTheme');
    const ui = await import('@/lib/uiStyle');
    gate.enforcePremiumThemeGate();
    expect(ui.getUiStyle()).toBe('modern');
  });
});

describe('the shell in the cloud app', () => {
  const layout = read('src/components/AppLayout.tsx');
  it('swaps in the Modern sidebar, header and More launcher, and keeps Classic as it was', () => {
    expect(layout).toContain('<ModernSidebar');
    expect(layout).toContain('<ModernHeader');
    expect(layout).toContain('<ModuleLauncher');
    expect(layout).toContain(': <Sidebar userRole={userRole}');
    expect(layout).toMatch(/modern && <ModuleLauncher/);
  });

  it('carries every cloud status chip into the Modern header', () => {
    const at = layout.indexOf('<ModernHeader');
    const body = layout.slice(at, at + 1600);
    for (const chip of ['SyncPendingChip', 'RestaurantIdentityChip', 'SyncStatusBadge', 'BranchSelector']) expect(body, chip).toContain(chip);
  });

  it('the Modern sidebar, launcher and Module Management all see what the Classic sidebar sees (role, plan, enabled modules)', () => {
    for (const f of ['src/components/shell/ModernSidebar.tsx', 'src/components/shell/ModuleLauncher.tsx', 'src/components/settings/ModuleManagementCard.tsx']) {
      expect(read(f), f).toContain('visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length })');
    }
  });

  it('the restaurant name leads the sidebar on every theme except the one that is itself a brand', () => {
    const sb = read('src/components/shell/ModernSidebar.tsx');
    expect(sb).toContain('isVinceBrandActive() ? PREMIUM_BRAND_NAME');
    expect(sb).not.toMatch(/isPremiumThemeActive\(\) \? PREMIUM_BRAND_NAME/);
  });
});

describe('Settings', () => {
  const st = read('src/pages/SettingsPage.tsx');
  it('Appearance is the Theme Manager, and Modules is Module Management', () => {
    expect(st).toContain('<InterfaceStyleCard />');
    expect(st).toContain('<ModuleManagementCard />');
  });
  it('lists sections in a left-hand list in Modern, and in the card grid in Classic', () => {
    expect(st).toContain('aria-label="Settings sections"');
    expect(st).toMatch(/if \(modern\) \{\s*return \(\s*<nav/);
  });
  it('shows Modules only where it applies (the Modern menu)', () => {
    expect(st).toMatch(/\.\.\.\(modern \? \[\{ v: 'modules'/);
  });
  it('the Classic colour list no longer repeats the 21 reference themes the Theme Manager now draws properly', () => {
    expect(st).toContain('themes.filter(t => !REFERENCE_THEME_SPECS.some(r => r.id === t.id))');
  });
  it('opens a section from ?tab=', () => {
    expect(st).toContain("searchParams.get('tab')");
  });
});

describe('the Theme Manager card', () => {
  const card = read('src/components/settings/InterfaceStyleCard.tsx');
  it('says DT Enterprise for the Classic look, offers Modern, DT Retail and Custom, accent override and restart', () => {
    expect(card).toContain('DT Enterprise (Classic)');
    expect(card).toContain('Modern themes');
    expect(card).toContain('DT Retail');
    expect(card).toContain('Use my own accent colour');
    expect(card).toContain('Restart application');
  });
  it('does not let a restaurant that has not been allotted Modern switch to it', () => {
    expect(card).toContain("next === 'modern' && !allowed");
  });
});
