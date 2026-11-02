// ============================================================
// CUSTOMER DISPLAY — the screen the CUSTOMER watches.
//
// Not the same thing as the Kitchen Display
// -----------------------------------------
// The KDS is for cooks: it shows what to make, and it is dense on purpose.
// This screen is for the person standing at the counter waiting for food.
// They need exactly two things — is my order being made, and is it ready —
// read from several metres away, plus something to look at in between.
//
// That second part is why the media panel exists. A customer display that is
// only numbers is a wasted screen; a restaurant already has deals, offers and
// brand imagery it wants seen, and this is the one moment the customer is
// standing still and looking up.
//
// Device-local on purpose: the banner set and the screen layout belong to the
// machine driving that particular display, not to the shop's shared settings.
// One branch may run a TV in the lobby and another none at all.
// ============================================================

import { templateById, pickAutoTemplate, type DisplayTemplate } from './displayTemplates';
import { cancelSpeech, speakLines } from './speech';

export type MediaKind = 'image' | 'video';

/**
 * How a banner fills its panel.
 *
 *  contain — the whole image, letterboxed. Nothing is cropped and nothing is
 *            distorted. The default, because a shop's deal poster with the
 *            price cut off it is worse than a black band.
 *  cover   — fills the panel, cropping the overflow. For photographs.
 *  fill    — stretches to the panel. Offered because a shop sometimes has
 *            artwork made for exactly this screen, but it is the only option
 *            that can distort, so it is never a default.
 */
export type MediaFit = 'contain' | 'cover' | 'fill';

/** Where the media sits in its panel when it does not fill it. */
export type MediaPosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface DisplayMedia {
  id: string;
  kind: MediaKind;
  /**
   * Data URL for an uploaded image, or a file/URL for a video.
   *
   * Stored exactly as the file was read. The image is never re-encoded,
   * resized or passed through a canvas on the way in, so what the shop
   * uploaded is what the screen shows — the sizing below is applied by CSS at
   * display time, which costs nothing and loses nothing.
   */
  src: string;
  /** Shown under the media; optional. */
  caption?: string;
  /** Seconds this item stays on screen. Ignored for video (plays through). */
  seconds?: number;
  /** How it fills its panel. Defaults to `contain` — never crops, never distorts. */
  fit?: MediaFit;
  /** Where it sits when it does not fill the panel. */
  position?: MediaPosition;
  /** Share of the panel's width this item uses (10–100%). */
  widthPct?: number;
  /** Share of the panel's height this item uses (10–100%). */
  heightPct?: number;
}

export interface CustomerDisplayConfig {
  /** Master switch for the customer-facing screen. */
  enabled: boolean;
  /** Headline shown above the order columns. */
  heading: string;
  /** Read the order number aloud when it becomes ready. */
  announce: boolean;
  /** Announcement wording. `{n}` is replaced with the order number. */
  announceTemplate: string;
  /**
   * Language tag for `announceTemplate`, so Windows picks a matching voice.
   *
   * Without it an Urdu sentence is handed to an English voice and comes out
   * as nonsense.
   */
  announceLang: string;
  /**
   * A SECOND announcement, in another language, spoken after the first.
   *
   * Most counters here want the number in Urdu and in English. Empty means
   * one announcement only.
   */
  announceTemplate2: string;
  announceLang2: string;
  /** Times an announcement repeats, so a distracted customer still catches it. */
  announceRepeat: number;
  /**
   * When Windows has no Urdu voice (it ships none), read Urdu lines with the
   * Hindi voice after rewriting them in Hindi script. Default on; off means
   * Urdu lines are skipped on such a computer.
   */
  announceHindiForUrdu: boolean;
  /**
   * Play a short chime before the number is spoken.
   *
   * It is the sound that makes the room look up; the words only work on
   * someone who is already listening. The chime can be routed to a chosen
   * output (see announceAudio.ts) — the spoken part cannot, which the
   * settings screen states rather than hides.
   */
  announceChime: boolean;
  /** Show how long each order has been waiting. */
  showWaitTime: boolean;
  /** Keep a ready order on screen this many seconds before it drops off. */
  readyHoldSeconds: number;
  /** Rotating banners / video beside the order columns. */
  media: DisplayMedia[];
  /** Seconds per banner when the item does not set its own. */
  mediaSeconds: number;
  /** Which look the screen wears. See src/lib/displayTemplates.ts. */
  templateId: string;
  /**
   * 'manual' uses `templateId` as chosen. 'automatic' reads the screen's own
   * resolution and aspect and picks the template that suits it — so the same
   * install looks right on a 1920x1080 TV and on a small square panel over a
   * counter, without anybody being asked to know which to pick.
   */
  templateMode: 'manual' | 'automatic';
  /**
   * Share of the width the ORDER columns take when banners are shown (%).
   * 70 / 50 / 30 are the presets; any value from 20 to 100 is allowed.
   * 100 means the banners are not shown at all.
   */
  orderRatio: number;
  /**
   * The message on the bar across the bottom of the order panel.
   *
   * On the printed designs this is "Thanks for your Patience!" and "Enjoy
   * Your Meal!". It is the last thing a waiting customer reads, so it is the
   * shop's words rather than ours. Empty hides the bar.
   */
  footerMessage: string;
  /**
   * Show the "Powered by Digital Target" line.
   *
   * On by default and a single small line. The screen's branding is the
   * restaurant's — its logo, its name — and this is the developer credit
   * beneath it, which a shop may turn off.
   */
  showDeveloperCredit: boolean;
}

export const DEFAULT_DISPLAY: CustomerDisplayConfig = {
  enabled: false,
  heading: 'ORDER STATUS',
  announce: true,
  // Spoken, not printed — so it reads as speech rather than as a label.
  announceTemplate: 'Order number {n} is ready. Please collect.',
  announceLang: 'en-GB',
  // Off until a shop turns it on: two announcements on every order is a lot
  // of talking for a counter that only needed one.
  announceTemplate2: '',
  announceLang2: 'ur-PK',
  announceRepeat: 2,
  announceHindiForUrdu: true,
  announceChime: true,
  showWaitTime: true,
  // Long enough for someone who stepped away to come back and still see it.
  readyHoldSeconds: 90,
  media: [],
  mediaSeconds: 8,
  footerMessage: 'Thanks for your patience!',
  templateId: 'premium',
  templateMode: 'manual',
  orderRatio: 70,
  showDeveloperCredit: true,
};

const KEY = 'dtpos-customer-display-v1';

// ============================================================
// ANNOUNCEMENT VOICES
//
// A Pakistani counter is not an English-only counter. The customer waiting
// for order 105 may well not read the screen, which is the whole reason the
// number is spoken — and speaking it in a language they do not use is the
// same as not speaking it.
//
// So the wording is a template the shop picks, each with the LANGUAGE TAG
// that Windows needs to choose a voice. `lang` is what makes this work: the
// browser picks an Urdu voice for `ur-PK` and an English one for `en-GB`,
// and without it a Nastaliq sentence is read out by an English voice as
// nonsense. A shop can also announce twice, in two languages, which is what
// most counters here actually want.
//
// `{n}` is the order number. Nothing else is substituted, because a template
// a shop can mistype into a crash is not a feature.
// ============================================================
export interface AnnouncementVoice {
  id: string;
  /** Shown in the picker. */
  label: string;
  /** BCP-47 tag Windows matches a voice against. */
  lang: string;
  /** The sentence. `{n}` becomes the order number. */
  text: string;
}

export const ANNOUNCEMENT_VOICES: AnnouncementVoice[] = [
  {
    id: 'en-ready',
    label: 'English — order is ready',
    lang: 'en-GB',
    text: 'Order number {n} is ready. Please collect.',
  },
  {
    id: 'en-counter',
    label: 'English — come to the counter',
    lang: 'en-GB',
    text: 'Order {n}, please come to the counter.',
  },
  {
    id: 'en-short',
    label: 'English — short',
    lang: 'en-GB',
    text: 'Order {n} ready.',
  },
  {
    id: 'ur-ready',
    label: 'اردو — آرڈر تیار ہے',
    lang: 'ur-PK',
    text: 'آرڈر نمبر {n} تیار ہے۔ براہِ کرم کاؤنٹر سے وصول کریں۔',
  },
  {
    id: 'ur-counter',
    label: 'اردو — کاؤنٹر پر تشریف لائیں',
    lang: 'ur-PK',
    text: 'آرڈر نمبر {n}، براہِ کرم کاؤنٹر پر تشریف لائیں۔',
  },
  {
    id: 'ur-short',
    label: 'اردو — مختصر',
    lang: 'ur-PK',
    text: 'آرڈر نمبر {n} تیار ہے۔',
  },
  // Hindi script, same spoken words — for a computer with a Hindi voice.
  // (The Urdu wordings above are also read by the Hindi voice automatically
  // when no Urdu voice is installed.)
  {
    id: 'hi-ready',
    label: 'Hindi voice — order is ready',
    lang: 'hi-IN',
    text: 'ऑर्डर नंबर {n} तैयार है। मेहरबानी करके काउंटर से ले लें।',
  },
  {
    id: 'hi-counter',
    label: 'Hindi voice — come to the counter',
    lang: 'hi-IN',
    text: 'ऑर्डर नंबर {n}, मेहरबानी करके काउंटर पर तशरीफ़ लाएं।',
  },
  {
    id: 'hi-short',
    label: 'Hindi voice — short',
    lang: 'hi-IN',
    text: 'ऑर्डर नंबर {n} तैयार है।',
  },
];

export function voiceById(id: string | undefined): AnnouncementVoice | undefined {
  return ANNOUNCEMENT_VOICES.find(v => v.id === id);
}

const FITS = ['contain', 'cover', 'fill'];
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function loadDisplayConfig(): CustomerDisplayConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_DISPLAY };
    const p = JSON.parse(raw) || {};
    return {
      enabled: p.enabled === true,
      heading: typeof p.heading === 'string' && p.heading.trim() ? p.heading : DEFAULT_DISPLAY.heading,
      announce: p.announce !== false,
      announceTemplate: typeof p.announceTemplate === 'string' && p.announceTemplate.trim()
        ? p.announceTemplate : DEFAULT_DISPLAY.announceTemplate,
      announceLang: typeof p.announceLang === 'string' && p.announceLang.trim()
        ? p.announceLang : DEFAULT_DISPLAY.announceLang,
      announceTemplate2: typeof p.announceTemplate2 === 'string' ? p.announceTemplate2 : '',
      announceLang2: typeof p.announceLang2 === 'string' && p.announceLang2.trim()
        ? p.announceLang2 : DEFAULT_DISPLAY.announceLang2,
      announceRepeat: clampNum(p.announceRepeat, 1, 5, DEFAULT_DISPLAY.announceRepeat),
      announceHindiForUrdu: p.announceHindiForUrdu !== false,
      announceChime: p.announceChime !== false,
      showWaitTime: p.showWaitTime !== false,
      readyHoldSeconds: clampNum(p.readyHoldSeconds, 10, 600, DEFAULT_DISPLAY.readyHoldSeconds),
      media: Array.isArray(p.media)
        ? p.media
            .filter((m: any) => m && typeof m.src === 'string' && m.src)
            .map((m: any, i: number) => ({
              id: String(m.id || `m${i}`),
              kind: m.kind === 'video' ? 'video' : 'image',
              src: String(m.src),
              caption: typeof m.caption === 'string' ? m.caption : undefined,
              seconds: Number.isFinite(Number(m.seconds)) ? clampNum(m.seconds, 2, 120, 8) : undefined,
              fit: FITS.includes(m.fit) ? m.fit : undefined,
              position: POSITIONS.includes(m.position) ? m.position : undefined,
              widthPct: Number.isFinite(Number(m.widthPct)) ? clampNum(m.widthPct, 10, 100, 100) : undefined,
              heightPct: Number.isFinite(Number(m.heightPct)) ? clampNum(m.heightPct, 10, 100, 100) : undefined,
            }))
        : [],
      mediaSeconds: clampNum(p.mediaSeconds, 2, 120, DEFAULT_DISPLAY.mediaSeconds),
      footerMessage: typeof p.footerMessage === 'string' ? p.footerMessage : DEFAULT_DISPLAY.footerMessage,
      templateId: typeof p.templateId === 'string' && p.templateId ? p.templateId : DEFAULT_DISPLAY.templateId,
      templateMode: p.templateMode === 'automatic' ? 'automatic' : 'manual',
      orderRatio: clampNum(p.orderRatio, 20, 100, DEFAULT_DISPLAY.orderRatio),
      showDeveloperCredit: p.showDeveloperCredit !== false,
    };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

/**
 * Persist the configuration.
 *
 * Banners are stored as data URLs, so the whole config competes for the same
 * few megabytes localStorage allows. A quota failure is reported rather than
 * swallowed: silently dropping the image a shop just added would look like
 * the upload worked when it did not.
 */
export function saveDisplayConfig(cfg: CustomerDisplayConfig): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
    try { window.dispatchEvent(new CustomEvent('dtpos-customer-display-changed', { detail: cfg })); } catch { /* no window */ }
    return { ok: true };
  } catch (e: any) {
    const quota = /quota|exceeded/i.test(String(e?.name || e?.message || ''));
    return {
      ok: false,
      error: quota
        ? 'There is not enough browser storage left for that image. Use a smaller file, or remove a banner first.'
        : (e?.message || 'Could not save the display settings.'),
    };
  }
}

/** Roughly how much space the stored config takes, for the settings screen. */
export function displayConfigSizeKb(cfg: CustomerDisplayConfig): number {
  try { return Math.round(JSON.stringify(cfg).length / 1024); } catch { return 0; }
}

/**
 * Speak an order number.
 *
 * Goes through the shared speech service (lib/speech.ts), which waits for
 * Windows to finish listing its voices and picks one that can actually read
 * each line: an Urdu line goes to an Urdu voice, or — Windows ships none — is
 * rewritten in Hindi script for a Hindi voice, or is skipped with a reason.
 * It is never handed to an English voice to be read as noise. A line that
 * cannot be spoken is reported, never pretended away; the display carries on
 * either way.
 */
export async function announceOrder(
  orderNumber: number | string,
  cfg: Pick<CustomerDisplayConfig, 'announceTemplate' | 'announceRepeat'>
     & Partial<Pick<CustomerDisplayConfig, 'announceLang' | 'announceTemplate2' | 'announceLang2' | 'announceHindiForUrdu'>>,
): Promise<{ spoken: boolean; reason?: string; notes?: string[] }> {
  try {
    const lines: Array<{ text: string; lang: string }> = [];
    const add = (tpl: string | undefined, lang: string | undefined) => {
      const text = String(tpl || '').replace(/\{n\}/g, String(orderNumber)).trim();
      if (text) lines.push({ text, lang: lang || 'en-GB' });
    };
    add(cfg.announceTemplate, cfg.announceLang);
    // The second language, when the shop has set one. Most counters here want
    // the number in Urdu and again in English.
    add(cfg.announceTemplate2, cfg.announceLang2);
    if (!lines.length) return { spoken: false, reason: 'The announcement text is empty.' };

    const r = await speakLines(lines, cfg.announceRepeat || 1, { hindiForUrdu: cfg.announceHindiForUrdu !== false });
    const reason = r.skipped[0];
    return r.spoken > 0 ? { spoken: true, reason, notes: r.notes } : { spoken: false, reason: reason || 'Speech failed.', notes: r.notes };
  } catch (e: any) {
    return { spoken: false, reason: e?.message || 'Speech failed.' };
  }
}

/**
 * Which languages this computer can actually speak.
 *
 * Used by the settings screen to tell a shop BEFORE they rely on it that
 * Windows has no Urdu voice installed, rather than after a customer has
 * stood at the counter listening to nothing useful.
 */
export function installedVoiceLanguages(): string[] {
  try {
    const list = window.speechSynthesis?.getVoices?.() || [];
    return Array.from(new Set(list.map(v => String(v.lang || '').toLowerCase()).filter(Boolean)));
  } catch {
    return [];
  }
}

/** Does this computer have a voice for the given tag (or its base language)? */
export function hasVoiceFor(lang: string): boolean {
  const langs = installedVoiceLanguages();
  if (!langs.length) return false;
  const want = String(lang || '').toLowerCase();
  const base = want.split('-')[0];
  return langs.some(l => l === want || l.replace('_', '-') === want || l.startsWith(base));
}

/** Stop anything currently being spoken. */
export function cancelAnnouncements(): void {
  cancelSpeech();
}


/**
 * The template this configuration should render with, for a screen of the
 * given size.
 *
 * In manual mode the shop's choice is returned unchanged. In automatic mode
 * the screen's own dimensions decide — which is what makes one install look
 * right on a wide TV and on a small counter panel without anybody choosing.
 */
export function resolveDisplayTemplate(
  cfg: Pick<CustomerDisplayConfig, 'templateId' | 'templateMode'>,
  width?: number,
  height?: number,
): DisplayTemplate {
  if (cfg.templateMode === 'automatic') {
    const w = Number.isFinite(Number(width)) ? Number(width) : 0;
    const h = Number.isFinite(Number(height)) ? Number(height) : 0;
    return pickAutoTemplate('customer', w, h);
  }
  return templateById('customer', cfg.templateId);
}

/**
 * The CSS a single media item is displayed with.
 *
 * Built here rather than in the page so the settings preview and the real
 * screen cannot disagree about what a shop's sizing will actually look like.
 */
export function mediaStyle(m: DisplayMedia): Record<string, string> {
  const fit: MediaFit = m.fit || 'contain';
  const pos: MediaPosition = m.position || 'center';
  const objectPosition =
    pos === 'top' ? 'center top'
    : pos === 'bottom' ? 'center bottom'
    : pos === 'left' ? 'left center'
    : pos === 'right' ? 'right center'
    : 'center center';
  return {
    width: `${m.widthPct ?? 100}%`,
    height: `${m.heightPct ?? 100}%`,
    objectFit: fit,
    objectPosition,
  };
}
