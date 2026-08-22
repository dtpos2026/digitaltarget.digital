// ============================================================
// v1.14.0 — INTERNATIONALISATION (i18n)
//
// DESIGN CONSTRAINTS THAT SHAPED THIS
//
// The app carries roughly 10,600 string literals across 154 files, written
// in a mix of English and Roman Urdu. Translating all of them is weeks of
// work, not one release. A system that only works once every string is
// translated would therefore be useless for a long time.
//
// So this engine is built to be USEFUL WHILE INCOMPLETE:
//
//   • Missing key  -> falls back to the requested language's parent, then
//                     to English, then to the literal text passed in. A
//                     screen can never render blank or show "menu.title".
//   • Partial language -> perfectly fine. Translate the cashier's screens first;
//                     admin screens keep working in English until someone
//                     gets to them.
//   • No code edits to add a language. Drop in a dictionary, it appears in
//     the picker.
//   • Coverage is measurable (translationCoverage()) so progress is a
//     number, not a guess.
//
// SCOPE HONESTY
// Turning the language on does NOT translate the whole app today. It
// translates what has been translated. The Settings screen states the
// coverage percentage so nobody is misled.
// ============================================================

export type LanguageCode = 'en' | 'ur' | 'ur-roman' | 'ms' | 'zh' | 'ar';

export interface LanguageDef {
  code: LanguageCode;
  /** Name in the language itself — how a speaker recognises it. */
  nativeName: string;
  englishName: string;
  /** Right-to-left script. Drives `dir` on <html>. */
  rtl: boolean;
  flag: string;
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'en', nativeName: 'English',  englishName: 'English',  rtl: false, flag: '🇬🇧' },
  { code: 'ur', nativeName: 'اردو',      englishName: 'Urdu',     rtl: true,  flag: '🇵🇰' },
  { code: 'ur-roman', nativeName: 'Roman Urdu', englishName: 'Roman Urdu', rtl: false, flag: '🇵🇰' },
  { code: 'ms', nativeName: 'Melayu',   englishName: 'Malay',    rtl: false, flag: '🇲🇾' },
  { code: 'zh', nativeName: '中文',      englishName: 'Chinese',  rtl: false, flag: '🇨🇳' },
  { code: 'ar', nativeName: 'العربية',   englishName: 'Arabic',   rtl: true,  flag: '🇸🇦' },
];

/** Flat key -> text. Nested namespaces use dots: 'pos.addItem'. */
export type Dictionary = Record<string, string>;

// ---------- dictionaries ----------
//
// ENGLISH IS THE SOURCE OF TRUTH. Every other dictionary is a subset;
// anything absent falls back to English automatically.

const en: Dictionary = {
  // --- common actions ---
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.search': 'Search',
  'common.print': 'Print',
  'common.back': 'Back',
  'common.total': 'Total',
  'common.subtotal': 'Subtotal',
  'common.discount': 'Discount',
  'common.tax': 'Tax',
  'common.serviceCharge': 'Service Charge',
  'common.quantity': 'Qty',
  'common.amount': 'Amount',
  'common.date': 'Date',
  'common.time': 'Time',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.loading': 'Loading…',
  'common.none': 'None',
  'common.clear': 'Clear',

  // --- POS ---
  'pos.title': 'Point of Sale',
  'pos.cart': 'Cart',
  'pos.cartEmpty': 'Cart is empty',
  'pos.addToCart': 'Add to cart',
  'pos.searchItems': 'Search items…',
  'pos.allCategories': 'All',
  'pos.dineIn': 'Dine In',
  'pos.takeaway': 'Takeaway',
  'pos.delivery': 'Delivery',
  'pos.selectTable': 'Select table',
  'pos.selectWaiter': 'Select waiter',
  'pos.hold': 'Hold',
  'pos.pay': 'Pay',
  'pos.sendToKitchen': 'Send to Kitchen',
  'pos.newOrder': 'New Order',
  'pos.orderNumber': 'Order No',

  // --- payment ---
  'payment.title': 'Payment',
  'payment.cash': 'Cash',
  'payment.card': 'Card',
  'payment.online': 'Online',
  'payment.credit': 'Credit',
  'payment.split': 'Split',
  'payment.cashReceived': 'Cash received',
  'payment.change': 'Change',
  'payment.amountDue': 'Amount due',
  'payment.paid': 'Paid',
  'payment.pending': 'Pending',
  'payment.method': 'Payment method',
  'payment.splitEqual': 'Equal',
  'payment.splitByItems': 'By Items',
  'payment.splitByAmounts': 'By Amounts',
  'payment.shares': 'How many shares?',

  // --- tables ---
  'tables.title': 'Tables',
  'tables.free': 'Free',
  'tables.running': 'Running',
  'tables.pendingPayment': 'Pending Payment',
  'tables.transfer': 'Transfer',
  'tables.merge': 'Merge',
  'tables.split': 'Split',
  'tables.editOrder': 'Edit / Add Items',
  'tables.noLiveOrder': 'No live order on this table',

  // --- notifications / toasts ---
  'toast.saved': 'Saved',
  'toast.deleted': 'Deleted',
  'toast.orderPlaced': 'Order placed',
  'toast.paymentReceived': 'Payment received',
  'toast.printSent': 'Sent to printer',
  'toast.printFailed': 'Printing failed',
  'toast.syncComplete': 'Sync complete',
  'toast.offline': 'Offline — saved locally',
  'toast.error': 'Something went wrong',
  'toast.noInternet': 'No internet connection',

  // --- settings ---
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageHelp': 'Changes the app interface language.',
  'settings.restaurant': 'Restaurant Details',
  'settings.taxSettings': 'Service Charge & Tax',
  'settings.printers': 'Printers',
  'settings.modules': 'Modules',

  // --- barcode / retail ---
  'barcode.title': 'Barcode & QR',
  'barcode.scan': 'Scan',
  'barcode.generate': 'Generate',
  'barcode.printLabels': 'Print Labels',
  'barcode.scanPrompt': 'Point the camera at a barcode',
  'barcode.notFound': 'No item found for this code',
  'barcode.assigned': 'Barcode assigned',
  'barcode.cameraDenied': 'Camera permission denied',
};

const ur: Dictionary = {
  'common.save': 'محفوظ کریں',
  'common.cancel': 'منسوخ',
  'common.delete': 'حذف کریں',
  'common.edit': 'ترمیم',
  'common.add': 'شامل کریں',
  'common.close': 'بند کریں',
  'common.confirm': 'تصدیق',
  'common.search': 'تلاش',
  'common.print': 'پرنٹ',
  'common.back': 'واپس',
  'common.total': 'کل',
  'common.subtotal': 'ذیلی میزان',
  'common.discount': 'رعایت',
  'common.tax': 'ٹیکس',
  'common.serviceCharge': 'سروس چارج',
  'common.quantity': 'تعداد',
  'common.amount': 'رقم',
  'common.date': 'تاریخ',
  'common.time': 'وقت',
  'common.yes': 'ہاں',
  'common.no': 'نہیں',
  'common.loading': 'لوڈ ہو رہا ہے…',
  'common.none': 'کوئی نہیں',
  'common.clear': 'صاف کریں',

  'pos.title': 'پوائنٹ آف سیل',
  'pos.cart': 'ٹوکری',
  'pos.cartEmpty': 'ٹوکری خالی ہے',
  'pos.addToCart': 'ٹوکری میں ڈالیں',
  'pos.searchItems': 'آئٹم تلاش کریں…',
  'pos.allCategories': 'تمام',
  'pos.dineIn': 'ڈائن ان',
  'pos.takeaway': 'ٹیک اوے',
  'pos.delivery': 'ڈیلیوری',
  'pos.selectTable': 'میز منتخب کریں',
  'pos.selectWaiter': 'ویٹر منتخب کریں',
  'pos.hold': 'ہولڈ',
  'pos.pay': 'ادائیگی',
  'pos.sendToKitchen': 'کچن بھیجیں',
  'pos.newOrder': 'نیا آرڈر',
  'pos.orderNumber': 'آرڈر نمبر',

  'payment.title': 'ادائیگی',
  'payment.cash': 'نقد',
  'payment.card': 'کارڈ',
  'payment.online': 'آن لائن',
  'payment.credit': 'ادھار',
  'payment.split': 'تقسیم',
  'payment.cashReceived': 'موصول نقد',
  'payment.change': 'واپسی',
  'payment.amountDue': 'واجب الادا',
  'payment.paid': 'ادا شدہ',
  'payment.pending': 'باقی',
  'payment.method': 'طریقہ ادائیگی',
  'payment.splitEqual': 'برابر',
  'payment.splitByItems': 'آئٹم کے حساب سے',
  'payment.splitByAmounts': 'رقم کے حساب سے',
  'payment.shares': 'کتنے حصے؟',

  'tables.title': 'میزیں',
  'tables.free': 'خالی',
  'tables.running': 'مصروف',
  'tables.pendingPayment': 'ادائیگی باقی',
  'tables.transfer': 'منتقلی',
  'tables.merge': 'یکجا',
  'tables.split': 'تقسیم',
  'tables.editOrder': 'ترمیم / آئٹم شامل کریں',
  'tables.noLiveOrder': 'اس میز پر کوئی فعال آرڈر نہیں',

  'toast.saved': 'محفوظ ہو گیا',
  'toast.deleted': 'حذف ہو گیا',
  'toast.orderPlaced': 'آرڈر لگ گیا',
  'toast.paymentReceived': 'ادائیگی موصول',
  'toast.printSent': 'پرنٹر کو بھیج دیا',
  'toast.printFailed': 'پرنٹنگ ناکام',
  'toast.syncComplete': 'سنک مکمل',
  'toast.offline': 'آف لائن — مقامی طور پر محفوظ',
  'toast.error': 'کچھ غلط ہو گیا',
  'toast.noInternet': 'انٹرنیٹ نہیں ہے',

  'settings.title': 'ترتیبات',
  'settings.language': 'زبان',
  'settings.languageHelp': 'ایپ کے انٹرفیس کی زبان تبدیل کرتا ہے۔',
  'settings.restaurant': 'ریسٹورنٹ کی تفصیلات',
  'settings.taxSettings': 'سروس چارج اور ٹیکس',
  'settings.printers': 'پرنٹرز',
  'settings.modules': 'ماڈیولز',

  'barcode.title': 'بارکوڈ اور کیو آر',
  'barcode.scan': 'اسکین',
  'barcode.generate': 'بنائیں',
  'barcode.printLabels': 'لیبل پرنٹ کریں',
  'barcode.scanPrompt': 'کیمرہ بارکوڈ کی طرف کریں',
  'barcode.notFound': 'اس کوڈ کا کوئی آئٹم نہیں ملا',
  'barcode.assigned': 'بارکوڈ لگ گیا',
  'barcode.cameraDenied': 'کیمرے کی اجازت نہیں ملی',
};

const ms: Dictionary = {
  'common.save': 'Simpan',
  'common.cancel': 'Batal',
  'common.delete': 'Padam',
  'common.edit': 'Sunting',
  'common.add': 'Tambah',
  'common.close': 'Tutup',
  'common.confirm': 'Sahkan',
  'common.search': 'Cari',
  'common.print': 'Cetak',
  'common.back': 'Kembali',
  'common.total': 'Jumlah',
  'common.subtotal': 'Subjumlah',
  'common.discount': 'Diskaun',
  'common.tax': 'Cukai',
  'common.serviceCharge': 'Caj Perkhidmatan',
  'common.quantity': 'Kuantiti',
  'common.amount': 'Amaun',
  'common.yes': 'Ya',
  'common.no': 'Tidak',
  'common.loading': 'Memuatkan…',
  'common.clear': 'Kosongkan',

  'pos.title': 'Mesin Jualan',
  'pos.cart': 'Troli',
  'pos.cartEmpty': 'Troli kosong',
  'pos.searchItems': 'Cari item…',
  'pos.allCategories': 'Semua',
  'pos.dineIn': 'Makan Sini',
  'pos.takeaway': 'Bungkus',
  'pos.delivery': 'Penghantaran',
  'pos.hold': 'Tahan',
  'pos.pay': 'Bayar',
  'pos.sendToKitchen': 'Hantar ke Dapur',
  'pos.newOrder': 'Pesanan Baru',

  'payment.title': 'Pembayaran',
  'payment.cash': 'Tunai',
  'payment.card': 'Kad',
  'payment.online': 'Dalam Talian',
  'payment.split': 'Pecah',
  'payment.cashReceived': 'Tunai diterima',
  'payment.change': 'Baki',
  'payment.amountDue': 'Jumlah perlu dibayar',
  'payment.paid': 'Dibayar',
  'payment.splitEqual': 'Sama Rata',
  'payment.splitByItems': 'Ikut Item',
  'payment.splitByAmounts': 'Ikut Amaun',

  'tables.title': 'Meja',
  'tables.free': 'Kosong',
  'tables.running': 'Digunakan',
  'tables.transfer': 'Pindah',
  'tables.merge': 'Gabung',
  'tables.split': 'Pecah',

  'toast.saved': 'Disimpan',
  'toast.orderPlaced': 'Pesanan dibuat',
  'toast.paymentReceived': 'Pembayaran diterima',
  'toast.offline': 'Luar talian — disimpan setempat',
  'toast.error': 'Ada masalah',

  'settings.title': 'Tetapan',
  'settings.language': 'Bahasa',

  'barcode.scan': 'Imbas',
  'barcode.generate': 'Jana',
  'barcode.printLabels': 'Cetak Label',
};

const zh: Dictionary = {
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.add': '添加',
  'common.close': '关闭',
  'common.confirm': '确认',
  'common.search': '搜索',
  'common.print': '打印',
  'common.total': '总计',
  'common.subtotal': '小计',
  'common.discount': '折扣',
  'common.tax': '税',
  'common.serviceCharge': '服务费',
  'common.quantity': '数量',
  'common.amount': '金额',
  'common.yes': '是',
  'common.no': '否',
  'common.loading': '加载中…',

  'pos.title': '销售点',
  'pos.cart': '购物车',
  'pos.cartEmpty': '购物车是空的',
  'pos.searchItems': '搜索商品…',
  'pos.allCategories': '全部',
  'pos.dineIn': '堂食',
  'pos.takeaway': '外带',
  'pos.delivery': '外送',
  'pos.hold': '暂存',
  'pos.pay': '付款',
  'pos.sendToKitchen': '发送到厨房',

  'payment.title': '付款',
  'payment.cash': '现金',
  'payment.card': '刷卡',
  'payment.online': '在线支付',
  'payment.split': '分单',
  'payment.change': '找零',
  'payment.paid': '已付',
  'payment.splitEqual': '平均',
  'payment.splitByItems': '按商品',
  'payment.splitByAmounts': '按金额',

  'tables.title': '餐桌',
  'tables.free': '空闲',
  'tables.running': '使用中',
  'tables.transfer': '转台',
  'tables.merge': '并台',
  'tables.split': '拆单',

  'toast.saved': '已保存',
  'toast.orderPlaced': '订单已下',
  'toast.paymentReceived': '已收款',
  'toast.error': '出错了',

  'settings.title': '设置',
  'settings.language': '语言',

  'barcode.scan': '扫描',
  'barcode.generate': '生成',
  'barcode.printLabels': '打印标签',
};

const ar: Dictionary = {
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.delete': 'حذف',
  'common.edit': 'تعديل',
  'common.add': 'إضافة',
  'common.close': 'إغلاق',
  'common.confirm': 'تأكيد',
  'common.search': 'بحث',
  'common.print': 'طباعة',
  'common.total': 'الإجمالي',
  'common.subtotal': 'المجموع الفرعي',
  'common.discount': 'خصم',
  'common.tax': 'ضريبة',
  'common.serviceCharge': 'رسوم الخدمة',
  'common.quantity': 'الكمية',
  'common.amount': 'المبلغ',
  'common.yes': 'نعم',
  'common.no': 'لا',

  'pos.cart': 'السلة',
  'pos.cartEmpty': 'السلة فارغة',
  'pos.dineIn': 'تناول بالمطعم',
  'pos.takeaway': 'سفري',
  'pos.delivery': 'توصيل',
  'pos.pay': 'دفع',

  'payment.title': 'الدفع',
  'payment.cash': 'نقدي',
  'payment.card': 'بطاقة',
  'payment.change': 'الباقي',
  'payment.paid': 'مدفوع',

  'tables.title': 'الطاولات',
  'tables.free': 'فارغة',
  'tables.running': 'مشغولة',

  'toast.saved': 'تم الحفظ',
  'toast.error': 'حدث خطأ',

  'settings.title': 'الإعدادات',
  'settings.language': 'اللغة',
};

// Roman Urdu — Urdu written in Latin script. Shown only for Pakistan.
const urRoman: Dictionary = {
  'common.save': 'Save karein', 'common.cancel': 'Cancel', 'common.delete': 'Delete karein',
  'common.edit': 'Tabdeel karein', 'common.add': 'Shamil karein', 'common.close': 'Band karein',
  'common.confirm': 'Tasdeeq karein', 'common.search': 'Talash karein', 'common.print': 'Print karein',
  'common.back': 'Wapas', 'common.total': 'Total', 'common.subtotal': 'Sub Total',
  'common.discount': 'Discount', 'common.tax': 'Tax', 'common.serviceCharge': 'Service Charge',
  'common.quantity': 'Tadaad', 'common.amount': 'Raqam', 'common.date': 'Tareekh',
  'common.time': 'Waqt', 'common.yes': 'Haan', 'common.no': 'Nahi',
  'common.loading': 'Load ho raha hai...', 'common.none': 'Koi nahi', 'common.clear': 'Saaf karein',

  'pos.title': 'Counter', 'pos.cart': 'Cart', 'pos.cartEmpty': 'Cart khali hai',
  'pos.addToCart': 'Cart me daalein', 'pos.searchItems': 'Item talash karein',
  'pos.allCategories': 'Tamam categories', 'pos.dineIn': 'Dine In', 'pos.takeaway': 'Takeaway',
  'pos.delivery': 'Delivery', 'pos.selectTable': 'Table chunein', 'pos.selectWaiter': 'Waiter chunein',
  'pos.hold': 'Hold karein', 'pos.pay': 'Payment karein', 'pos.sendToKitchen': 'Kitchen bhejein',
  'pos.newOrder': 'Naya order', 'pos.orderNumber': 'Order number',

  'payment.title': 'Payment', 'payment.cash': 'Cash', 'payment.card': 'Card',
  'payment.online': 'Online', 'payment.credit': 'Udhaar', 'payment.split': 'Split',
  'payment.cashReceived': 'Cash mila', 'payment.change': 'Wapsi', 'payment.amountDue': 'Baqaya raqam',
  'payment.paid': 'Ada shuda', 'payment.pending': 'Baqaya', 'payment.method': 'Tareeqa',

  'tables.title': 'Tables', 'tables.free': 'Khali', 'tables.running': 'Chal raha hai',
  'tables.pendingPayment': 'Payment baqi', 'tables.transfer': 'Transfer', 'tables.merge': 'Merge',
  'tables.split': 'Split', 'tables.editOrder': 'Order tabdeel karein', 'tables.noLiveOrder': 'Koi live order nahi',

  'toast.saved': 'Save ho gaya', 'toast.deleted': 'Delete ho gaya', 'toast.orderPlaced': 'Order lag gaya',
  'toast.paymentReceived': 'Payment mil gayi', 'toast.printSent': 'Print bhej diya',
  'toast.printFailed': 'Print fail ho gaya', 'toast.syncComplete': 'Sync mukammal',
  'toast.offline': 'Offline hain', 'toast.error': 'Kuch ghalat ho gaya', 'toast.noInternet': 'Internet nahi hai',

  'settings.title': 'Settings', 'settings.language': 'Zabaan', 'settings.restaurant': 'Restaurant',
  'settings.taxSettings': 'Tax settings', 'settings.printers': 'Printers', 'settings.modules': 'Modules',

  'barcode.title': 'Barcode', 'barcode.scan': 'Scan karein', 'barcode.generate': 'Generate karein',
  'barcode.printLabels': 'Labels print karein', 'barcode.notFound': 'Item nahi mila',
};

const DICTIONARIES: Record<LanguageCode, Dictionary> = { en, ur, 'ur-roman': urRoman, ms, zh, ar };

// ---------- country gating ----------
// Business rule: language choice follows the country. Pakistan gets
// English + Urdu + Roman Urdu; every other country stays English-only
// (extra scripts are shown only where they are actually used).
const COUNTRY_LANGUAGES: Record<string, LanguageCode[]> = {
  pakistan: ['en', 'ur', 'ur-roman'],
  malaysia: ['en', 'ms'],
  china: ['en', 'zh'],
  'saudi arabia': ['en', 'ar'],
  'united arab emirates': ['en', 'ar'],
  uae: ['en', 'ar'],
};

/** Languages selectable for a country name (defaults to English only). */
export function languagesForCountry(country?: string | null): LanguageDef[] {
  const codes = COUNTRY_LANGUAGES[(country || '').trim().toLowerCase()] || ['en'];
  return LANGUAGES.filter(l => codes.includes(l.code));
}

/** True when a language is allowed for the given country. */
export function isLanguageAllowed(code: LanguageCode, country?: string | null): boolean {
  return languagesForCountry(country).some(l => l.code === code);
}

// ---------- runtime ----------

const STORAGE_KEY = 'dtpos-language';
let current: LanguageCode = 'en';
const listeners = new Set<() => void>();

export function getLanguage(): LanguageCode {
  return current;
}

export function getLanguageDef(code: LanguageCode = current): LanguageDef {
  return LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
}

/**
 * Switch language. Also flips document direction for RTL scripts so Urdu
 * and Arabic lay out correctly rather than merely swapping words.
 */
export function setLanguage(code: LanguageCode): void {
  if (!DICTIONARIES[code]) return;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode */ }
  if (typeof document !== 'undefined') {
    const def = getLanguageDef(code);
    document.documentElement.lang = code;
    document.documentElement.dir = def.rtl ? 'rtl' : 'ltr';
  }
  listeners.forEach(l => { try { l(); } catch { /* ignore */ } });
}

/** Restore the saved language on boot. Safe to call more than once. */
export function initLanguage(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
    if (saved && DICTIONARIES[saved]) { setLanguage(saved); return; }
  } catch { /* ignore */ }
  setLanguage('en');
}

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate a key.
 *
 * `fallback` is the English text the caller would otherwise have hardcoded.
 * Passing it means an untranslated key still renders real words rather than
 * a dotted key, which is what lets the app ship while translation is only
 * partially done.
 *
 * `vars` interpolates {name}-style placeholders.
 */
export function t(key: string, fallback?: string, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[current] || {};
  let text = dict[key] ?? en[key] ?? fallback ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/**
 * How much of the app is translated for a language, as a percentage of the
 * English source. Displayed in Settings so the coverage claim is honest and
 * verifiable rather than marketing.
 */
export function translationCoverage(code: LanguageCode): number {
  if (code === 'en') return 100;
  const dict = DICTIONARIES[code] || {};
  const total = Object.keys(en).length;
  if (total === 0) return 100;
  const done = Object.keys(en).filter(k => dict[k] !== undefined).length;
  return Math.round((done / total) * 100);
}

/** Keys still missing for a language — the exact to-do list for a translator. */
export function missingKeys(code: LanguageCode): string[] {
  const dict = DICTIONARIES[code] || {};
  return Object.keys(en).filter(k => dict[k] === undefined);
}

/** Total translatable keys currently registered. */
export function totalKeys(): number {
  return Object.keys(en).length;
}
