// v1.109.0 — the sidebar follows the language; Arabic is complete; the shell turns right-to-left for Urdu and Arabic.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGES, getLanguageDef, languagesForCountry, missingKeys, setLanguage, t, totalKeys, translationCoverage } from '@/lib/i18n';
import { navGroupTitle, navTitle } from '@/components/shell/navLabels';

afterEach(() => { setLanguage('en'); });

const permissions = readFileSync('src/lib/permissions.ts', 'utf8');
const navKeys = [...permissions.matchAll(/\{ key: '([^']+)',\s*path: '[^']+',\s*title: '([^']+)',\s*group: '([^']+)'/g)];

describe('every module has a translated title', () => {
  it('finds the module list', () => { expect(navKeys.length).toBeGreaterThan(60); });
  it('English, Urdu and Arabic all have nav.<key> for every module in permissions.ts (a new module without one fails here)', () => {
    for (const lang of ['en', 'ur', 'ar'] as const) {
      setLanguage(lang);
      for (const [, key, title] of navKeys) {
        const v = t(`nav.${key}`);
        expect(v, `${lang} nav.${key}`).not.toBe(`nav.${key}`);
        if (lang === 'en') expect(v, `en nav.${key} matches the module's own title`).toBe(title);
      }
    }
  });
  it('and every group heading', () => {
    for (const g of new Set(navKeys.map(m => m[3]))) {
      for (const lang of ['en', 'ur', 'ar'] as const) { setLanguage(lang); expect(t(`navGroup.${g}`), `${lang} ${g}`).not.toBe(`navGroup.${g}`); }
    }
  });
});

describe('the sidebar titles follow the language', () => {
  it('English shows the module title, Arabic and Urdu their own', () => {
    expect(navTitle('dashboard', 'Dashboard')).toBe('Dashboard');
    setLanguage('ar');
    expect(navTitle('dashboard', 'Dashboard')).toBe('لوحة التحكم');
    expect(navTitle('running-bills-not-a-module', 'Fallback')).toBe('Fallback');
    expect(navGroupTitle('Reports')).toBe('التقارير');
    setLanguage('ur');
    expect(navTitle('settings', 'Settings')).toBe('سیٹنگز');
    expect(navGroupTitle('Operations')).toBe('آپریشنز');
  });
});

describe('Arabic is complete', () => {
  it('has every key the English dictionary has', () => {
    expect(missingKeys('ar')).toEqual([]);
    expect(translationCoverage('ar')).toBe(100);
    expect(translationCoverage('ur')).toBe(100);
    expect(totalKeys()).toBeGreaterThan(160);
  });
  it('translates the till and the payment words', () => {
    setLanguage('ar');
    expect(t('pos.pay')).toBe('دفع');
    expect(t('payment.cash')).toBe('نقدي');   // the existing Arabic is kept; only missing keys were filled
    expect(t('toast.noInternet')).toBe('لا يوجد اتصال بالإنترنت');
  });
});

describe('direction follows the script', () => {
  it('Urdu and Arabic turn the whole page right-to-left, everything else stays left-to-right', () => {
    setLanguage('ar'); expect(document.documentElement.dir).toBe('rtl'); expect(document.documentElement.lang).toBe('ar');
    setLanguage('ur'); expect(document.documentElement.dir).toBe('rtl');
    setLanguage('en'); expect(document.documentElement.dir).toBe('ltr');
    expect(getLanguageDef('ar').rtl).toBe(true);
    expect(LANGUAGES.filter(l => l.rtl).map(l => l.code).sort()).toEqual(['ar', 'ur']);
  });
  it('Arabic is offered in the Gulf and Egypt, Urdu in Pakistan', () => {
    for (const c of ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Egypt', 'Jordan']) {
      expect(languagesForCountry(c).map(l => l.code), c).toContain('ar');
    }
    expect(languagesForCountry('Pakistan').map(l => l.code)).toContain('ur');
    expect(languagesForCountry('Germany').map(l => l.code)).toEqual(['en']);
  });
});
