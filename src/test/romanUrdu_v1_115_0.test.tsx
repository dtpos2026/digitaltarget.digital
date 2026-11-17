// v1.115.0 — Roman Urdu for the three phone apps: Urdu in English letters, made word by word from the proofread Urdu.
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PHRASES_UR } from '@/lib/phrasesUr';
import { missingRomanWords, romanizeUrdu, romanUrduPhrases } from '@/lib/phrasesRomanUrdu';
import { disablePhraseLayer, enablePhraseLayer, translatePhrase } from '@/lib/phraseTranslate';
import { APP_LANGS } from '@/lib/appLanguage';
import AppLanguageSwitch from '@/components/AppLanguageSwitch';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const SCRIPT = /[؀-ۿ]/;
afterEach(() => { disablePhraseLayer(); document.body.innerHTML = ''; });

describe('the Roman Urdu dictionary', () => {
  it('every Urdu word the apps know has a Roman spelling, so no screen is half Urdu script', () => {
    const missing = new Set<string>();
    for (const v of Object.values(PHRASES_UR)) for (const w of missingRomanWords(v)) missing.add(w);
    expect([...missing]).toEqual([]);
  });
  it('covers every phrase the Urdu dictionary has, with no Urdu script left in any of them', () => {
    const d = romanUrduPhrases();
    expect(Object.keys(d)).toEqual(Object.keys(PHRASES_UR));
    for (const [k, v] of Object.entries(d)) { expect(SCRIPT.test(v), `${k} → ${v}`).toBe(false); expect(v.length, k).toBeGreaterThan(0); }
  });
  it('keeps the placeholders and the English the screen shows: {n}, {}, DT Rider, Users & Access', () => {
    const urKeys = Object.keys(PHRASES_UR);
    const d = romanUrduPhrases();
    for (const k of urKeys) {
      expect((d[k].match(/\{n?\}/g) ?? []).length, k).toBe((PHRASES_UR[k].match(/\{n?\}/g) ?? []).length);
    }
    expect(d['Workspace code — staff type it into DT Rider and DT Order Taker']).toContain('DT Rider aur DT Order Taker');
  });
  it('reads like people write it', () => {
    const d = romanUrduPhrases();
    expect(d['Forgot password?']).toBe('Password bhool gaye?');
    expect(d['Online order approval']).toBe('Online order ki manzoori');
    expect(d['Cash to hand over']).toBe('Hawale karne wali naqd raqam');
    expect(d['Pending']).toBe('Pending');
    expect(d['Dining']).toBe('Dine-in');
    expect(d['Revenue']).toBe('Aamdani');
    expect(d['Profit and expenses']).toBe('Munafa aur akhrajaat');
    expect(romanizeUrdu('پہلے؟ ہاں۔ نہیں، ٹھیک')).toBe('Pehle? ہاں. Nahi, theek');   // an unknown word is left, never lost
  });
  it('a sentence starts with a capital, after a full stop too', () => {
    expect(romanizeUrdu('کوئی رائیڈر نہیں۔ ایڈمن سے کہیں۔')).toBe('Koi rider nahi. Admin se kahein.');
  });
});

describe('on screen', () => {
  it('the layer shows Roman Urdu in place of the English and puts the English back', () => {
    document.body.innerHTML = '<div id="r"><button>Forgot password?</button><input placeholder="Search name or phone"></div>';
    enablePhraseLayer(romanUrduPhrases(), document.getElementById('r')!, { isolate: false });
    expect(document.querySelector('button')!.textContent).toBe('Password bhool gaye?');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('Naam ya phone talash karein');
    disablePhraseLayer();
    expect(document.querySelector('button')!.textContent).toBe('Forgot password?');
  });
  it('Roman Urdu is left-to-right: no direction marks are added to it; Urdu script still gets them', () => {
    const roman = translatePhrase('Users & Access', { 'Users & Access': 'Users & Access mein jayein' }, false)!;
    expect(roman).not.toMatch(/[⁦⁩]/);
    const urdu = translatePhrase('x', { x: 'کھولیں Users & Access' }, true)!;
    expect(urdu).toMatch(/⁦Users & Access⁩/);
  });
  it('templates work the same way: "{n} orders · give it to the cashier"', () => {
    expect(translatePhrase('3 orders · give it to the cashier', romanUrduPhrases(), false)).toBe('3 orders · cashier ko de dein');
  });
});

describe('the choice', () => {
  it('the switch offers English, اردو and Roman Urdu, and tapping Roman Urdu selects it', () => {
    expect(APP_LANGS.map(l => l.id)).toEqual(['en', 'ur', 'ur-roman']);
    render(<AppLanguageSwitch />);
    expect(screen.getAllByRole('radio').map(r => r.textContent)).toEqual(['English', 'اردو', 'Roman Urdu']);
    fireEvent.click(screen.getByRole('radio', { name: 'Roman Urdu' }));
    expect(screen.getByRole('radio', { name: 'Roman Urdu' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('dir')).not.toBe('rtl');
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  });
  it('the layer is chosen by language and runs only inside the apps', () => {
    const src = read('src/lib/appLanguage.ts');
    expect(src).toContain("if (lang === 'ur') enablePhraseLayer(PHRASES_UR);");
    expect(src).toContain('else enablePhraseLayer(romanUrduPhrases(), undefined, { isolate: false });');
    expect(src).toContain("const want = appSplashKind() !== null && lang !== 'en';");
  });
});
