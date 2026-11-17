// Roman Urdu for the three phone apps (v1.115.0) — Urdu written in English letters, the way people text it (“order mein”, “abhi nahi”).
//
// It is made FROM the proofread Urdu dictionary, word by word, instead of being a second 550-line dictionary to keep in step:
// every Urdu phrase the apps know is turned into Roman by this word list, so a change to a phrase in phrasesUr.ts reaches Roman
// Urdu by itself, and the test fails when a new Urdu word has no Roman spelling yet (so nothing is ever half Urdu script).
// Words the apps print in English (Order, Delivery, Rider …) are written the same in both.
import { PHRASES_UR } from '@/lib/phrasesUr';
import type { PhraseDictionary } from '@/lib/phraseTranslate';

export const ROMAN_WORDS: Record<string, string> = {
  'نہیں': 'nahi', 'کریں': 'karein', 'ہے': 'hai', 'کے': 'ke', 'آرڈر': 'order', 'میں': 'mein', 'سے': 'se', 'ہو': 'ho', 'پر': 'par', 'اور': 'aur',
  'کا': 'ka', 'اس': 'is', 'کوئی': 'koi', 'آپ': 'aap', 'لیے': 'liye', 'ابھی': 'abhi', 'فون': 'phone', 'ریسٹورنٹ': 'restaurant', 'یا': 'ya', 'کو': 'ko',
  'کی': 'ki', 'ہیں': 'hain', 'گاہک': 'customer', 'اِن': 'in', 'محفوظ': 'mehfooz', 'شامل': 'shamil', 'اکاؤنٹ': 'account', 'لائن': 'line', 'رہا': 'raha', 'شدہ': 'shuda',
  'گیا': 'gaya', 'سائن': 'sign', 'بل': 'bill', 'آن': 'on', 'ڈیلیوری': 'delivery', 'آرڈرز': 'orders', 'کرنے': 'karne', 'انتظار': 'intezar', 'کر': 'kar', 'رائیڈر': 'rider',
  'آئٹم': 'item', 'بند': 'band', 'آئٹمز': 'items', 'یہ': 'yeh', 'ڈیوائس': 'device', 'کچن': 'kitchen', 'ٹیبل': 'table', 'لیں': 'lein', 'وصول': 'wasool', 'نمبر': 'number',
  'ہوئے': 'hue', 'تلاش': 'talash', 'اسٹاک': 'stock', 'کم': 'kam', 'لوکیشن': 'location', 'پاس': 'pass', 'برانچ': 'branch', 'مکمل': 'mukammal', 'ڈیلیور': 'deliver', 'نام': 'naam',
  'دوبارہ': 'dobara', 'آج': 'aaj', 'سب': 'sab', 'کچھ': 'kuch', 'لائیو': 'live', 'ایپ': 'app', 'ورڈ': 'word', 'کسی': 'kisi', 'جا': 'ja', 'منظوری': 'manzoori',
  'گئی': 'gayi', 'پتہ': 'pata', 'کال': 'call', 'سکا': 'saka', 'نے': 'ne', 'بلاک': 'block', 'مدت': 'muddat', 'چنیں': 'chunein', 'ادھار': 'udhaar', 'پروفائل': 'profile',
  'فعال': 'faal', 'رقم': 'raqam', 'یہاں': 'yahan', 'ایڈمن': 'admin', 'ملا': 'mila', 'یوزر': 'user', 'نیم': 'name', 'آف': 'off', 'پہلے': 'pehle', 'کیشیئر': 'cashier',
  'ادائیگی': 'adaigi', 'دبائیں': 'dabayein', 'درج': 'darj', 'زیادہ': 'zyada', 'اسٹاف': 'staff', 'اونر': 'owner', 'منسوخ': 'mansookh', 'لوڈ': 'load', 'لاگ': 'log', 'ورک': 'work',
  'اسپیس': 'space', 'نظر': 'nazar', 'ہوتا': 'hota', 'دستیاب': 'dastiyab', 'تیار': 'tayyar', 'مزید': 'mazeed', 'وہ': 'woh', 'دے': 'de', 'ہٹائیں': 'hatayein', 'جو': 'jo',
  'رہے': 'rahe', 'انٹرنیٹ': 'internet', 'باقی': 'baqi', 'ہوا': 'hua', 'مینیو': 'menu', 'مینیجر': 'manager', 'برانچز': 'branches', 'منافع': 'munafa', 'خریداری': 'kharidari', 'لکھیں': 'likhein',
  'اختیاری': 'ikhtiyari', 'واپس': 'wapas', 'اپڈیٹ': 'update', 'بدلیں': 'badlein', 'اسکرین': 'screen', 'تفویض': 'tafweez', 'اسٹیٹس': 'status', 'لے': 'le', 'ایک': 'ek', 'ریکارڈ': 'record',
  'حوالے': 'hawale', 'سکتا': 'sakta', 'تک': 'tak', 'نئے': 'naye', 'آ': 'aa', 'گے': 'ge', 'سیٹنگز': 'settings', 'کہیں': 'kahein', 'اپنا': 'apna', 'نہ': 'na',
  'دیکھنے': 'dekhne', 'لیا': 'liya', 'شروع': 'shuru', 'کرنا': 'karna', 'نوٹ': 'note', 'مثلاً': 'masalan', 'کارٹ': 'cart', 'سائز': 'size', 'اخراجات': 'akhrajaat', 'خرچ': 'kharch',
  'لاگت': 'laagat', 'ری': 're', 'لیول': 'level', 'کیٹیگری': 'category', 'منظور': 'manzoor', 'ای': 'e', 'میل': 'mail', 'قیمت': 'qeemat', 'ضروری': 'zaroori', 'مدد': 'madad',
  'آؤٹ': 'out', 'تصویر': 'tasveer', 'کوشش': 'koshish', 'کوڈ': 'code', 'براہ': 'barah', 'کرم': 'karam', 'میری': 'meri', 'بلوں': 'bilon', 'سرور': 'server', 'خود': 'khud',
  'بخود': 'ba-khud', 'ہوتی': 'hoti', 'سیل': 'seal', 'ڈیوٹی': 'duty', 'ٹریکنگ': 'tracking', 'چالو': 'chalu', 'راستہ': 'rasta', 'طے': 'tay', 'پن': 'PIN', 'ریفریش': 'refresh',
  'اپنی': 'apni', 'مالیت': 'maliyat', 'ساتھ': 'saath', 'آخری': 'aakhri', 'بار': 'baar', 'چاہیے': 'chahiye', 'اپنے': 'apne', 'اٹھا': 'utha', 'پہنچ': 'pahunch', 'خوش': 'khush',
  'آمدید': 'aamdeed', 'کیا': 'kya', 'نقد': 'naqd', 'دیں': 'dein', 'موجود': 'mojood', 'دکھائے': 'dikhaye', 'بھیجا': 'bheja', 'بھیج': 'bhej', 'کینسل': 'cancel', 'رہتے': 'rehte',
  'اسے': 'isay', 'آتے': 'aate', 'تمام': 'tamam', 'ویٹر': 'waiter', 'موازنہ': 'muwazna', 'نئی': 'nayi', 'سپلائر': 'supplier', 'مسترد': 'mustarad', 'چیک': 'check', 'لیٹ': 'late',
  'کھلے': 'khule', 'حساب': 'hisaab', 'کردار': 'kirdar', 'وقت': 'waqt', 'ایڈمنسٹریٹر': 'administrator', 'صرف': 'sirf', 'اکاؤنٹس': 'accounts', 'ٹل': 'till', 'رابطہ': 'rabta', 'کھلا': 'khula',
  'درخواست': 'darkhwast', 'ڈارک': 'dark', 'تھیم': 'theme', 'ڈائن': 'dine', 'ترمیم': 'tarmeem', 'بعد': 'baad', 'کھولیں': 'kholein', 'سکی': 'saki', 'تاکہ': 'taake', 'کون': 'kaun',
  'گنا': 'gina', 'ختم': 'khatam', 'دیکھ': 'dekh', 'کہ': 'ke', 'تھیلا': 'bag', 'رسید': 'raseed', 'لگی': 'lagi', 'ہوئی': 'hui', 'پک': 'pick', 'اپ': 'up',
  'تصدیق': 'tasdeeq', 'پوری': 'poori', 'لی': 'li', 'میرے': 'mere', 'میرا': 'mera', 'جائیں': 'jayein', 'ہر': 'har', 'کرتا': 'karta', 'واٹس': 'whats', 'لنک': 'link',
  'بھیجیں': 'bhejein', 'بنائے': 'banaye', 'سکے': 'sakay', 'دیا': 'diya', 'کیے': 'kiye', 'لسٹ': 'list', 'اب': 'ab', 'نشان': 'nishan', 'پھر': 'phir', 'بھی': 'bhi',
  'بدلنے': 'badalne', 'راستے': 'raste', 'ہی': 'hi', 'قبول': 'qubool', 'غیر': 'ghair', 'خراب': 'kharab', 'کیش': 'cash', 'کارڈ': 'card', 'کل': 'kal', 'منٹ': 'minute',
  'والی': 'wali', 'بھیجے': 'bheje', 'سافٹ': 'soft', 'ویئر': 'ware', 'مہمان': 'mehmaan', 'شیئر': 'share', 'خالی': 'khali', 'جاتے': 'jaate', 'فلیورز': 'flavours', 'ٹرانسفرز': 'transfers',
  'آمدنی': 'aamdani', 'انوینٹری': 'inventory', 'ماہ': 'maah', 'خریدا': 'khareeda', 'ریٹ': 'rate', 'رائیڈرز': 'riders', 'اَن': 'un', 'رکھیں': 'rakhein', 'نیا': 'naya', 'فلٹر': 'filter',
  'ڈیٹا': 'data', 'فروخت': 'farokht', 'کاپی': 'copy', 'لوگ': 'log', 'ویب': 'web', 'سائٹ': 'site', 'دکھایا': 'dikhaya', 'رہتی': 'rehti', 'جاتی': 'jaati', 'فوراً': 'foran',
  'ریسیپیز': 'recipes', 'طور': 'taur', 'فی': 'per', 'رہتا': 'rehta', 'تو': 'to', 'سنک': 'sync', 'سکتی': 'sakti', 'حاضری': 'haazri', 'آرڈرنگ': 'ordering', 'ٹکٹ': 'ticket',
  'جائے': 'jaye', 'حصہ': 'hissa', 'استعمال': 'istemaal', 'چھپائیں': 'chupayein', 'زیر': 'zer', 'التوا': 'iltiwa', 'ٹیک': 'take', 'اوے': 'way', 'بطور': 'batour', 'آتی': 'aati',
  'معلوم': 'maloom', 'کارکردگی': 'karkardagi', 'اصل': 'asal', 'انسٹال': 'install', 'سیلز': 'sales', 'زبان': 'zubaan', 'رات': 'raat', 'شفٹ': 'shift', 'مراحل': 'marahil', 'فاصلہ': 'faasla',
  'تھیلے': 'bags', 'ہوں': 'hon', 'بلند': 'buland', 'آواز': 'awaaz', 'بتائیں': 'batayein', 'سپورٹ': 'support', 'کیسے': 'kaise', 'شاباش': 'shabash', 'دوران': 'dauran', 'اختیارات': 'ikhtiyaraat',
  'بنایا': 'banaya', 'سا': 'sa', 'آئے': 'aaye', 'پہنچیں': 'pahunchein', 'دیکھیں': 'dekhein', 'فالو': 'follow', 'تنخواہ': 'tankhwah', 'لگائیں': 'lagayein', 'بٹن': 'button', 'کام': 'kaam',
  'کرتے': 'karte', 'تھے': 'thay', 'نیچے': 'neeche', 'تفصیل': 'tafseel', 'تھی': 'thi', 'جڑا': 'jura', 'ایڈوانس': 'advance', 'مفت': 'muft', 'کھانا': 'khana', 'ہسٹری': 'history',
  'ہوم': 'home', 'ادا': 'ada', 'سفر': 'safar', 'مہینے': 'mahine', 'ہفتے': 'hafte', 'جواب': 'jawab', 'غلط': 'ghalat', 'واضح': 'wazeh', 'حادثہ': 'hadsa', 'گاڑی': 'gaari',
  'ٹرانسفر': 'transfer', 'مل': 'mil', 'اتنی': 'itni', 'گاہکوں': 'customers', 'پورے': 'poore', 'بات': 'baat', 'پوچھیں': 'poochein', 'تب': 'tab', 'رہیں': 'rahein', 'جب': 'jab',
  'انہیں': 'unhein', 'صاف': 'saaf', 'مکان': 'makaan', 'گلی': 'gali', 'نشانی': 'nishani', 'پیاز': 'pyaaz', 'تیز': 'tez', 'مرچ': 'mirch', 'فلورز': 'floors', 'سیٹ': 'set',
  'ٹیکر': 'taker', 'قسم': 'qism', 'ڈسکاؤنٹ': 'discount', 'چلتے': 'chalte', 'بٹھائیں': 'bithayein', 'ٹیبلز': 'tables', 'بٹھانے': 'bithane', 'مصروف': 'masroof', 'کھولنے': 'kholne', 'آزمائیں': 'azmayein',
  'دیے': 'diye', 'برائے': 'baraye', 'کیٹیگریز': 'categories', 'ڈالیں': 'daalein', 'چن': 'chun', 'جائزہ': 'jaiza', 'رپورٹس': 'reports', 'اہداف': 'ahdaaf', 'ٹلز': 'tills', 'بڑے': 'bade',
  'مال': 'maal', 'سپلائرز': 'suppliers', 'آئیں': 'aayein', 'اوپر': 'upar', 'مقدار': 'miqdaar', 'یونٹ': 'unit', 'پیمانہ': 'paimana', 'تاریخ': 'tareekh', 'وجہ': 'wajah', 'ڈیوائسز': 'devices',
  'بھول': 'bhool', 'گئے': 'gaye', 'یاد': 'yaad', 'ناکام': 'nakaam', 'ریسٹورنٹس': 'restaurants', 'توجہ': 'tawajjoh', 'درکار': 'darkaar', 'فلٹرز': 'filters', 'بکنے': 'bikne', 'والے': 'wale',
  'گھنٹوں': 'ghanton', 'بذریعہ': 'bazariya', 'ٹائم': 'time', 'ایڈجسٹ': 'adjust', 'آپریشنز': 'operations', 'پیسہ': 'paisa', 'سوئچ': 'switch', 'معمول': 'maamool', 'لگ': 'lag', 'بدلا': 'badla',
  'تبدیلیاں': 'tabdeeliyan', 'آنے': 'aane', 'دی': 'di', 'اجازت': 'ijazat', 'ریفنڈ': 'refund', 'جہاں': 'jahan', 'اجازتوں': 'ijazaton', 'جانچ': 'jaanch', 'آڈٹ': 'audit', 'تنخواہیں': 'tankhwahein',
  'پے': 'pay', 'رول': 'roll', 'سنبھالتا': 'sambhalta', 'کاروبار': 'karobar', 'کھلنے': 'khulne', 'کٹ': 'kat', 'بورڈ': 'board', 'جائزے': 'jaaize', 'پہلی': 'pehli', 'یوٹیلیٹیز': 'utilities',
  'جلد': 'jald', 'موازنے': 'muwazne', 'دو': 'do', 'چاہییں': 'chahiyen', 'نامکمل': 'namukammal', 'دبا': 'daba', 'بن': 'ban', 'سکتے': 'sakte', 'گیس': 'gas', 'سلنڈر': 'cylinder',
  'شام': 'shaam', 'آنکھوں': 'aankhon', 'آرام': 'aaram', 'دہ': 'deh', 'ایڈریس': 'address', 'اضافی': 'izaafi', 'چارج': 'charge', 'روکے': 'roke', 'جس': 'jis', 'ذریعے': 'zariye',
  'اصول': 'usool', 'اسی': 'isi', 'اگر': 'agar', 'حد': 'had', 'انوائس': 'invoice', 'کس': 'kis', 'ہونا': 'hona', 'دیتی': 'deti', 'کھول': 'khol', 'لنکس': 'links',
  'بہتر': 'behtar', 'سپر': 'super', 'بناتا': 'banata', 'کھلوانے': 'khulwane', 'بنی': 'bani', 'ریسیپی': 'recipe', 'کھانے': 'khane', 'سیشن': 'session', 'بحال': 'bahal', 'ہمیشہ': 'hamesha',
  'دکھاتا': 'dikhata', 'آگے': 'aage', 'بڑھاتا': 'barhata', 'ہونے': 'hone', 'وہیں': 'wahin', 'از': 'az', 'رپورٹ': 'report', 'دکھائیں': 'dikhayein', 'قیمتیں': 'qeematein', 'گا': 'ga',
  'بدل': 'badal', 'ایپس': 'apps', 'چھپ': 'chhup', 'جاتا': 'jata', 'ریسیپیاں': 'recipes', 'تصویریں': 'tasveerein', 'مالک': 'malik', 'مینیجرز': 'managers', 'پلان': 'plan', 'حذف': 'hazf',
  'وہی': 'wohi', 'اعداد': 'aadaad', 'مینجمنٹ': 'management', 'ڈیسک': 'desk', 'ٹاپ': 'top', 'پرفارمنس': 'performance', 'سست': 'sust', 'ٹھیک': 'theek', 'ان': 'un', 'اسٹوریج': 'storage',
  'ضائع': 'zaaya', 'لکھتا': 'likhta',
};

/** Words that Urdu writes with a space and Roman writes as one (or with the usual joining). */
const JOINS: ReadonlyArray<[RegExp, string]> = [
  [/\bpass word\b/gi, 'password'], [/\buser name\b/gi, 'username'], [/\bwork space\b/gi, 'workspace'], [/\bsoft ware\b/gi, 'software'], [/\bdesk top\b/gi, 'desktop'],
  [/\bwhats app\b/gi, 'WhatsApp'], [/\bbarah karam\b/gi, 'barah-e-karam'], [/\bzer iltiwa\b/gi, 'zer-e-iltiwa'], [/\bkhud ba-khud\b/gi, 'khud ba-khud'],
  [/\be mail\b/gi, 'email'], [/\bpick up\b/gi, 'pickup'], [/\btake way\b/gi, 'takeaway'], [/\bdine in\b/gi, 'dine-in'], [/\bre order\b/gi, 'reorder'], [/\bon line\b/gi, 'online'],
];
const URDU_PUNCT: Record<string, string> = { '،': ',', '؛': ';', '؟': '?', '۔': '.' };
const URDU_RUN = /[؀-ۿ‌‍]+/g;

/** Words in `urdu` that have no Roman spelling in the list (for the test and for maintenance). */
export function missingRomanWords(urdu: string): string[] {
  const out: string[] = [];
  const text = urdu.replace(/[،؛؟۔]/g, ' ');
  for (const w of text.match(URDU_RUN) ?? []) if (!(w in ROMAN_WORDS)) out.push(w);
  return out;
}

/** One Urdu phrase in Roman letters. Latin text, numbers and {n} / {} placeholders are left exactly as they are. */
export function romanizeUrdu(urdu: string): string {
  let t = urdu.replace(/[،؛؟۔]/g, c => URDU_PUNCT[c]);
  t = t.replace(URDU_RUN, w => ROMAN_WORDS[w] ?? w);
  for (const [re, to] of JOINS) t = t.replace(re, to);
  // the first letter of a sentence is a capital, the way it is in the English the screen came from ({n} and {} are left alone)
  return t.replace(/^[a-z]/, c => c.toUpperCase()).replace(/([.?!]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** A few screens read better in the English word every Pakistani already says than in a literal Roman spelling. */
const OVERRIDES: Record<string, string> = { 'Pending': 'Pending' };

let cached: PhraseDictionary | null = null;
/** The Roman Urdu dictionary: the same English phrases, answered in Roman Urdu. Built once from the proofread Urdu. */
export function romanUrduPhrases(): PhraseDictionary {
  if (cached) return cached;
  const d: PhraseDictionary = {};
  for (const [en, ur] of Object.entries(PHRASES_UR)) d[en] = OVERRIDES[en] ?? romanizeUrdu(ur);
  cached = d;
  return d;
}
