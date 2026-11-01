// ============================================================
// INTERFACE STYLE (Modern / Classic) — presentation only.
//
// These pin the promises made to a restaurant that upgrades:
//   • the new look can be switched off again, and switching changes nothing
//     but the <html> attribute and three CSS variables;
//   • the accent colour is always readable with white text on it;
//   • no rule of the new stylesheets can reach the classic look or the print
//     window (the receipt / KOT / token worker has no data-ui attribute);
//   • business data, licence, users, settings and printer configuration are
//     not read or written by any of this.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { HAS_ENGINE, engineSource } from './_shellEngine';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACCENT_PRESETS, DEFAULT_ACCENT_ID, MIN_ACCENT_CONTRAST, UI_ACCENT_KEY, UI_STYLE_KEY,
  applyUiStyle, contrastWithWhite, getAccentChoice, getUiStyle, hexToHsl, hslToHex, resolveAccent, safeAccent,
  setAccent, setUiStyle,
} from '@/lib/uiStyle';
import { applyTheme, themes } from '@/lib/themes';

const root = () => document.documentElement;
const css = (f: string) => readFileSync(resolve(__dirname, '..', 'styles', f), 'utf8');

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-ui');
  root().removeAttribute('data-theme');
  root().removeAttribute('style');
});

describe('accent colour', () => {
  it('every preset is readable with white text after the safety pass', () => {
    for (const p of ACCENT_PRESETS) {
      const a = resolveAccent(p.id);
      expect(contrastWithWhite(a), `${p.name} is too pale for white text`).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 0.05);
    }
  });

  it('a pale custom colour is darkened, not refused, and keeps its hue', () => {
    const pale = { h: 55, s: 100, l: 50 }; // a bright yellow
    expect(contrastWithWhite(pale)).toBeLessThan(2);
    const fixed = safeAccent(pale);
    expect(fixed.h).toBe(55);
    expect(contrastWithWhite(fixed)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST - 0.05);
    expect(fixed.l).toBeLessThan(pale.l);
  });

  it('a colour that is already dark enough is left alone', () => {
    expect(safeAccent({ h: 271, s: 84, l: 23 })).toEqual({ h: 271, s: 84, l: 23 });
  });

  it('hex ⇄ HSL round-trips closely', () => {
    for (const hex of ['#d9480f', '#1d7c50', '#175fd3', '#3c096c']) {
      const back = hslToHex(hexToHsl(hex)!);
      const d = [1, 3, 5].map(i => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)));
      expect(Math.max(...d), `${hex} → ${back}`).toBeLessThanOrEqual(4);
    }
    expect(hexToHsl('nope')).toBeNull();
    expect(hexToHsl('#12')).toBeNull();
  });

  it('bad stored values fall back to the default preset', () => {
    localStorage.setItem(UI_ACCENT_KEY, 'javascript:alert(1)');
    expect(getAccentChoice()).toBe(DEFAULT_ACCENT_ID);
    localStorage.setItem(UI_ACCENT_KEY, '#zzzzzz');
    expect(getAccentChoice()).toBe(DEFAULT_ACCENT_ID);
    localStorage.setItem(UI_ACCENT_KEY, '#D9480F');
    expect(getAccentChoice()).toBe('#D9480F');
  });
});

describe('switching the style', () => {
  it('is Classic (DT Enterprise) until a restaurant chooses Modern — the cloud app keeps the look every tenant already has', () => {
    expect(getUiStyle()).toBe('classic');
    localStorage.setItem(UI_STYLE_KEY, 'modern');
    expect(getUiStyle()).toBe('modern');
    localStorage.setItem(UI_STYLE_KEY, 'garbage');
    expect(getUiStyle()).toBe('classic');
  });

  it('Modern sets the attribute and the accent variables; Classic removes every trace', () => {
    applyUiStyle('modern');
    expect(root().getAttribute('data-ui')).toBe('modern');
    expect(root().style.getPropertyValue('--ui-accent-h')).not.toBe('');
    expect(root().style.getPropertyValue('--ui-accent-l')).toMatch(/%$/);

    setUiStyle('classic');
    expect(root().hasAttribute('data-ui')).toBe(false);
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe('');
    expect(root().style.getPropertyValue('--ui-accent-s')).toBe('');
    expect(root().style.getPropertyValue('--ui-accent-l')).toBe('');
    expect(localStorage.getItem(UI_STYLE_KEY)).toBe('classic');

    setUiStyle('modern');
    expect(root().getAttribute('data-ui')).toBe('modern');
  });

  it('choosing an accent updates the variables at once', () => {
    setUiStyle('modern');
    setAccent('emerald');
    const emerald = resolveAccent('emerald');
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe(String(emerald.h));
    setAccent('#175fd3');
    expect(root().style.getPropertyValue('--ui-accent-h')).toBe(String(resolveAccent('#175fd3').h));
  });

  it('touches only its own two keys — no data, licence, user or printer key is written', () => {
    localStorage.setItem('desi-pos-data', '{"orders":[1,2,3]}');
    localStorage.setItem('pos-user-id', 'admin-default');
    localStorage.setItem('dtpos-printer-settings-v1', '{"printers":[]}');
    const before = { ...localStorage };
    setUiStyle('classic');
    setUiStyle('modern');
    setAccent('teal');
    const after: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; after[k] = localStorage.getItem(k)!; }
    for (const [k, v] of Object.entries(before)) {
      if (k === UI_STYLE_KEY || k === UI_ACCENT_KEY) continue;
      expect(after[k], `${k} changed`).toBe(v);
    }
    const added = Object.keys(after).filter(k => !(k in before));
    expect(added.sort()).toEqual([UI_ACCENT_KEY, UI_STYLE_KEY].sort());
  });
});

describe('colour themes coexist with the interface style', () => {
  it('Classic applies a colour theme inline; Modern clears it and the choice survives', () => {
    localStorage.setItem('desi-pos-theme', 'emerald-prestige');
    setUiStyle('classic');
    applyTheme('emerald-prestige');
    const emerald = themes.find(t => t.id === 'emerald-prestige')!;
    expect(root().style.getPropertyValue('--primary')).toBe(emerald.variables['--primary']);
    expect(root().getAttribute('data-theme')).toBe('emerald-prestige');

    setUiStyle('modern');
    applyTheme('emerald-prestige');
    expect(root().style.getPropertyValue('--primary')).toBe('');
    expect(root().style.getPropertyValue('--gold')).toBe('');
    expect(root().style.getPropertyValue('--gradient-sidebar')).toBe('');
    expect(root().getAttribute('data-theme')).toBe('modern');
    expect(localStorage.getItem('desi-pos-theme')).toBe('emerald-prestige');

    setUiStyle('classic');
    applyTheme('emerald-prestige');
    expect(root().style.getPropertyValue('--primary')).toBe(emerald.variables['--primary']);
  });
});

describe('the new stylesheets cannot leak', () => {
  /** Splits a selector list on commas that are not inside parentheses (:is(a, b) stays whole). */
  function splitTop(list: string): string[] {
    const parts: string[] = [];
    let depth = 0, cur = '';
    for (const ch of list) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  /** Top-level selectors of every rule, descending into @media / @supports. */
  function selectors(source: string): string[] {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    const walk = (chunk: string) => {
      let depth = 0, start = 0, header = '';
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (c === '{') {
          if (depth === 0) { header = chunk.slice(start, i).trim(); start = i + 1; }
          depth++;
        } else if (c === '}') {
          depth--;
          if (depth === 0) {
            const body = chunk.slice(start, i);
            if (/^@(media|supports|container)/.test(header)) walk(body);
            else if (!/^@(keyframes|font-face)/.test(header)) splitTop(header).forEach(s => out.push(s));
            start = i + 1;
          }
        }
      }
    };
    walk(text);
    return out;
  }

  it.each([['ui-tokens.css', 1], ['ui-modern.css', 20], ['ui-pos.css', 20]] as const)('%s: every selector starts with the Modern attribute', (file, min) => {
    const sels = selectors(css(file));
    expect(sels.length).toBeGreaterThanOrEqual(min);
    const stray = sels.filter(s => !/^(html|:root)\[data-ui="modern"\]/.test(s));
    expect(stray, `unscoped selectors: ${stray.join(' | ')}`).toEqual([]);
  });

  it('the print window document carries no interface-style attribute', () => {
    const fast = readFileSync(resolve(__dirname, '..', 'printing', 'fastPrint.ts'), 'utf8');
    expect(fast).not.toMatch(/data-ui/);
    expect(fast).toMatch(/<html>/);
    // The print engine lives in the Windows shell (dtpos-desktop, next to this repository in the delivered ZIP).
    if (HAS_ENGINE) expect(engineSource()).not.toMatch(/data-ui/);
  });

  it('nothing in the new files touches the print rules', () => {
    for (const f of ['ui-tokens.css', 'ui-modern.css', 'ui-pos.css']) {
      const c = css(f);
      expect(c).not.toMatch(/@media\s+print/);
      expect(c).not.toMatch(/\.print-receipt|\.receipt-print|@page|thermal-/);
    }
  });
});
