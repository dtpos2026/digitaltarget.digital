// ============================================================
// Tests — Theme engine (v1.3.2, Priority 1)
// The contract: header, cart header, keypad and menu card must read
// their colours from THEME VARIABLES only. If someone later hardcodes
// a colour in these classes, these tests fail.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { themes, applyTheme, type ThemeId } from '@/lib/themes';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/** Extract a CSS rule block by selector prefix. */
function block(selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const start = css.indexOf('{', idx);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

const THEMED_BLOCKS = ['.dt-app-header {', '.dt-cart-header {', '.dt-keypad-btn {', '.dt-menu-add-btn {'];

describe('themed components use theme variables, never hardcoded colours', () => {
  it.each(THEMED_BLOCKS)('%s has a rule', (sel) => {
    expect(block(sel).length).toBeGreaterThan(10);
  });

  it.each(THEMED_BLOCKS)('%s derives its background from a CSS variable', (sel) => {
    const b = block(sel);
    expect(b).toMatch(/background:\s*hsl\(var\(--/);
  });

  it.each(THEMED_BLOCKS)('%s contains no hex or rgb literal for background/colour', (sel) => {
    const b = block(sel);
    // white-with-alpha overlays (hsl(0 0% 100% / x)) are allowed for hover tints
    expect(b).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(b).not.toMatch(/rgb\(/);
  });

  it('header text colour inherits from the theme foreground variable', () => {
    expect(block('.dt-app-header {')).toMatch(/color:\s*hsl\(var\(--pos-sidebar-foreground/);
  });

  it('cart header and keypad use the primary theme colour', () => {
    expect(block('.dt-cart-header {')).toContain('var(--primary)');
    expect(block('.dt-keypad-btn {')).toContain('var(--primary)');
  });

  it('keypad defines hover, active and disabled states', () => {
    expect(css).toContain('.dt-keypad-btn:hover');
    expect(css).toContain('.dt-keypad-btn:active');
    expect(css).toContain('.dt-keypad-btn:disabled');
  });

  it('menu price uses the theme primary colour', () => {
    expect(block('.dt-menu-price {')).toContain('var(--primary)');
  });
});

describe('every theme defines the variables these components depend on', () => {
  const REQUIRED = ['--primary', '--primary-foreground', '--pos-sidebar', '--pos-sidebar-foreground'];

  it.each(themes.map(t => [t.name, t] as const))('%s defines all required variables', (_name, theme) => {
    for (const v of REQUIRED) {
      expect(Object.keys(theme.variables)).toContain(v);
    }
  });

  it('applying a theme writes those variables onto :root', () => {
    for (const t of themes.slice(0, 3)) {
      applyTheme(t.id as ThemeId);
      const root = document.documentElement;
      expect(root.getAttribute('data-theme')).toBe(t.id);
      expect(root.style.getPropertyValue('--primary').trim()).toBe(t.variables['--primary']);
      expect(root.style.getPropertyValue('--pos-sidebar').trim()).toBe(t.variables['--pos-sidebar']);
    }
  });

  it('switching themes actually changes the colours (not a no-op)', () => {
    const [a, b] = themes;
    applyTheme(a.id as ThemeId);
    const first = document.documentElement.style.getPropertyValue('--primary');
    applyTheme(b.id as ThemeId);
    const second = document.documentElement.style.getPropertyValue('--primary');
    expect(first).not.toBe(second);
  });
});
