// ============================================================
// URDU → HINDI SCRIPT (Devanagari), for speaking Urdu with a Hindi voice.
//
// Windows ships no Urdu text-to-speech voice, but many PCs have a Hindi one
// (Microsoft Kalpana / Hemant / Swara). Spoken Urdu and spoken Hindi are the
// same everyday language; only the script differs. A Hindi voice cannot read
// Urdu (Nastaliq) letters, so the sentence is rewritten in Hindi script first.
//
// Two layers:
//   1. a word list for the words announcements actually use — exact;
//   2. a letter-by-letter fallback for anything else — approximate, because
//      Urdu writing leaves most short vowels out.
// ============================================================

const WORDS: Record<string, string> = {
  'آرڈر': 'ऑर्डर', 'نمبر': 'नंबर', 'تیار': 'तैयार', 'ہے': 'है', 'ہیں': 'हैं', 'براہِ': 'बराहे', 'براہ': 'बराहे',
  'کرم': 'करम', 'کاؤنٹر': 'काउंटर', 'کاونٹر': 'काउंटर', 'سے': 'से', 'وصول': 'वसूल', 'کریں': 'करें', 'پر': 'पर',
  'تشریف': 'तशरीफ़', 'لائیں': 'लाएं', 'لے': 'ले', 'لیں': 'लें', 'نیا': 'नया', 'نئی': 'नई', 'نئے': 'नए',
  'ٹیبل': 'टेबल', 'میز': 'मेज़', 'کچن': 'किचन', 'باورچی': 'बावर्ची', 'مہربانی': 'मेहरबानी', 'شکریہ': 'शुक्रिया',
  'آپ': 'आप', 'آپکا': 'आपका', 'کا': 'का', 'کی': 'की', 'کے': 'के', 'کو': 'को', 'میں': 'में', 'اور': 'और',
  'ہو': 'हो', 'گیا': 'गया', 'گئی': 'गई', 'چکا': 'चुका', 'چکی': 'चुकी', 'حاضر': 'हाज़िर', 'جناب': 'जनाब',
  'ڈیلیوری': 'डिलीवरी', 'ٹیک': 'टेक', 'اوے': 'अवे', 'ڈائن': 'डाइन', 'ان': 'इन', 'کھانا': 'खाना',
  'گاہک': 'गाहक', 'برائے': 'बराए', 'کرکے': 'करके', 'کر': 'कर', 'دیں': 'दें', 'فوری': 'फ़ौरी', 'جلدی': 'जल्दी',
  'ٹوکن': 'टोकन', 'بل': 'बिल', 'رقم': 'रक़म', 'روپے': 'रुपये', 'ادائیگی': 'अदायगी', 'انتظار': 'इंतज़ार',
  'آیا': 'आया', 'آئی': 'आई', 'آئے': 'आए', 'خوش': 'ख़ुश', 'آمدید': 'आमदीद', 'آئیں': 'आएं', 'آئیے': 'आइए', 'لیجیے': 'लीजिए', 'لیجئے': 'लीजिए',
};

const PUNCT: Record<string, string> = { '۔': '।', '،': ',', '؟': '?', '؛': ';', '٪': '%' };
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const CONS: Record<string, string> = {
  'ب': 'ब', 'پ': 'प', 'ت': 'त', 'ٹ': 'ट', 'ث': 'स', 'ج': 'ज', 'چ': 'च', 'ح': 'ह', 'خ': 'ख़', 'د': 'द', 'ڈ': 'ड',
  'ذ': 'ज़', 'ر': 'र', 'ڑ': 'ड़', 'ز': 'ज़', 'ژ': 'ज़', 'س': 'स', 'ش': 'श', 'ص': 'स', 'ض': 'ज़', 'ط': 'त', 'ظ': 'ज़',
  'غ': 'ग़', 'ف': 'फ़', 'ق': 'क़', 'ک': 'क', 'ك': 'क', 'گ': 'ग', 'ل': 'ल', 'م': 'म', 'ن': 'न', 'ہ': 'ह', 'ه': 'ह', 'ة': 'ह',
};
const ASPIRATED: Record<string, string> = {
  'ب': 'भ', 'پ': 'फ', 'ت': 'थ', 'ٹ': 'ठ', 'ج': 'झ', 'چ': 'छ', 'د': 'ध', 'ڈ': 'ढ', 'ک': 'ख', 'ك': 'ख', 'گ': 'घ', 'ڑ': 'ढ़',
};
const MATRA = /[ा-ौ]$/; // a vowel sign already ends the output
const INDEPENDENT = { a: 'अ', aa: 'आ', i: 'इ', ii: 'ई', u: 'उ', e: 'ए', o: 'ओ' };

/** True when the text contains Urdu/Arabic-script letters. */
export function hasUrduScript(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

/** True when the text contains Hindi (Devanagari) letters. */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

function transliterateWord(word: string): string {
  const exact = WORDS[word] || WORDS[word.replace(/[ً-ْ]/g, '')];
  if (exact) return exact;
  let out = '';
  const chars = Array.from(word);
  const afterConsonant = () => out.length > 0 && !MATRA.test(out) && !/[अआइईउएओं]$/.test(out);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    const atStart = out.length === 0;
    if (next === 'ھ' && ASPIRATED[c]) { out += ASPIRATED[c]; i++; continue; }
    if (c === 'ھ') { out += 'ह'; continue; }
    if (c === 'آ') { out += atStart ? INDEPENDENT.aa : (afterConsonant() ? 'ा' : INDEPENDENT.aa); continue; }
    if (c === 'ا' || c === 'أ' || c === 'إ') {
      if (atStart) out += INDEPENDENT.a;
      else out += afterConsonant() ? 'ा' : 'या';
      continue;
    }
    if (c === 'ع') { if (atStart) out += INDEPENDENT.a; continue; }
    if (c === 'و' || c === 'ؤ') {
      if (atStart) out += 'व';
      else if (next === 'ا' || next === 'آ') out += 'व';
      else out += afterConsonant() ? 'ो' : (out.endsWith('ा') ? 'ओ' : 'व');
      continue;
    }
    if (c === 'ی' || c === 'ي' || c === 'ى') {
      if (atStart) out += 'य';
      else if (next === 'ا' || next === 'آ' || next === 'و') out += 'य';
      else out += afterConsonant() ? 'ी' : 'ई';
      continue;
    }
    if (c === 'ے' || c === 'ۓ') { out += afterConsonant() ? 'े' : INDEPENDENT.e; continue; }
    if (c === 'ئ') { out += afterConsonant() ? 'ि' : INDEPENDENT.i; continue; }
    if (c === 'ں') { out += 'ं'; continue; }
    if (c === 'ِ') { if (afterConsonant()) out += 'ि'; continue; }
    if (c === 'ُ') { if (afterConsonant()) out += 'ु'; continue; }
    if (c === 'ّ' || c === 'َ' || c === 'ٔ' || c === 'ء' || c === 'ْ' || c === 'ٰ' || c === 'ٗ') continue;
    if (c === 'ہ' || c === 'ه' || c === 'ة') {
      // A final ہ after a consonant is the "-a" ending (شکریہ, کمرہ).
      if (i === chars.length - 1 && out.length) { out += afterConsonant() ? 'ा' : 'ह'; continue; }
      out += 'ह'; continue;
    }
    if (CONS[c]) { out += CONS[c]; continue; }
    const d = DIGITS.indexOf(c); if (d >= 0) { out += String(d); continue; }
    const a = ARABIC_DIGITS.indexOf(c); if (a >= 0) { out += String(a); continue; }
    out += PUNCT[c] ?? c;
  }
  return out;
}

/**
 * Rewrite Urdu-script text in Hindi script. Latin words (Roman Urdu, English,
 * numbers) pass through unchanged — a Hindi voice reads those too.
 */
export function urduToDevanagari(text: string): string {
  return String(text || '')
    .split(/(\s+|[،۔؟؛,.!?])/)
    .map(part => {
      if (!part) return part;
      if (PUNCT[part]) return PUNCT[part];
      return hasUrduScript(part) ? transliterateWord(part) : part;
    })
    .join('');
}

/** Words the converter spells exactly (for tests and the settings help). */
export const EXACT_WORD_COUNT = Object.keys(WORDS).length;

/** Urdu words in `text` that fall back to letter-by-letter (approximate) spelling. */
export function approximateUrduWords(text: string): string[] {
  return String(text || '')
    .split(/[\s،۔؟؛,.!?]+/)
    .filter(w => w && hasUrduScript(w) && !/^[۰-۹٠-٩]+$/.test(w))
    .filter(w => !WORDS[w] && !WORDS[w.replace(/[ً-ْ]/g, '')]);
}
