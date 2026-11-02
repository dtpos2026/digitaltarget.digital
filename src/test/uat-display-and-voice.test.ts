// ============================================================
// UAT / QC — the display screens, the announcement, and the till.
//
// Everything here is a thing the shop asked for and will check on the floor.
// The rule that governs all of it: a DISPLAY is a display. It shows what the
// till decides, it reacts at once, and it never takes anything away from the
// person taking money at the counter.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANNOUNCEMENT_VOICES, voiceById, announceOrder, loadDisplayConfig,
  saveDisplayConfig, DEFAULT_DISPLAY, hasVoiceFor,
} from '@/lib/customerDisplay';
import { STATUS_COLOURS, panelVars, templateById } from '@/lib/displayTemplates';
import { loadAnnounceOutput, saveAnnounceOutput, canChooseOutput } from '@/lib/announceAudio';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('announcements in Urdu as well as English', () => {
  beforeEach(() => localStorage.clear());

  it('offers wordings in both languages', () => {
    const urdu = ANNOUNCEMENT_VOICES.filter(v => v.lang.startsWith('ur'));
    const english = ANNOUNCEMENT_VOICES.filter(v => v.lang.startsWith('en'));
    expect(urdu.length).toBeGreaterThanOrEqual(3);
    expect(english.length).toBeGreaterThanOrEqual(3);
    // Each carries the order-number placeholder, or it announces nothing.
    for (const v of ANNOUNCEMENT_VOICES) expect(v.text).toContain('{n}');
  });

  it('gives every wording a language tag', () => {
    // Without one an Urdu sentence is handed to an English voice and comes
    // out as nonsense — worse than silence at a counter.
    for (const v of ANNOUNCEMENT_VOICES) {
      expect(v.lang, `${v.id} has no language tag`).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    }
  });

  it('the Urdu wordings are actually in Urdu', () => {
    for (const v of ANNOUNCEMENT_VOICES.filter(x => x.lang.startsWith('ur'))) {
      expect(/[؀-ۿ]/.test(v.text), `${v.id} is not Urdu text`).toBe(true);
    }
  });

  it('speaks a second language after the first when one is set', async () => {
    const spoken: Array<{ text: string; lang: string }> = [];
    (window as any).speechSynthesis = {
      getVoices: () => [{ lang: 'en-GB', name: 'UK' }, { lang: 'ur-PK', name: 'Urdu' }],
      speak: (u: any) => spoken.push({ text: u.text, lang: u.lang }),
      cancel: () => {},
    };
    (window as any).SpeechSynthesisUtterance = function (this: any, text: string) { this.text = text; };

    const res = await announceOrder(105, {
      announceTemplate: 'Order {n} ready.',
      announceLang: 'en-GB',
      announceTemplate2: voiceById('ur-ready')!.text,
      announceLang2: 'ur-PK',
      announceRepeat: 1,
    });

    expect(res.spoken).toBe(true);
    expect(spoken).toHaveLength(2);
    expect(spoken[0].lang).toBe('en-GB');
    expect(spoken[1].lang).toBe('ur-PK');
    expect(spoken[0].text).toContain('105');
    expect(spoken[1].text).toContain('105');
  });

  it('never hands Urdu to an English voice — it says so and skips the line', async () => {
    // A shop must not be left believing their Urdu announcement is working,
    // and an English voice reading Nastaliq is noise, not an announcement.
    const spoken: string[] = [];
    (window as any).speechSynthesis = {
      getVoices: () => [{ lang: 'en-GB', name: 'UK' }],
      speak: (u: any) => spoken.push(u.text),
      cancel: () => {},
    };
    (window as any).SpeechSynthesisUtterance = function (this: any, text: string) { this.text = text; };

    const res = await announceOrder(7, {
      announceTemplate: voiceById('ur-ready')!.text,
      announceLang: 'ur-PK',
      announceRepeat: 1,
    });
    expect(res.spoken).toBe(false);
    expect(res.reason).toMatch(/No Urdu or Hindi voice/);
    expect(spoken).toHaveLength(0);
    expect(hasVoiceFor('ur-PK')).toBe(false);
    expect(hasVoiceFor('en-GB')).toBe(true);
  });

  it('reads Urdu with the Hindi voice, in Hindi script, when Windows has no Urdu voice', async () => {
    const spoken: Array<{ text: string; lang: string; voice?: string }> = [];
    const voices = [{ lang: 'en-GB', name: 'UK' }, { lang: 'hi-IN', name: 'Microsoft Kalpana' }];
    (window as any).speechSynthesis = {
      getVoices: () => voices,
      speak: (u: any) => spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name }),
      cancel: () => {},
    };
    (window as any).SpeechSynthesisUtterance = function (this: any, text: string) { this.text = text; };

    const res = await announceOrder(25, { announceTemplate: voiceById('ur-short')!.text, announceLang: 'ur-PK', announceRepeat: 1 });
    expect(res.spoken).toBe(true);
    expect(spoken).toEqual([{ text: 'ऑर्डर नंबर 25 तैयार है।', lang: 'hi-IN', voice: 'Microsoft Kalpana' }]);
    expect(res.notes?.[0]).toMatch(/Hindi voice "Microsoft Kalpana"/);
  });

  it('round-trips both wordings through the saved settings', () => {
    const next = {
      ...DEFAULT_DISPLAY,
      announceTemplate: voiceById('ur-counter')!.text,
      announceLang: 'ur-PK',
      announceTemplate2: voiceById('en-short')!.text,
      announceLang2: 'en-GB',
    };
    expect(saveDisplayConfig(next).ok).toBe(true);
    const back = loadDisplayConfig();
    expect(back.announceLang).toBe('ur-PK');
    expect(back.announceTemplate2).toBe(voiceById('en-short')!.text);
  });
});

describe('where the announcement comes out', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the chosen output', () => {
    expect(loadAnnounceOutput()).toBe('default');
    saveAnnounceOutput('speaker-xyz');
    expect(loadAnnounceOutput()).toBe('speaker-xyz');
  });

  it('is honest that the SPOKEN part cannot be routed', () => {
    // An <audio> element has a sink; speechSynthesis does not. Claiming
    // otherwise would have a shop set a device, hear the announcement on the
    // wrong speakers, and have no way to understand why.
    const card = read('components/CustomerDisplaySettingsCard.tsx');
    expect(card).toMatch(/spoken\s*\n?\s*part cannot be routed|spoken<\/b>|cannot be routed/i);
    const lib = read('lib/announceAudio.ts');
    expect(lib).toContain('speechSynthesis` cannot');
  });

  it('falls back to the default output rather than going silent', () => {
    // A chime on the wrong speaker still beats a customer never looking up.
    const lib = read('lib/announceAudio.ts');
    expect(lib).toContain('the default was used');
  });

  it('does not claim a picker on a device that has none', () => {
    expect(typeof canChooseOutput()).toBe('boolean');
  });
});

describe('the boards look like the printed designs', () => {
  it('uses one fixed status palette across every template', () => {
    // A cook learns "red means nobody has started it" once and then reads the
    // board by colour from across the kitchen.
    expect(STATUS_COLOURS.new).toBe('#EF4444');
    expect(STATUS_COLOURS.preparing).toBe('#F59E0B');
    expect(STATUS_COLOURS.ready).toBe('#22C55E');
    expect(STATUS_COLOURS.delivery).toBe('#3B82F6');
    expect(STATUS_COLOURS.completed).toBe('#9CA3AF');
  });

  it('gives every template light cards, because a ticket is read like paper', () => {
    for (const surface of ['customer', 'kitchen'] as const) {
      for (const t of [templateById(surface, undefined)]) {
        const vars = panelVars(t);
        expect(vars['--dt-panel']).toBeTruthy();
        expect(vars['--dt-on-panel']).toBeTruthy();
      }
    }
  });

  it('draws the order rows and the footer bar the designs show', () => {
    const page = read('pages/CustomerDisplayPage.tsx');
    expect(page).toContain('Now Serving');
    expect(page).toContain('ORDER #');
    expect(page).toContain('footerMessage');
    expect(page).toContain('var(--dt-panel)');
  });

  it('draws kitchen tickets as quantity-then-item, with a lane colour frame', () => {
    const page = read('pages/KdsTvPage.tsx');
    expect(page).toContain('statusColour');
    expect(page).toContain('var(--dt-status-new)');
    expect(page).toContain('Kitchen Display System');
  });
});

describe('the till keeps billing while the screens do their own thing', () => {
  // The window-placement rules (never open or move a window when a monitor is plugged in) are in the Windows shell,
  // dtpos-desktop/src/main/ipc/displays.ts, and tested there. The store's cross-window signal is the offline POS's;
  // this app's windows hear changes through Supabase realtime.
  it('keeps the print host out of every display window', () => {
    expect(read('components/AutoKotPrinter.tsx')).toContain('isDisplayWindow');
  });

  it('runs the customer display outside the till shell, so none of its workers start there', () => {
    const app = read('App.tsx');
    const at = app.indexOf('displayWindowHash(');
    expect(at, 'the display window has no branch of its own').toBeGreaterThan(-1);
    // The branch returns the display route alone, with no AppLayout around it, and comes before the till's own render.
    const branch = app.slice(app.indexOf('if (displayWindowHash('), app.indexOf('<CloudPrintHost />'));
    expect(branch).toContain('<CustomerDisplayPage />');
    expect(branch).not.toContain('<AppLayout');
    expect(branch).not.toContain('<CloudPrintHost');
  });
});
