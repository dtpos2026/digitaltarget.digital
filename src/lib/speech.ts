// ============================================================
// SPEECH — one text-to-speech service for the Customer Display, the Kitchen
// Display and any other screen that talks.
//
// What Windows can really do (and what this module is honest about):
//   • DT POS runs on Chromium, whose speech engine uses the voices Windows
//     exposes to desktop apps. English voices are always there.
//   • Windows does not ship an Urdu text-to-speech voice. A Hindi voice
//     (Microsoft Kalpana / Hemant / Swara) is common, and spoken Hindi is
//     the same everyday language as spoken Urdu — but it cannot read Urdu
//     letters. So an Urdu line is either read by an Urdu voice (if one was
//     installed), or rewritten in Hindi script and read by the Hindi voice,
//     or skipped with a clear reason. It is never handed to an English voice
//     that would read Nastaliq as noise.
//   • Chromium fills its voice list asynchronously; the first call usually
//     sees an empty list. The list is awaited here (with a timeout).
//
// Providers are pluggable (registerSpeechProvider) so another engine — an
// offline neural voice, a cloud voice — can be added later without touching
// the screens. Speech failure never throws into the caller.
// ============================================================
import { hasDevanagari, hasUrduScript, urduToDevanagari } from './urduToHindi';

export interface VoiceInfo {
  name: string;
  /** BCP-47, lower case, '-' separated (e.g. 'hi-in'). */
  lang: string;
  local: boolean;
  isDefault: boolean;
  /** Which engine owns the voice ('web' = Chromium, 'onecore' = Windows apps). */
  provider?: string;
  /** Engine-specific id, when the engine has one. */
  id?: string;
}

export interface SpeakOptions { rate?: number; pitch?: number; volume?: number }

export interface SpeechProvider {
  id: string;
  label: string;
  isSupported(): boolean;
  listVoices(timeoutMs?: number, refresh?: boolean): Promise<VoiceInfo[]>;
  /** Resolves once the line is queued (or played); never throws. */
  speak(text: string, voice: VoiceInfo, lang: string, opts?: SpeakOptions): Promise<boolean>;
  /** Resolves when nothing queued on this engine is still playing. */
  idle?(): Promise<void>;
  cancel(): void;
}

const norm = (lang: string) => String(lang || '').toLowerCase().replace('_', '-');
const base = (lang: string) => norm(lang).split('-')[0];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ---------- 1. Chromium's own voices (classic Windows SAPI voices) ----------
function webSpeechProvider(): SpeechProvider {
  const synth = () => (typeof window !== 'undefined' ? window.speechSynthesis : undefined);
  const toInfo = (v: SpeechSynthesisVoice): VoiceInfo => ({
    name: String(v.name || ''), lang: norm(v.lang), local: v.localService !== false, isDefault: !!v.default, provider: 'web',
  });
  return {
    id: 'web',
    label: 'Windows voices (desktop)',
    isSupported: () => !!synth() && typeof SpeechSynthesisUtterance !== 'undefined',
    listVoices(timeoutMs = 1500) {
      const s = synth();
      if (!s) return Promise.resolve([]);
      const read = () => { try { return s.getVoices() || []; } catch { return []; } };
      const now = read();
      if (now.length) return Promise.resolve(now.map(toInfo));
      // Chromium fills the list asynchronously; the first call is usually empty.
      return new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try { s.removeEventListener?.('voiceschanged', finish); } catch { /* old engines */ }
          resolve(read().map(toInfo));
        };
        try { s.addEventListener?.('voiceschanged', finish); } catch { /* old engines */ }
        setTimeout(finish, timeoutMs);
      });
    },
    async speak(text, voice, lang, opts = {}) {
      const s = synth();
      if (!s) return false;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        const real = (s.getVoices?.() || []).find(v => v.name === voice.name);
        if (real) u.voice = real;
        // Slower than conversational: it is heard across a noisy room.
        u.rate = opts.rate ?? 0.9;
        u.pitch = opts.pitch ?? 1;
        u.volume = opts.volume ?? 1;
        s.speak(u);
        return true;
      } catch { return false; }
    },
    async idle() {
      const s = synth();
      for (let waited = 0; s && (s.speaking || s.pending) && waited < 20000; waited += 100) await sleep(100);
    },
    cancel() { try { synth()?.cancel(); } catch { /* nothing to cancel */ } },
  };
}

// ---------- 2. Windows "OneCore" voices, through the desktop app ----------
// Voices added in Windows Settings → Speech → Add voices (Hindi Kalpana /
// Hemant / Swara…) are invisible to Chromium. The desktop app reaches them
// through electron/windowsSpeech.cjs. In a browser this engine is absent.
interface TtsBridge {
  ttsVoices(refresh?: boolean): Promise<{ ok: boolean; voices: Array<{ name: string; id: string; lang: string; isDefault?: boolean }>; error?: string }>;
  ttsSpeak(job: { text: string; voice: string; voiceId?: string; rate?: number; volume?: number }): Promise<{ ok: boolean; error?: string }>;
  ttsCancel(): Promise<unknown>;
}
function bridge(): TtsBridge | null {
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: Partial<TtsBridge> }).electronAPI : undefined;
  return api && typeof api.ttsSpeak === 'function' && typeof api.ttsVoices === 'function' ? api as TtsBridge : null;
}
function windowsOneCoreProvider(): SpeechProvider {
  let cache: Promise<VoiceInfo[]> | null = null;
  return {
    id: 'onecore',
    label: 'Windows voices (Settings → Speech)',
    isSupported: () => !!bridge(),
    listVoices(timeoutMs = 9000, refresh = false) {
      const b = bridge();
      if (!b) return Promise.resolve([]);
      if (!cache || refresh) {
        const load = b.ttsVoices(refresh)
          .then(r => (r?.voices || []).map(v => ({
            name: v.name, id: v.id, lang: norm(v.lang), local: true, isDefault: !!v.isDefault, provider: 'onecore',
          })))
          .catch(() => [] as VoiceInfo[]);
        cache = Promise.race([load, sleep(timeoutMs).then(() => [] as VoiceInfo[])]);
        // A failed or slow first look is retried next time rather than remembered.
        void cache.then(list => { if (!list.length) cache = null; });
      }
      return cache;
    },
    async speak(text, voice, _lang, opts = {}) {
      const b = bridge();
      if (!b) return false;
      try {
        // Resolves after the line has played, which keeps the order of lines
        // across the two engines.
        const r = await b.ttsSpeak({ text, voice: voice.name, voiceId: voice.id, rate: opts.rate ?? 0.9, volume: opts.volume ?? 1 });
        return !!r?.ok;
      } catch { return false; }
    },
    cancel() { try { void bridge()?.ttsCancel(); } catch { /* nothing to cancel */ } },
  };
}

// A voice both engines list ("Microsoft Zira - English (United States)" and
// "Microsoft Zira") is the same voice; keep the Chromium one — it is faster.
const voiceKey = (v: VoiceInfo) => `${String(v.name || "").replace(/\s+-\s+.*$/, '').replace(/\s+desktop$/i, '').trim().toLowerCase()}|${base(v.lang)}`;

let providers: SpeechProvider[] = [webSpeechProvider(), windowsOneCoreProvider()];

/** Add another engine (offline neural voice, cloud voice…) after the built-in ones. */
export function registerSpeechProvider(p: SpeechProvider) {
  providers = [...providers.filter(x => x.id !== p.id), p];
}
export function speechProviders(): SpeechProvider[] { return providers; }
function providerFor(v: VoiceInfo): SpeechProvider | undefined {
  return providers.find(p => p.id === (v.provider || 'web')) || providers[0];
}
const anySupported = () => providers.some(p => { try { return p.isSupported(); } catch { return false; } });

/** Every voice this computer offers, all engines, Chromium's first. */
export async function listAllVoices(refresh = false): Promise<VoiceInfo[]> {
  const lists = await Promise.all(providers.map(p => {
    try { return p.isSupported() ? p.listVoices(undefined, refresh).catch(() => []) : Promise.resolve([]); } catch { return Promise.resolve([]); }
  }));
  const seen = new Set<string>();
  const out: VoiceInfo[] = [];
  lists.forEach((list, i) => {
    for (const v of list) {
      const tagged = { ...v, provider: v.provider || providers[i].id };
      const k = voiceKey(tagged);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(tagged);
    }
  });
  return out;
}

// ---------- choosing a voice ----------
export function findVoice(voices: VoiceInfo[], lang: string): VoiceInfo | undefined {
  const want = norm(lang);
  const b = base(lang);
  const pick = (list: VoiceInfo[]) => list.find(v => v.local) || list[0];
  return pick(voices.filter(v => v.lang === want)) || pick(voices.filter(v => base(v.lang) === b));
}

export type SpeechRoute =
  | { kind: 'native'; voice: VoiceInfo; text: string; lang: string }
  | { kind: 'hindi-for-urdu'; voice: VoiceInfo; text: string; lang: string }
  | { kind: 'skip'; reason: string };

export interface RouteOptions {
  /** Read Urdu with a Hindi voice when no Urdu voice is installed (default true). */
  hindiForUrdu?: boolean;
}

/** Decide how one line will be spoken — pure, so it is testable. */
export function planSpeech(text: string, lang: string, voices: VoiceInfo[], opts: RouteOptions = {}): SpeechRoute {
  const t = String(text || '').trim();
  if (!t) return { kind: 'skip', reason: 'The announcement text is empty.' };
  if (!voices.length) return { kind: 'skip', reason: 'Windows reports no speech voices on this computer.' };
  const b = base(lang);
  const urduScript = hasUrduScript(t);
  const hindiScript = hasDevanagari(t);

  if ((b === 'ur' && !hindiScript) || (urduScript && b !== 'hi')) {
    const ur = findVoice(voices, 'ur-PK');
    if (ur) return { kind: 'native', voice: ur, text: t, lang: 'ur-PK' };
    const hi = opts.hindiForUrdu !== false ? findVoice(voices, 'hi-IN') : undefined;
    if (hi) return { kind: 'hindi-for-urdu', voice: hi, text: urduScript ? urduToDevanagari(t) : t, lang: 'hi-IN' };
    // Roman Urdu is Latin text: an English voice can read it.
    if (!urduScript) {
      const en = findVoice(voices, 'en-GB') || findVoice(voices, 'en-US');
      if (en) return { kind: 'native', voice: en, text: t, lang: en.lang };
    }
    return {
      kind: 'skip',
      reason: opts.hindiForUrdu === false
        ? 'No Urdu voice is installed in Windows, so the Urdu line was not spoken.'
        : 'No Urdu or Hindi voice is installed in Windows, so the Urdu line was not spoken.',
    };
  }

  if (b === 'hi' || hindiScript) {
    const hi = findVoice(voices, 'hi-IN');
    if (hi) return { kind: 'native', voice: hi, text: urduScript ? urduToDevanagari(t) : t, lang: 'hi-IN' };
    return { kind: 'skip', reason: 'No Hindi voice is installed in Windows, so the Hindi line was not spoken.' };
  }

  // Any other language: its own voice, never a voice that cannot read the script.
  const v = findVoice(voices, lang);
  if (v) return { kind: 'native', voice: v, text: t, lang };
  if (b === 'en' || !b) {
    // English with no English voice listed: Windows' default voice reads
    // Latin text (some engines report a voice without a language).
    const any = voices.find(x => base(x.lang) === 'en') || voices.find(x => x.isDefault) || voices.find(x => !x.lang);
    if (any) return { kind: 'native', voice: any, text: t, lang: any.lang || lang || 'en-GB' };
  }
  return { kind: 'skip', reason: `No ${lang} voice is installed in Windows.` };
}

export interface SpeakResult {
  spoken: number;
  skipped: string[];
  /** One line per announcement line, for the settings screen. */
  notes: string[];
}

let queue: Promise<unknown> = Promise.resolve();
let generation = 0;

/**
 * Speak lines in order, `repeat` times. Never throws; a line that cannot be
 * spoken is skipped and reported, the others still play. Calls queue behind
 * each other, so two orders announced together never talk over each other.
 */
export function speakLines(lines: { text: string; lang: string }[], repeat = 1, opts: RouteOptions & SpeakOptions = {}): Promise<SpeakResult> {
  const gen = generation;
  const run = async (): Promise<SpeakResult> => {
    const out: SpeakResult = { spoken: 0, skipped: [], notes: [] };
    try {
      if (!anySupported()) { out.skipped.push('This device has no speech support.'); return out; }
      const voices = await listAllVoices();
      const routes = lines.map(l => planSpeech(l.text, l.lang, voices, opts));
      for (const r of routes) {
        if (r.kind === 'skip') { out.skipped.push(r.reason); out.notes.push(r.reason); }
        else if (r.kind === 'hindi-for-urdu') out.notes.push(`Urdu line read by the Hindi voice "${r.voice.name}".`);
        else out.notes.push(`Read by "${r.voice.name}".`);
      }
      const times = Math.max(1, Math.min(5, Math.round(repeat) || 1));
      let last: SpeechProvider | undefined;
      for (let i = 0; i < times; i++) {
        for (const r of routes) {
          if (r.kind === 'skip') continue;
          if (gen !== generation) return out; // cancelled
          const p = providerFor(r.voice);
          if (!p) continue;
          // Switching engines: let the previous one finish its line first.
          if (last && last !== p) await last.idle?.();
          if (await p.speak(r.text, r.voice, r.lang, opts)) out.spoken++;
          last = p;
        }
      }
    } catch (e: any) {
      out.skipped.push(e?.message || 'Speech failed.');
    }
    return out;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export interface VoiceSupport {
  supported: boolean;
  voices: VoiceInfo[];
  english?: VoiceInfo;
  hindi?: VoiceInfo;
  urdu?: VoiceInfo;
  /** How an Urdu line will be spoken on this computer. */
  urduMode: 'urdu-voice' | 'hindi-voice' | 'unavailable';
  message: string;
}

/** What this computer can speak, in words a shop owner can act on. */
export async function voiceSupport(opts: RouteOptions & { refresh?: boolean } = {}): Promise<VoiceSupport> {
  const supported = anySupported();
  const voices = supported ? await listAllVoices(!!opts.refresh) : [];
  return describeSupport(supported, voices, opts);
}

export function describeSupport(supported: boolean, voices: VoiceInfo[], opts: RouteOptions = {}): VoiceSupport {
  const english = findVoice(voices, 'en-GB') || findVoice(voices, 'en-US');
  const hindi = findVoice(voices, 'hi-IN');
  const urdu = findVoice(voices, 'ur-PK');
  let urduMode: VoiceSupport['urduMode'] = 'unavailable';
  let message: string;
  if (!supported) message = 'This device has no speech support.';
  else if (!voices.length) message = 'Windows reports no speech voices. Install a voice in Windows Settings → Time & language → Speech.';
  else if (urdu) { urduMode = 'urdu-voice'; message = `Urdu is spoken by the Urdu voice "${urdu.name}".`; }
  else if (hindi && opts.hindiForUrdu !== false) {
    urduMode = 'hindi-voice';
    message = `No Urdu voice is installed. Urdu lines are rewritten in Hindi script and spoken by the Hindi voice "${hindi.name}" — same spoken language, Hindi pronunciation. Common announcement words are exact; other words are approximate.`;
  } else {
    message = 'No Urdu or Hindi voice is installed in Windows, so Urdu lines are skipped (English still plays). '
      + 'Add a Hindi voice in Windows Settings → Time & language → Speech → Add voices (Hindi), or install a third-party Urdu voice for Windows; DT POS will use it automatically.';
  }
  return { supported, voices, english, hindi, urdu, urduMode, message };
}

/**
 * Load the voice lists ahead of the first announcement. The Windows Settings
 * voices come from a helper process that takes a moment to start; a display
 * screen calls this when it opens so the first order number is not late.
 */
export function warmUpVoices(): void {
  void listAllVoices().catch(() => undefined);
}

/** Stop what is playing and drop anything still queued. */
export function cancelSpeech(): void {
  generation++;
  for (const p of providers) { try { p.cancel(); } catch { /* keep cancelling the rest */ } }
}
