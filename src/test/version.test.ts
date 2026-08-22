// ============================================================
// Tests — Version consistency (v1.4.0)
//
// Background: APP_VERSION was a hardcoded string in src/lib/version.ts
// and had silently drifted to 1.2.2 while the product shipped 1.3.x —
// so every screen, the login panel and support tickets showed the wrong
// number. It is now injected from package.json at build time.
//
// These tests fail loudly if anyone reintroduces a hardcoded version,
// so the number can never go stale again.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, APP_VERSION_LABEL, APP_NAME, cmpVersion } from '@/lib/version';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const versionSrc = readFileSync(resolve(root, 'src/lib/version.ts'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

describe('single source of truth', () => {
  it('package.json has a valid semver version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the app reports EXACTLY the package.json version', () => {
    // vitest resolves the same define as the production build
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('version.ts contains no hardcoded version literal', () => {
    // strip comments before scanning, so documentation of the old bug is fine
    const code = versionSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const literals = code.match(/['"]\d+\.\d+\.\d+['"]/g) || [];
    // only the '0.0.0' safety fallback is permitted
    expect(literals.filter(l => !l.includes('0.0.0'))).toEqual([]);
  });

  it('vite injects the version from package.json', () => {
    expect(viteConfig).toContain('__APP_VERSION__');
    expect(viteConfig).toContain('pkg.version');
  });

  // ===== v1.25.3 — skipped, deliberately, with the reason recorded =====
  // This asserts an electron-builder `build.win.artifactName` block in
  // package.json. There is no electron-builder here and no electron
  // dependency: this repository builds a TanStack Start + Nitro app that
  // deploys to Cloudflare, and the Windows installer is produced by a
  // separate desktop-shell project.
  //
  // The honest options were to add a fake electron-builder config so the
  // assertion passes, or to say plainly that the thing being tested lives
  // elsewhere. Inventing config to satisfy a test is how a suite stops
  // meaning anything, so: skipped, not deleted, so the question stays visible
  // if the desktop shell is ever folded back into this repo.
  it.skip('the Windows installer name is derived from the same version', () => {
    const artifact = pkg.build?.win?.artifactName || JSON.stringify(pkg.build || {});
    expect(String(artifact)).toContain('${version}');
  });
});

describe('derived version strings', () => {
  it('label combines the product name and the live version', () => {
    expect(APP_VERSION_LABEL).toBe(`${APP_NAME} v${pkg.version}`);
    expect(APP_VERSION_LABEL).toContain(pkg.version);
  });

  it('is never the stale value that caused this bug', () => {
    expect(APP_VERSION).not.toBe('1.2.2');
    expect(APP_VERSION).not.toBe('0.0.0');
  });
});

describe('cmpVersion — powers the "update available" banner', () => {
  it('orders versions correctly', () => {
    expect(cmpVersion('1.4.0', '1.3.9')).toBeGreaterThan(0);
    expect(cmpVersion('1.3.9', '1.4.0')).toBeLessThan(0);
    expect(cmpVersion('1.4.0', '1.4.0')).toBe(0);
  });

  it('compares numerically, not alphabetically (1.10 > 1.9)', () => {
    expect(cmpVersion('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('the current build is not flagged as older than itself', () => {
    expect(cmpVersion(APP_VERSION, pkg.version)).toBe(0);
  });
});
