// v1.112.0 — Urdu inside the three phone apps: the phrase layer (what it does to a screen and what it never touches), the dictionary
// (every key is still a phrase in the source) and where the language switch lives.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { disablePhraseLayer, enablePhraseLayer, isPhraseLayerOn, normalizePhrase, translatePhrase } from '@/lib/phraseTranslate';
import { PHRASES_UR, PHRASE_COUNTS } from '@/lib/phrasesUr';
import { appLanguage, setAppLanguage, startAppLanguage, syncPhraseLayer } from '@/lib/appLanguage';
import { getLanguage, setLanguage } from '@/lib/i18n';
import AppLanguageSwitch from '@/components/AppLanguageSwitch';

const read = (f: string) => readFileSync(f, 'utf8');
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const DICT = { 'Save': 'محفوظ کریں', 'Available orders (': 'دستیاب آرڈرز (', 'Search': 'تلاش', 'Open': 'کھولیں' };

beforeEach(() => { localStorage.clear(); setLanguage('en'); window.location.hash = ''; window.history.replaceState(null, '', '/'); });
afterEach(() => { disablePhraseLayer(); document.body.innerHTML = ''; setLanguage('en'); window.location.hash = ''; window.history.replaceState(null, '', '/'); });

describe('translatePhrase', () => {
  it('matches a whole piece of text, keeps the white space around it, and never part of a word', () => {
    expect(translatePhrase('  Save ', DICT)).toBe('  محفوظ کریں ');
    expect(translatePhrase('Save\n   ', DICT)).toBe('محفوظ کریں\n   ');
    expect(translatePhrase('Save the date', DICT)).toBeNull();
    expect(translatePhrase('Saved', DICT)).toBeNull();
    expect(translatePhrase('', DICT)).toBeNull();
    expect(translatePhrase('   ', DICT)).toBeNull();
    expect(translatePhrase('constructor', DICT)).toBeNull();           // no prototype leaks
    expect(translatePhrase('toString', DICT)).toBeNull();
    expect(normalizePhrase('  a \n b  ')).toBe('a b');
  });
});

describe('templates ({} is where a number or a name goes)', () => {
  const T = { 'Order {n}': 'آرڈر {n}', 'Order #{n} claimed': 'آرڈر #{n} مل گیا', 'Pickup · {n}': 'پک اپ · {n}', '({n} waiting)': '({n} انتظار میں)', 'Order': 'آرڈر', 'Welcome {}!': 'خوش آمدید {}!', '{n} orders': '{n} آرڈرز' };
  it('fills the value in; the longer template wins; an exact phrase wins over any template', () => {
    expect(translatePhrase('Order #1042', T)).toBe('آرڈر #1042');
    expect(translatePhrase('Order #1042 claimed', T)).toBe('آرڈر #1042 مل گیا');
    expect(translatePhrase('Pickup · #77', T)).toBe('پک اپ · #77');
    expect(translatePhrase(' (3 waiting) ', T)).toBe(' (3 انتظار میں) ');
    expect(translatePhrase('Order', T)).toBe('آرڈر');
  });
  it('is the whole piece only, and a name with regex characters is just a name', () => {
    expect(translatePhrase('Your Order #5', T)).toBeNull();
    expect(translatePhrase('Order #', T)).toBeNull();
    expect(translatePhrase('Welcome (a+b)*!', T)).toBe('خوش آمدید (a+b)*!');     // {} takes any text, and regex characters in it are just text
    expect(translatePhrase('Welcome Ali Raza!', T)).toBe('خوش آمدید Ali Raza!');
  });
  it('{n} is a number only: a count never turns an ordinary phrase into half Urdu', () => {
    expect(translatePhrase('3 orders', T)).toBe('3 آرڈرز');
    expect(translatePhrase('My orders', T)).toBeNull();
    expect(translatePhrase('Order Ali', T)).toBeNull();
  });
});

describe('the layer on a screen', () => {
  it('translates text pieces, placeholders and labels; leaves numbers, names, inputs\' values and translate="no" alone', async () => {
    document.body.innerHTML = `<div id="r"><h1>Save</h1><p>Available orders (<b>3</b>)</p><input placeholder="Search" value="Save"><button aria-label="Open" title="Save">x</button>
      <span>Ali Traders</span><span translate="no">Save</span><div data-no-translate><i>Save</i></div><textarea>Save</textarea><script>var a = 'Save';</script></div>`;
    enablePhraseLayer(DICT);
    const q = (s: string) => document.querySelector(s)!;
    expect(q('h1').textContent).toBe('محفوظ کریں');
    expect(q('p').textContent).toBe('دستیاب آرڈرز (3)');
    expect(q('b').textContent).toBe('3');
    expect(q('input').getAttribute('placeholder')).toBe('تلاش');
    expect((q('input') as HTMLInputElement).value).toBe('Save');
    expect(q('button').getAttribute('aria-label')).toBe('کھولیں');
    expect(q('button').getAttribute('title')).toBe('محفوظ کریں');
    expect(q('span').textContent).toBe('Ali Traders');
    expect(q('span[translate="no"]').textContent).toBe('Save');
    expect(q('[data-no-translate] i').textContent).toBe('Save');
    expect(q('textarea').textContent).toBe('Save');
    expect(q('script').textContent).toContain("'Save'");
    expect(isPhraseLayerOn()).toBe(true);
  });
  it('follows the screen: new elements, text React rewrites, and a word that stops being a phrase', async () => {
    document.body.innerHTML = '<div id="r"></div>';
    enablePhraseLayer(DICT);
    const r = document.getElementById('r')!;
    r.innerHTML = '<button>Open</button>';
    await flush();
    expect(r.querySelector('button')!.textContent).toBe('کھولیں');
    const text = r.querySelector('button')!.firstChild as Text;
    text.nodeValue = 'Save';                                             // React puts a new English phrase in the same node
    await flush();
    expect(text.nodeValue).toBe('محفوظ کریں');
    text.nodeValue = 'Something else';                                   // …then a text that is no phrase: left exactly as it is
    await flush();
    expect(text.nodeValue).toBe('Something else');
  });
  it('is quiet about its own writes (no loop) and switching off puts every original word back', async () => {
    document.body.innerHTML = '<div id="r"><p>Save</p><input placeholder="Search"><a title="Open">go</a></div>';
    enablePhraseLayer(DICT);
    await flush();
    await flush();
    expect(document.querySelector('p')!.textContent).toBe('محفوظ کریں');
    disablePhraseLayer();
    expect(isPhraseLayerOn()).toBe(false);
    expect(document.querySelector('p')!.textContent).toBe('Save');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('Search');
    expect(document.querySelector('a')!.getAttribute('title')).toBe('Open');
    document.querySelector('p')!.firstChild!.nodeValue = 'Save';
    await flush();
    expect(document.querySelector('p')!.textContent).toBe('Save');       // off means off
  });
  it('does not put English over something the person (or React) changed since', () => {
    document.body.innerHTML = '<p id="p">Save</p>';
    enablePhraseLayer(DICT);
    document.getElementById('p')!.firstChild!.nodeValue = 'My own words';
    disablePhraseLayer();
    expect(document.getElementById('p')!.textContent).toBe('My own words');
  });
  it('works with a real React tree: re-renders keep the translation, a changed count is not a phrase', async () => {
    function Screen() {
      const [n, setN] = useState(1);
      return (<div><button onClick={() => setN(n + 1)}>Open</button><p>Available orders ({n})</p><i>Save</i></div>);
    }
    enablePhraseLayer(DICT);
    render(<Screen />);
    await flush();
    expect(screen.getByRole('button').textContent).toBe('کھولیں');
    expect(document.querySelector('p')!.textContent).toBe('دستیاب آرڈرز (1)');
    fireEvent.click(screen.getByRole('button'));
    await flush();
    expect(document.querySelector('p')!.textContent).toBe('دستیاب آرڈرز (2)');
    expect(document.querySelector('i')!.textContent).toBe('محفوظ کریں');
  });
});

describe('when it runs', () => {
  it('only inside a phone app and only in Urdu; the till and the website are never touched', async () => {
    document.body.innerHTML = '<p>Save</p>';
    setLanguage('ur');
    syncPhraseLayer();                                                   // no ?app= and no app route: the till
    expect(isPhraseLayerOn()).toBe(false);
    window.history.replaceState(null, '', '/?app=rider');
    syncPhraseLayer();
    expect(isPhraseLayerOn()).toBe(true);
    setLanguage('en');
    syncPhraseLayer();
    expect(isPhraseLayerOn()).toBe(false);
    window.location.hash = '#/order/abcd1234';                           // the customer website, even with Urdu chosen
    window.history.replaceState(null, '', '/');
    setLanguage('ur');
    syncPhraseLayer();
    expect(isPhraseLayerOn()).toBe(false);
  });
  it('setAppLanguage switches the language, the page direction and the layer together; startAppLanguage restores the saved one', async () => {
    window.history.replaceState(null, '', '/?app=order-taker');
    document.body.innerHTML = '<p>Tables</p>';
    const stop = startAppLanguage();
    expect(appLanguage()).toBe('en');
    setAppLanguage('ur');
    expect(getLanguage()).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ur');
    expect(document.querySelector('p')!.textContent).toBe('ٹیبلز');
    setAppLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.querySelector('p')!.textContent).toBe('Tables');
    stop();
    // a restart: the phone was left on Urdu
    localStorage.setItem('dtpos-language', 'ur');
    setLanguage('en'); localStorage.setItem('dtpos-language', 'ur');
    const stop2 = startAppLanguage();
    expect(getLanguage()).toBe('ur');
    expect(isPhraseLayerOn()).toBe(true);
    stop2();
    expect(isPhraseLayerOn()).toBe(false);
  });
});

describe('the switch', () => {
  it('English | اردو, in a profile list or on a sign-in screen, and it follows the language', () => {
    window.history.replaceState(null, '', '/?app=rider');
    const { rerender } = render(<AppLanguageSwitch row />);
    expect(document.querySelector('[data-app-language-row]')).toBeTruthy();
    const en = screen.getByRole('radio', { name: 'English' }), ur = screen.getByRole('radio', { name: 'اردو' });
    expect(en).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(ur);
    expect(ur).toHaveAttribute('aria-checked', 'true');
    expect(getLanguage()).toBe('ur');
    fireEvent.click(en);
    expect(getLanguage()).toBe('en');
    rerender(<AppLanguageSwitch />);
    expect(document.querySelector('[data-app-language-row]')).toBeNull();
    expect(document.querySelector('[data-app-language-switch]')!.getAttribute('translate')).toBe('no');   // the two names are never translated
  });
  it('is on the Rider and Order Taker sign-in and profile, the Owner sign-in and More', () => {
    expect((read('src/pages/RiderAppPage.tsx').match(/<AppLanguageSwitch/g) || []).length).toBe(2);
    expect((read('src/pages/OrderTakerPortalPage.tsx').match(/<AppLanguageSwitch/g) || []).length).toBe(2);
    expect(read('src/components/owner/OwnerMore.tsx')).toContain('<AppLanguageSwitch row />');
    expect(read('src/components/OwnerSplash.tsx')).toContain('<AppLanguageSwitch onDark />');
    expect(read('src/App.tsx')).toContain('useEffect(() => startAppLanguage(), []);');
  });
});

describe('the dictionary', () => {
  const sources = [
    'src/pages/RiderAppPage.tsx', 'src/components/rider/RiderTabs.tsx', 'src/components/rider/RiderDelivery.tsx', 'src/components/rider/riderUi.tsx', 'src/lib/riderApp.ts',
    'src/pages/OrderTakerPortalPage.tsx', 'src/components/OrderTakerBills.tsx', 'src/components/otk/OrderTakerTables.tsx', 'src/components/pos/OrderTakerCart.tsx',
    'src/components/StaffProfileCard.tsx', 'src/components/PortalRestaurantBadge.tsx', 'src/lib/staffPortalAuth.ts', 'src/pages/POSScreen.tsx',
    'src/pages/OwnerAppPage.tsx', 'src/pages/OwnerLoginPage.tsx', 'src/components/OwnerSplash.tsx', 'src/components/AppLanguageSwitch.tsx',
    ...['OwnerAdmin', 'OwnerBranches', 'OwnerMenu', 'OwnerMore', 'OwnerOps', 'OwnerOrders', 'OwnerOverview', 'OwnerPurchasing', 'OwnerReports', 'ownerUi'].map(n => `src/components/owner/${n}.tsx`),
  ];
  const all = sources.map(read).join('\n').replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/\s+/g, ' ');
  it('has Urdu for the three apps, and nothing is empty or left in English', () => {
    expect(Object.keys(PHRASES_UR).length).toBeGreaterThanOrEqual(370);
    expect(PHRASE_COUNTS.rider).toBeGreaterThan(100);
    expect(PHRASE_COUNTS.orderTaker).toBeGreaterThan(50);
    expect(PHRASE_COUNTS.owner).toBeGreaterThan(150);
    for (const [k, v] of Object.entries(PHRASES_UR)) {
      expect(v.trim(), k).not.toBe('');
      if (/^[A-Za-z]/.test(k) && !/^(POS|WhatsApp)$/.test(k)) expect(v, `${k} is not translated`).toMatch(/[؀-ۿ]/);   // Arabic-script (Urdu) letters
      expect(v, k).not.toMatch(/[ऀ-ॿ]/);                                                                           // never Devanagari
    }
  });
  it('every phrase is still written exactly so in a screen (a reworded screen cannot leave a dead translation)', () => {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dead = Object.keys(PHRASES_UR).filter(k => {
      const key = normalizePhrase(k);
      if (!/\{n?\}/.test(key)) return !all.includes(key);
      // a template: {} / {n} is a value written into the text — `${n}` in a template string, or {n} in JSX
      return !new RegExp(key.split(/\{n?\}/).map(esc).join('(?:\\$\\{[^}]*\\}|\\{[^}]*\\})')).test(all);
    });
    expect(dead).toEqual([]);
  });
});
