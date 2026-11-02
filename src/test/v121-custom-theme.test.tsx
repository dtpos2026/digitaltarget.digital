// ============================================================
// THEME MANAGEMENT — Modern, DT Retail, Classic and Custom themes.
//
// What is pinned:
//   • a designer's handful of colours becomes a complete theme that is READABLE
//     whatever they chose (grey-on-grey text, a pale yellow accent, a dark page);
//   • nothing a theme file contains can end up as CSS or markup — only #rrggbb
//     colours, a short name, and numbers computed from them;
//   • a custom theme is applied exactly like a built-in one, removed again when
//     another theme or Classic is chosen, and survives a restart;
//   • themes can be exported, imported (always under a fresh id), copied and deleted;
//   • all of it is presentation: only theme keys are written, never data, licence,
//     users or printer settings, and the built-in themes are untouched.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import {
  DEFAULT_CUSTOM_DEF, MAX_CUSTOM_THEMES, buildCustomTheme, defFromTheme, deleteCustomThemeDef, exportThemeFile, getCustomThemeDefs,
  loadCustomThemes, normalizeDef, parseThemeFile, saveCustomThemeDef, slugify, newCustomId, CUSTOM_THEMES_KEY, type CustomThemeDef,
} from '@/lib/customTheme';
import {
  UI_THEME_KEY, UI_STYLE_KEY, applyUiStyle, getThemeId, getUiLook, hslToRgb, restorePreviousLook, setTheme, setUiStyle,
} from '@/lib/uiStyle';
import { ALL_THEMES, DEFAULT_THEME_ID, RETAIL_THEMES, UI_THEMES, findTheme, getRegisteredCustomThemes, isCustomTheme, isRetailTheme, isThemeId, registerCustomThemes, type Triplet } from '@/lib/uiThemes';
import CustomThemeManager from '@/components/settings/CustomThemeManager';
import InterfaceStyleCard from '@/components/settings/InterfaceStyleCard';

const root = () => document.documentElement;
const styleEl = () => document.getElementById('dtpos-custom-theme') as HTMLStyleElement | null;
const ATTRS = ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent', 'data-look', 'data-ui-mode', 'data-anim', 'data-theme', 'style'];

const rgb = (t: Triplet) => {
  const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
  return hslToRgb({ h, s, l });
};
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const def = (over: Partial<CustomThemeDef> = {}): CustomThemeDef => ({ ...DEFAULT_CUSTOM_DEF, id: 'custom-test', ...over });

beforeEach(() => {
  localStorage.clear();
  // The cloud app's default style is Classic (DT Enterprise); these tests are about a restaurant that chose Modern.
  localStorage.setItem(UI_STYLE_KEY, 'modern');
  ATTRS.forEach(a => root().removeAttribute(a));
  styleEl()?.remove();
  registerCustomThemes([]);
});

describe('what a designer may enter', () => {
  it('accepts a complete definition and tidies the name', () => {
    const d = normalizeDef({ ...def(), name: '  Ocean <b>Café</b>  ' });
    expect(d?.name).toBe('Ocean bCafé/b');
    expect(d?.id).toBe('custom-test');
  });
  it('rejects ids that are not custom-…', () => {
    for (const id of ['ember', 'custom-', 'custom-A B', 'custom-x"]{}', '', undefined, 5]) expect(normalizeDef({ ...def(), id }), String(id)).toBeNull();
  });
  it('needs a name, and replaces a bad colour with the default instead of using it', () => {
    expect(normalizeDef({ ...def(), name: '   ' })).toBeNull();
    const d = normalizeDef({ ...def(), accent: 'red; } body { display:none', page: 'javascript:alert(1)', text: '#12345' })!;
    expect(d.accent).toBe(DEFAULT_CUSTOM_DEF.accent);
    expect(d.page).toBe(DEFAULT_CUSTOM_DEF.page);
    expect(d.text).toBe(DEFAULT_CUSTOM_DEF.text);
  });
  it('a DT Retail theme always has the dark gradient sidebar', () => {
    expect(normalizeDef({ ...def(), look: 'retail', sidebarStyle: 'light' })?.sidebarStyle).toBe('dark');
  });
  it('makes unique, safe ids', () => {
    expect(slugify('Mój Thème №1!')).toBe('m-j-th-me-1');
    expect(newCustomId('Gold', [])).toBe('custom-gold');
    expect(newCustomId('Gold', ['custom-gold'])).toBe('custom-gold-2');
    expect(newCustomId('Gold', ['custom-gold', 'custom-gold-2'])).toBe('custom-gold-3');
    expect(newCustomId('!!!', [])).toBe('custom-theme');
  });
});

describe('every custom theme is readable, whatever was chosen', () => {
  const cases: Array<[string, Partial<CustomThemeDef>]> = [
    ['the defaults', {}],
    ['grey text on a grey page', { page: '#bbbbbb', panel: '#c4c4c4', text: '#aaaaaa' }],
    ['a pale yellow accent', { accent: '#ffe600' }],
    ['a dark page', { dark: true, page: '#0b1020', panel: '#121a30', text: '#e6ebf5', accent: '#8b5cf6' }],
    ['a dark page with dark text chosen by mistake', { dark: true, page: '#0b1020', panel: '#121a30', text: '#222222' }],
    ['a near-white accent on white', { accent: '#f2f2f2' }],
    ['a near-black accent', { accent: '#050505' }],
    ['the DT Retail look', { look: 'retail', accent: '#6d28d9', sidebarColor: '#2a0a55' }],
    ['a pastel sidebar', { sidebarStyle: 'light', sidebarColor: '#f5d0fe' }],
    ['a very light sidebar chosen as dark', { sidebarStyle: 'dark', sidebarColor: '#f0f0f0' }],
  ];
  it.each(cases)('%s', (_name, over) => {
    const { theme } = buildCustomTheme(def(over));
    const s = theme.surface;
    expect(contrast(rgb(s.foreground), rgb(s.background)), 'text on the page').toBeGreaterThanOrEqual(6.9);
    expect(contrast(rgb(s.foreground), rgb(s.card!)), 'text on panels').toBeGreaterThanOrEqual(6.9);
    expect(contrast(rgb(s.mutedForeground), rgb(s.background)), 'quiet text on the page').toBeGreaterThanOrEqual(4.4);
    expect(contrast(rgb(s.mutedForeground), rgb(s.muted)), 'quiet text on chips').toBeGreaterThanOrEqual(4.4);
    const text = theme.accentText || theme.accent;
    expect(contrast(hslToRgb(text), rgb(s.background)), 'accent as text on the page').toBeGreaterThanOrEqual(4.4);
    expect(contrast(hslToRgb(text), rgb(s.card!)), 'accent as text on panels').toBeGreaterThanOrEqual(4.4);
    // Text on the accent: white, or near-black when the accent is pale.
    const onAccent = theme.onAccent === 'dark' ? [28, 20, 8] : [255, 255, 255];
    expect(contrast(hslToRgb(theme.accent), onAccent), 'text on the accent').toBeGreaterThanOrEqual(3);
    expect(contrast(rgb(s.border), rgb(s.background))).toBeGreaterThan(1.04);
  });

  it('a dark sidebar reads, including when the chosen colour was pale', () => {
    for (const sidebarColor of ['#0b2723', '#f0f0f0', '#550000', '#000000']) {
      const css = buildCustomTheme(def({ sidebarStyle: 'dark', sidebarColor })).theme.css!;
      const get = (k: string) => (new RegExp(`${k}: ([^;]+);`).exec(css) || [])[1] as Triplet;
      expect(contrast(rgb(get('--ui-sb-fg')), rgb(get('--ui-sb-bg'))), sidebarColor).toBeGreaterThanOrEqual(4.4);
      expect(contrast(rgb(get('--ui-sb-muted-fg')), rgb(get('--ui-sb-bg'))), sidebarColor).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('tells the designer when it had to adjust something, and stays quiet when it did not', () => {
    expect(buildCustomTheme(def()).notes).toEqual([]);
    expect(buildCustomTheme(def({ page: '#bbbbbb', panel: '#c4c4c4', text: '#aaaaaa' })).notes.join(' ')).toMatch(/text colour was adjusted/);
  });

  it('a pale accent gets dark text on it instead of being changed', () => {
    const { theme } = buildCustomTheme(def({ accent: '#ffe600' }));
    expect(theme.onAccent).toBe('dark');
    expect(theme.accent.h).toBeGreaterThan(40);
    expect(theme.accent.h).toBeLessThan(60);
  });
});

describe('the stylesheet block', () => {
  it('is a single block for this theme, built from numbers only', () => {
    const { theme } = buildCustomTheme(def({ name: 'x</style><script>alert(1)</script>' }));
    const css = theme.css!;
    expect(css.match(/\{/g)).toHaveLength(1);
    expect(css.startsWith(':root[data-ui="modern"][data-ui-theme="custom-test"] {')).toBe(true);
    expect(css).not.toMatch(/[<>]|script|alert|url\(|@import/i);
    // Every value is a "h s% l%" triplet.
    for (const line of css.split('\n').filter(l => l.startsWith('  --'))) expect(line, line).toMatch(/^  --[a-z-]+: \d+ \d+% \d+%;$/);
  });
  it('carries every variable the built-in themes define', () => {
    const css = buildCustomTheme(def({ look: 'retail' })).theme.css!;
    for (const v of ['--background', '--foreground', '--card', '--muted', '--muted-foreground', '--border', '--input', '--pos-grid-bg', '--ui-sb-bg', '--dtr-sb-top', '--dtr-sb-bot', '--dtr-hero-a', '--dtr-hero-b']) {
      expect(css, v).toContain(`${v}:`);
    }
  });
  it('a Modern-look theme has no DT Retail gradients; a dark page asks for dark form controls', () => {
    const css = buildCustomTheme(def({ dark: true })).theme.css!;
    expect(css).not.toContain('--dtr-');
    expect(css).toContain('color-scheme: dark;');
    expect(buildCustomTheme(def()).theme.css).not.toContain('color-scheme');
  });
});

describe('using a custom theme', () => {
  it('applies like a built-in theme and removes its stylesheet again when another theme is chosen', () => {
    expect(saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' }).ok).toBe(true);
    setTheme('custom-teal');
    expect(getThemeId()).toBe('custom-teal');
    expect(root().getAttribute('data-ui')).toBe('modern');
    expect(root().getAttribute('data-ui-theme')).toBe('custom-teal');
    expect(styleEl()?.textContent).toContain('[data-ui-theme="custom-teal"]');
    expect(root().hasAttribute('data-look')).toBe(false);

    setTheme('tomato');
    expect(styleEl()).toBeNull();
    expect(root().getAttribute('data-ui-theme')).toBe('tomato');
  });

  it('Classic removes it, and Modern brings the same custom theme back', () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    setTheme('custom-teal');
    setUiStyle('classic');
    expect(styleEl()).toBeNull();
    expect(root().hasAttribute('data-ui-theme')).toBe(false);
    setUiStyle('modern');
    expect(styleEl()).not.toBeNull();
    expect(root().getAttribute('data-ui-theme')).toBe('custom-teal');
  });

  it('a DT Retail custom theme switches the retail look on, a dark one the dark page, and the previous look can be restored', () => {
    setUiStyle('classic');
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Night Gold', look: 'retail', dark: true, accent: '#d4a017', page: '#0b0a05', panel: '#15130a', text: '#f5efdc', sidebarColor: '#050505' });
    setTheme('custom-night-gold');
    expect(root().getAttribute('data-look')).toBe('retail');
    expect(root().getAttribute('data-ui-mode')).toBe('dark');
    expect(getUiLook()).toBe('retail');
    expect(isRetailTheme('custom-night-gold')).toBe(true);
    expect(restorePreviousLook()).toBe(true);
    expect(getUiLook()).toBe('classic');
    expect(root().hasAttribute('data-look')).toBe(false);
  });

  it('editing the theme in use repaints at once', () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    setTheme('custom-teal');
    const before = root().style.getPropertyValue('--ui-accent-h');
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, id: 'custom-teal', name: 'Teal', accent: '#b91c1c' });
    expect(root().style.getPropertyValue('--ui-accent-h')).not.toBe(before);
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, id: 'custom-teal', name: 'Teal', accent: '#b91c1c', page: '#101010', dark: true, text: '#f0f0f0' });
    expect(styleEl()!.textContent).toContain('color-scheme: dark');
    expect(getCustomThemeDefs()).toHaveLength(1);
  });

  it('survives a restart: the saved theme is known again before the first paint', () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    setTheme('custom-teal');
    registerCustomThemes([]); // a fresh process knows nothing yet
    expect(getThemeId()).toBe(DEFAULT_THEME_ID);
    loadCustomThemes();
    expect(getThemeId()).toBe('custom-teal');
    applyUiStyle();
    expect(root().getAttribute('data-ui-theme')).toBe('custom-teal');
    expect(styleEl()).not.toBeNull();
  });

  it('a stored custom theme whose definition is gone falls back to the default', () => {
    localStorage.setItem(UI_THEME_KEY, 'custom-ghost');
    loadCustomThemes();
    expect(getThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it('deleting the theme in use hands over to the default theme', () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    setTheme('custom-teal');
    deleteCustomThemeDef('custom-teal');
    expect(getCustomThemeDefs()).toEqual([]);
    expect(isCustomTheme('custom-teal')).toBe(false);
    expect(getThemeId()).toBe(DEFAULT_THEME_ID);
    expect(styleEl()).toBeNull();
  });

  it('the built-in themes are untouched', () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    expect(UI_THEMES).toHaveLength(13);
    expect(RETAIL_THEMES).toHaveLength(8);
    expect(ALL_THEMES).toHaveLength(22); // 13 Modern + 8 DT Retail + DT Refined (v1.85.0)
    expect(isThemeId('custom-teal')).toBe(true);
    expect(findTheme('custom-teal').custom).toBe(true);
    expect(findTheme('tomato').custom).toBeUndefined();
  });
});

describe('keeping, copying and limiting', () => {
  it('keeps at most twelve, with unique ids', () => {
    for (let i = 0; i < MAX_CUSTOM_THEMES; i++) expect(saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Same name' }).ok).toBe(true);
    const ids = getCustomThemeDefs().map(d => d.id);
    expect(new Set(ids).size).toBe(MAX_CUSTOM_THEMES);
    const over = saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'One too many' });
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/up to 12/);
    // Editing an existing one is still fine at the limit.
    expect(saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, id: ids[0], name: 'Renamed' }).ok).toBe(true);
  });
  it('ignores damaged storage', () => {
    localStorage.setItem(CUSTOM_THEMES_KEY, '{not json');
    expect(getCustomThemeDefs()).toEqual([]);
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify([{ id: 'ember', name: 'x' }, def(), def(), 5, null]));
    expect(getCustomThemeDefs().map(d => d.id)).toEqual(['custom-test']);
  });
  it('can start from any built-in theme', () => {
    for (const t of ALL_THEMES) {
      const start = defFromTheme(t);
      expect(normalizeDef({ ...start, id: 'custom-from' }), t.id).not.toBeNull();
      const built = buildCustomTheme({ ...start, id: 'custom-from' });
      expect(built.theme.surface.background).toBeTruthy();
    }
    expect(defFromTheme(findTheme('dtr-night')).dark).toBe(true);
    expect(defFromTheme(findTheme('dtr-royal')).look).toBe('retail');
    expect(defFromTheme(findTheme('tomato')).look).toBe('modern');
  });
});

describe('theme files', () => {
  it('export → import round-trips, under a fresh id so nothing is overwritten', () => {
    const d = def({ name: 'Brand theme', look: 'retail', accent: '#c026d3' });
    const file = exportThemeFile(d);
    expect(JSON.parse(file)).toMatchObject({ format: 'dtpos-theme', version: 1, theme: { name: 'Brand theme' } });
    const parsed = parseThemeFile(file, ['custom-brand-theme']);
    expect(parsed.ok).toBe(true);
    expect(parsed.def).toMatchObject({ name: 'Brand theme', look: 'retail', accent: '#c026d3' });
    expect(parsed.def!.id).toBe('custom-brand-theme-2');
  });
  it('explains a bad file in plain language', () => {
    expect(parseThemeFile('hello').error).toBe('This is not a theme file.');
    expect(parseThemeFile('{"format":"other"}').error).toBe('This file is not a DT POS theme.');
    expect(parseThemeFile('{"format":"dtpos-theme","version":1}').error).toBe('The theme file is empty.');
    expect(parseThemeFile('{"format":"dtpos-theme","version":1,"theme":{"name":""}}').error).toMatch(/missing a name/);
  });
  it('a file cannot carry anything but a theme', () => {
    const evil = JSON.stringify({ format: 'dtpos-theme', version: 1, theme: { ...def(), id: 'ember', css: 'body{display:none}', accent: 'url(javascript:1)', desiScript: '<script>' } });
    const parsed = parseThemeFile(evil);
    expect(parsed.ok).toBe(true);
    expect(parsed.def!.id).toMatch(/^custom-/);
    expect(JSON.stringify(parsed.def)).not.toMatch(/script|display:none|javascript/);
    expect(buildCustomTheme(parsed.def!).theme.css).not.toMatch(/display|script|url/);
  });
});

describe('the designer in Settings', () => {
  it('creates a theme from scratch and uses it', async () => {
    render(<CustomThemeManager />);
    expect(screen.getByText(/No custom themes yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New theme/ }));
    const designer = screen.getByTestId('theme-designer');
    fireEvent.change(within(designer).getByLabelText('Theme name'), { target: { value: 'Biryani House' } });
    fireEvent.change(within(designer).getByLabelText('Accent hex'), { target: { value: '#b45309' } });
    expect(within(designer).getByText(/easy to read/)).toBeTruthy();
    fireEvent.click(within(designer).getByRole('button', { name: /Save & use/ }));
    await waitFor(() => expect(getThemeId()).toBe('custom-biryani-house'));
    expect(getCustomThemeDefs()[0]).toMatchObject({ name: 'Biryani House', accent: '#b45309' });
    expect(root().getAttribute('data-ui-theme')).toBe('custom-biryani-house');
    expect(screen.queryByTestId('theme-designer')).toBeNull();
    expect(within(screen.getByRole('radiogroup', { name: 'Custom theme' })).getByRole('radio', { name: /Biryani House/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('will not save a theme without a name or with a broken colour', () => {
    render(<CustomThemeManager />);
    fireEvent.click(screen.getByRole('button', { name: /New theme/ }));
    const designer = screen.getByTestId('theme-designer');
    fireEvent.change(within(designer).getByLabelText('Theme name'), { target: { value: '   ' } });
    fireEvent.click(within(designer).getByRole('button', { name: 'Save' }));
    expect(getCustomThemeDefs()).toHaveLength(0);
    fireEvent.change(within(designer).getByLabelText('Theme name'), { target: { value: 'Broken' } });
    fireEvent.change(within(designer).getByLabelText('Page hex'), { target: { value: '#12' } });
    expect(within(designer).getByText('Check the colours')).toBeTruthy();
    fireEvent.click(within(designer).getByRole('button', { name: 'Save' }));
    expect(getCustomThemeDefs()).toHaveLength(0);
  });

  it('starts from a built-in theme and shows the designer what was adjusted', () => {
    render(<CustomThemeManager />);
    fireEvent.click(screen.getByRole('button', { name: /New theme/ }));
    const designer = screen.getByTestId('theme-designer');
    fireEvent.change(within(designer).getByLabelText('Start from'), { target: { value: 'dtr-night' } });
    expect((within(designer).getByLabelText('Page hex') as HTMLInputElement).value).toBe(defFromTheme(findTheme('dtr-night')).page);
    expect(within(designer).getByRole('radio', { name: /DT Retail/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(within(designer).getByLabelText('Text hex'), { target: { value: '#222222' } });
    expect(within(designer).getByText(/text colour was adjusted/)).toBeTruthy();
  });

  it('lists saved themes with use, edit, copy, export and delete', async () => {
    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    const created: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x'; });
    (URL as any).revokeObjectURL = vi.fn();
    (window as any).confirm ??= () => true;   // happy-dom has none to spy on
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CustomThemeManager />);

    fireEvent.click(screen.getByRole('radio', { name: /Teal/ }));
    expect(getThemeId()).toBe('custom-teal');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Teal' }));
    expect(getCustomThemeDefs().map(d => d.name)).toEqual(['Teal', 'Teal copy']);

    fireEvent.click(screen.getByRole('button', { name: 'Export Teal' }));
    expect(created).toHaveLength(1);
    const text = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(created[0]); });
    expect(JSON.parse(text)).toMatchObject({ format: 'dtpos-theme', theme: { name: 'Teal' } });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Teal copy' }));
    expect((screen.getByLabelText('Theme name') as HTMLInputElement).value).toBe('Teal copy');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Teal' }));
    expect(getCustomThemeDefs().map(d => d.name)).toEqual(['Teal copy']);
    expect(getThemeId()).toBe(DEFAULT_THEME_ID); // the one in use was deleted
  });

  it('imports a theme file, and refuses a bad one', async () => {
    render(<CustomThemeManager />);
    const input = screen.getByTestId('theme-file-input') as HTMLInputElement;
    const good = new File([exportThemeFile(def({ name: 'From a developer' }))], 'theme.json', { type: 'application/json' });
    Object.defineProperty(good, 'text', { value: async () => exportThemeFile(def({ name: 'From a developer' })) });
    fireEvent.change(input, { target: { files: [good] } });
    await waitFor(() => expect(getCustomThemeDefs().map(d => d.name)).toEqual(['From a developer']));

    const bad = new File(['nope'], 'bad.json');
    Object.defineProperty(bad, 'text', { value: async () => 'nope' });
    fireEvent.change(input, { target: { files: [bad] } });
    await new Promise(r => setTimeout(r, 20));
    expect(getCustomThemeDefs()).toHaveLength(1);
  });
});

describe('the Theme manager in Settings → Appearance', () => {
  it('offers Modern themes, DT Retail and Custom, and Classic stays one click away', () => {
    render(<InterfaceStyleCard />);
    const tabs = screen.getByRole('tablist', { name: 'Theme family' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['Modern themes · 13', 'DT Retail · 8', 'Custom · 0']);
    expect(within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio')).toHaveLength(13);
    expect(screen.getByRole('radio', { name: /Classic/ })).toBeTruthy();

    fireEvent.click(within(tabs).getByRole('tab', { name: /DT Retail/ }));
    expect(within(screen.getByRole('radiogroup', { name: 'DT Retail theme' })).getAllByRole('radio')).toHaveLength(8);
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Smooth animations' })).toBeTruthy();

    fireEvent.click(within(tabs).getByRole('tab', { name: /Custom/ }));
    expect(screen.getByTestId('custom-themes')).toBeTruthy();
  });

  it('opens on the family of the theme in use', () => {
    setTheme('dtr-night');
    const { unmount } = render(<InterfaceStyleCard />);
    expect(screen.getByRole('tab', { name: /DT Retail/ }).getAttribute('aria-selected')).toBe('true');
    unmount();

    saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'Teal' });
    setTheme('custom-teal');
    render(<InterfaceStyleCard />);
    expect(screen.getByRole('tab', { name: /Custom/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('touches only its own keys — no data, licence, user or printer key', () => {
    localStorage.setItem('desi-pos-data', '{"orders":[1,2,3]}');
    localStorage.setItem('pos-user-id', 'admin-default');
    localStorage.setItem('dtpos-printer-settings-v1', '{"printers":[]}');
    const before = new Map<string, string>();
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; before.set(k, localStorage.getItem(k)!); }

    const a = saveCustomThemeDef({ ...DEFAULT_CUSTOM_DEF, name: 'One' });
    setTheme(a.def!.id);
    deleteCustomThemeDef(a.def!.id);
    setUiStyle('classic'); setUiStyle('modern');

    for (const [k, v] of before) expect(localStorage.getItem(k), `${k} changed`).toBe(v);
    const added: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!before.has(k)) added.push(k); }
    for (const k of added) expect([UI_STYLE_KEY, UI_THEME_KEY, CUSTOM_THEMES_KEY, 'dtpos-ui-prev', 'dtpos-ui-anim'], `unexpected key ${k}`).toContain(k);
  });
});
