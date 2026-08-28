// ============================================================================
// v1.28.8 — the twelve themes, asserted rather than trusted
//
// Every colour here is applied as --primary, over which the customer app draws
// white text throughout, and is also painted behind the launcher icon. A
// palette assembled by eye is exactly the kind of thing that ships one entry
// nobody can read; two candidates were dropped when this test failed them.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { APP_THEMES, themeFor, contrastWithWhite } from '@/lib/appThemes';

describe('the palette', () => {
  it('offers twelve, which is what the panel lays out', () => {
    expect(APP_THEMES).toHaveLength(12);
  });

  it('has no duplicate colour, and no duplicate id', () => {
    expect(new Set(APP_THEMES.map(t => t.primary.toUpperCase())).size).toBe(12);
    expect(new Set(APP_THEMES.map(t => t.id)).size).toBe(12);
  });

  it('is every colour a six-digit hex, because Android and CSS both need one', () => {
    for (const t of APP_THEMES) expect(t.primary).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('carries white text at WCAG AA on every one of them', () => {
    // 4.5:1 is the threshold for body text. Below it the app has buttons whose
    // labels cannot be read in daylight — on a phone, outdoors, by a customer.
    for (const t of APP_THEMES) {
      const ratio = contrastWithWhite(t.primary);
      expect(ratio, `${t.name} (${t.primary}) is ${ratio.toFixed(2)}:1 against white`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('offers both modes, so a restaurant is not forced into one', () => {
    const modes = new Set(APP_THEMES.map(t => t.mode));
    expect(modes).toEqual(new Set(['light', 'dark']));
  });
});

describe('recognising a saved theme', () => {
  it('matches a stored colour back to its preset, whatever the case', () => {
    const t = APP_THEMES[0];
    expect(themeFor(t.primary.toLowerCase(), t.mode)?.id).toBe(t.id);
    expect(themeFor(` ${t.primary} `, t.mode)?.id).toBe(t.id);
  });

  it('does not claim a hand-picked colour as a preset', () => {
    expect(themeFor('#123456', 'dark')).toBeNull();
    expect(themeFor(null, 'dark')).toBeNull();
  });

  it('treats the same colour in the other mode as a different theme', () => {
    // Otherwise the panel would highlight a preset the restaurant is not on.
    const t = APP_THEMES[0];
    expect(themeFor(t.primary, t.mode === 'dark' ? 'light' : 'dark')).toBeNull();
  });
});
