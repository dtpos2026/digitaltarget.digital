import { useState, useEffect, useRef, Fragment } from 'react';
import { useSearchParams } from '@/lib/hash-router';
import type { SystemPrinterInfo } from '@/lib/electron';
import { currencySymbol, currencyOptions, getCurrencyDef, formatMoney } from '@/lib/currency';
import { getSettings, saveSettings, saveSettingsNow, getTables, saveTable, deleteTable, getFloors, saveFloor, deleteFloor, getKitchens, saveKitchen, deleteKitchen, getWaiters, saveWaiter, deleteWaiter, getRiders, saveRider, deleteRider, genId, getCategories, getCurrentUser } from '@/lib/store';
import { RestaurantSettings, DiningTable, Floor, Kitchen, Waiter, Rider, ReceiptTextStyle } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';


import ReceiptSettingsTab from '@/components/settings/ReceiptSettingsTab';
import PrinterSettingsTab from '@/components/settings/PrinterSettingsTab';
import KotSettingsTab from '@/components/settings/KotSettingsTab';
import ReceiptStyleEditor from '@/components/ReceiptStyleEditor';
import ReceiptPreview from '@/components/ReceiptPreview';
import DataSecurityCard from '@/components/DataSecurityCard';
import KitchenReceipt from '@/components/KitchenReceipt';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Download, Printer, Palette, MapPin, Navigation, ShoppingBag, Globe2, Settings as SettingsIcon, MessageCircle, ShieldCheck, ChevronDown, Store, LayoutGrid, Armchair, UserRound, Bike, ReceiptText, Type, ChefHat, Truck, Monitor, Building2, Smartphone, Moon, Puzzle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { PAKISTAN_AREAS } from '@/lib/pakistan-areas';
import { toast } from 'sonner';
import { languagesForCountry, isLanguageAllowed, setLanguage, getLanguage, translationCoverage, totalKeys, type LanguageCode } from '@/lib/i18n';
import { MAX_TOP_MARGIN_MM, clampTopMarginMm } from '@/lib/thermal-print';
import { computeBillTotals } from '@/lib/taxEngine';
import OptionalFeaturesPanel from '@/components/OptionalFeaturesPanel';
import { isElectron, getPrinters, getAutoStart, setAutoStart } from '@/lib/electron';
import { Slider } from '@/components/ui/slider';
import { PREMIUM_THEME_IDS } from '@/lib/premiumTheme';
import InterfaceStyleCard from '@/components/settings/InterfaceStyleCard';
import ModuleManagementCard from '@/components/settings/ModuleManagementCard';
import { PageHeader } from '@/components/ui-kit';
import { useUiStyle } from '@/lib/uiStyle';
import { isPremiumPolishOn, setPremiumPolish } from '@/lib/premiumPolish';
import { REFERENCE_THEME_SPECS } from '@/lib/referenceThemes';
import { themes, getActiveTheme, setActiveTheme, ThemeId } from '@/lib/themes';
import { getWhatsAppTemplates } from '@/lib/whatsapp';
import { getTenantId, getTenantName } from '@/lib/tenant';
import { uploadTenantImage } from '@/lib/storage';

/** One icon per Settings section, for the Modern left-hand list. */
const SETTINGS_ICONS: Record<string, LucideIcon> = {
  general: Store, theme: Palette, modules: LayoutGrid, location: MapPin,
  tables: Armchair, waiters: UserRound, riders: Bike, pickup: ShoppingBag,
  printer: Printer, receipt: ReceiptText, receiptstyle: Type, kot: ChefHat,
  whatsapp: MessageCircle, online: Globe2, cities: MapPin, serviceareas: Truck, display: Monitor,
  features: Puzzle, branches: Building2, devices: Smartphone, dayclose: Moon,
};

/** The data-security panel, folded to one line in the Modern layout. */
function SecurityStrip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-5 rounded-[var(--ui-radius-card,1rem)] border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]"><ShieldCheck className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold">Data security &amp; isolation</span>
          <span className="block text-[12px] text-muted-foreground">Active — each restaurant&rsquo;s data is kept separate on the server and encrypted on this device.</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4"><DataSecurityCard /></div>}
    </div>
  );
}

export default function SettingsPage() {
  const modern = useUiStyle() === 'modern';
  // ?tab= opens a section directly (the Printing Center and other screens link here).
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(() => searchParams.get('tab') || 'general');
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) setTab(t);
  }, [searchParams]);
  const [premiumPolish, setPremiumPolishState] = useState(() => isPremiumPolishOn());
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const [newPayType, setNewPayType] = useState('');
  const [currentLang, setCurrentLang] = useState<LanguageCode>(getLanguage());
  // v1.12.3 — Quick Discount inputs keep their RAW text while typing.
  //
  // The previous version derived the input's value straight from the parsed
  // number array. Typing "10," produced ["10", ""] → the empty piece was
  // filtered out → the value re-rendered as "10" and the comma vanished the
  // instant it was typed. Multi-value entry was therefore impossible by
  // keyboard (only paste worked, because the whole string arrived at once).
  // Now the text is held locally and only PARSED into settings, never fed
  // back into the field mid-edit.
  const [pctPresetText, setPctPresetText] = useState<string>(
    () => (getSettings().discountPresets || []).join(', '),
  );
  const [amtPresetText, setAmtPresetText] = useState<string>(
    () => (getSettings().discountPresetsAmount || []).join(', '),
  );

  const parsePresets = (raw: string, max?: number): number[] => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const piece of raw.split(/[,\s]+/)) {
      const n = Number(piece.trim());
      if (!Number.isFinite(n) || n <= 0) continue;
      if (max !== undefined && n > max) continue;
      if (seen.has(n)) continue;      // duplicates would render twice on POS
      seen.add(n);
      out.push(n);
    }
    return out;
  };

  /** One-tap toggle so presets can be set without typing commas at all. */
  const togglePreset = (kind: 'pct' | 'amt', value: number) => {
    if (kind === 'pct') {
      const cur = settings.discountPresets || [];
      const next = cur.includes(value) ? cur.filter(n => n !== value) : [...cur, value].sort((a, b) => a - b);
      setSettings({ ...settings, discountPresets: next });
      setPctPresetText(next.join(', '));
    } else {
      const cur = settings.discountPresetsAmount || [];
      const next = cur.includes(value) ? cur.filter(n => n !== value) : [...cur, value].sort((a, b) => a - b);
      setSettings({ ...settings, discountPresetsAmount: next });
      setAmtPresetText(next.join(', '));
    }
  };

  const addPayType = () => {
    const name = newPayType.trim();
    if (!name) return;
    const existing = (settings.customPaymentTypes || []).map(t => t.toLowerCase());
    const builtins = ['cash', 'card', 'online', 'credit', 'split'];
    if (builtins.includes(name.toLowerCase())) { toast.error('This built-in type already exists'); return; }
    if (existing.includes(name.toLowerCase())) { toast.error('This type has already been added'); return; }
    setSettings({ ...settings, customPaymentTypes: [...(settings.customPaymentTypes || []), name] });
    setNewPayType('');
  };
  const [tables, setTables] = useState(() => getTables());
  const [floors, setFloors] = useState(() => getFloors());
  const [kitchens, setKitchens] = useState(() => getKitchens());


  const [waiters, setWaiters] = useState(() => getWaiters());
  const [riders, setRiders] = useState(() => getRiders());
  const [printers, setPrinters] = useState<SystemPrinterInfo[]>([]);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(getActiveTheme());
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsAutoSaveReady = useRef(false);
  useEffect(() => {
    if (!settingsAutoSaveReady.current) {
      settingsAutoSaveReady.current = true;
      return;
    }
    // Every profile/branding field is persisted locally immediately and then
    // debounced to the restaurant's backend row. The explicit Save button
    // remains available when the operator wants confirmation from the cloud.
    const timer = window.setTimeout(() => saveSettings(settings), 500);
    return () => window.clearTimeout(timer);
  }, [settings]);
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const [testPrintKind, setTestPrintKind] = useState<null | 'kot' | 'receipt'>(null);
  useEffect(() => {
    if (testPrintKind !== 'receipt') return;
    const t = setTimeout(() => setTestPrintKind(null), 2500);
    return () => clearTimeout(t);
  }, [testPrintKind]);

  const receiptSizePresets = [
    { key: 'compact-80', label: 'Compact', emoji: '🧾', sub: '80mm small text', paperSize: '80mm' as const, receiptScale: 88, receiptMarginTop: 0, receiptMarginBottom: 2, receiptMarginLeft: 3, receiptMarginRight: 3, receiptTrimMm: 2, receiptDesign: 'compact' as const },
    { key: 'standard-80', label: 'Standard', emoji: '📄', sub: '80mm balanced', paperSize: '80mm' as const, receiptScale: 100, receiptMarginTop: 0, receiptMarginBottom: 2, receiptMarginLeft: 3, receiptMarginRight: 3, receiptTrimMm: 3, receiptDesign: 'classic' as const },
    { key: 'bold-80', label: 'Bold', emoji: '🧷', sub: '80mm large text', paperSize: '80mm' as const, receiptScale: 114, receiptMarginTop: 0, receiptMarginBottom: 3, receiptMarginLeft: 3, receiptMarginRight: 3, receiptTrimMm: 3, receiptDesign: 'modern' as const },
  ] as const;

  // Sample order used for live Receipt / KOT design previews in Settings.
  const sampleOrder = {
    id: 'preview',
    orderNumber: 1042,
    orderType: 'dining' as const,
    status: 'paid' as const,
    tableId: 't1', tableName: '5',
    waiterId: 'w1', waiterName: 'Ali Raza',
    cashierName: 'Cashier',
    customer: { id: 'c1', name: 'Ahmed Khan', phone: '0300-1234567', address: 'Burewala' } as any,
    items: [
      { id: 'i1', menuItemId: 'm1', name: 'Chicken Biryani', pricingType: 'unit' as any, price: 450, quantity: 2, lineTotal: 900, note: 'Less spicy' },
      { id: 'i2', menuItemId: 'm2', name: 'Zinger Burger', pricingType: 'unit' as any, price: 550, quantity: 1, lineTotal: 550, note: '' },
      { id: 'i3', menuItemId: 'm3', name: 'Cold Drink 500ml', pricingType: 'unit' as any, price: 120, quantity: 2, lineTotal: 240, note: '' },
    ],
    subtotal: 1690,
    discount: 100,
    discountTitle: 'Eid Discount',
    tax: 0,
    serviceCharge: 0,
    serviceChargePercent: 0,
    grandTotal: 1590,
    paymentMethod: 'cash' as any,
    cashReceived: 2000,
    changeReturned: 410,
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
    notes: 'No onion',
  };


  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  useEffect(() => {
    if (isElectron()) {
      getPrinters().then(setPrinters);
      getAutoStart().then(setAutoStartEnabled);
    }
  }, []);

  const handleToggleAutoStart = async (next: boolean) => {
    const ok = await setAutoStart(next);
    if (ok) {
      setAutoStartEnabled(next);
      toast.success(next ? 'Auto-start enabled — Windows boot par DT POS khulega' : 'Auto-start disabled');
    } else {
      toast.error('Auto-start update failed');
    }
  };

  const handleSaveSettings = async () => {
    if (!settings.name.trim()) { toast.error('Restaurant name is required'); return; }
    setSavingSettings(true);
    try {
      await saveSettingsNow(settings);
      toast.success('Restaurant profile saved to cloud');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud save failed';
      toast.error(`Profile kept on this device, but cloud save failed: ${message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const uploadAndPersistLogo = async (
    field: 'logo' | 'appLogo' | 'webPortalLogo' | 'orderTakerLogo',
    file: File,
  ) => {
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo must be under 2MB'); return; }
    const uploadToast = toast.loading('Uploading logo securely…');
    try {
      const url = await uploadTenantImage(file, `logo-${field}`);
      const next = { ...settings, [field]: url };
      setSettings(next);
      await saveSettingsNow(next);
      toast.success('Logo uploaded and saved to cloud', { id: uploadToast });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      toast.error(`Logo was not saved: ${message}`, { id: uploadToast });
    }
  };

  const addTable = () => {
    const t: DiningTable = { id: genId(), name: `Table ${tables.length + 1}`, seats: 4, status: 'free', shape: 'square' };
    saveTable(t);
    setTables(getTables().slice());
  };

  const addFloor = () => {
    const name = window.prompt('Floor name (e.g. Ground, First Floor, Outdoor, Car Dining)');
    if (!name || !name.trim()) return;
    const f: Floor = { id: genId(), name: name.trim(), sortOrder: floors.length };
    saveFloor(f);
    setFloors(getFloors().slice());
  };
  const removeFloor = (id: string) => {
    if (!window.confirm('Delete this floor? Tables assigned to it will become Unassigned.')) return;
    // unassign tables on this floor
    getTables().filter(t => t.floorId === id).forEach(t => saveTable({ ...t, floorId: undefined }));
    deleteFloor(id);
    setFloors(getFloors().slice());
    setTables(getTables().slice());
  };

  const addKitchen = () => {
    const name = window.prompt('Kitchen name (e.g. Main, BBQ, Beverage, Basement, Outdoor)');
    if (!name || !name.trim()) return;
    const k: Kitchen = { id: genId(), name: name.trim(), sortOrder: kitchens.length };
    saveKitchen(k);
    setKitchens(getKitchens().slice());
  };
  const removeKitchen = (id: string) => {
    if (!window.confirm('Delete this kitchen? Menu items will fall back to default (no routing).')) return;
    deleteKitchen(id);
    setKitchens(getKitchens().slice());
  };



  const addWaiter = () => {
    const w: Waiter = { id: genId(), name: 'New Waiter', phone: '', isActive: true };
    saveWaiter(w);
    setWaiters(getWaiters().slice());
  };

  const addRider = () => {
    const r: Rider = { id: genId(), name: 'New Rider', phone: '', isActive: true };
    saveRider(r);
    setRiders(getRiders().slice());
  };

  return (
    <div className="p-4 lg:p-6 max-w-6xl pos-settings-pro">
      {modern ? (
        <PageHeader description="Restaurant details, look and feel, printing, and the modules you use." />
      ) : (
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md text-primary-foreground">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Settings & Masters</h2>
          <p className="text-[11px] text-muted-foreground">Restaurant configuration — each module in its own card</p>
        </div>
      </div>
      )}

      {modern ? <SecurityStrip /> : <DataSecurityCard />}



      <Tabs value={tab} onValueChange={setTab} className={modern ? 'grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start' : undefined}>
        {/* ===== FOLDER-STYLE GROUPED GRID (replaces cramped tabs row) ===== */}
        {(() => {
          const groups: { title: string; emoji: string; items: { v: string; label: string; emoji: string; desc: string }[] }[] = [
            { title: 'General', emoji: '⚙️', items: [
              { v: 'general',  label: 'General',          emoji: '🏪', desc: 'Restaurant info, currency' },
              { v: 'theme',    label: modern ? 'Appearance' : 'Theme', emoji: '🎨', desc: modern ? 'Theme manager, look, accent colour' : 'Theme manager & colour scheme' },
              // The Classic menu always lists every module; choosing what the menu shows is a Modern-menu feature.
              ...(modern ? [{ v: 'modules', label: 'Modules', emoji: '🧩', desc: 'What the menu shows, and where' }] : []),
              { v: 'location', label: 'Location & Privacy', emoji: '🔒', desc: 'GPS tracking controls' },
            ]},
            { title: 'Operations', emoji: '🛠️', items: [
              { v: 'tables',  label: 'Tables',  emoji: '🪑', desc: 'Floors & dining tables' },
              { v: 'waiters', label: 'Waiters', emoji: '👤', desc: 'Service staff list' },
              { v: 'riders',  label: 'Riders',  emoji: '🏍️', desc: 'Delivery riders' },
              { v: 'pickup',  label: 'Self-Pickup', emoji: '🏃', desc: 'Takeaway settings' },
            ]},
            { title: 'Printing', emoji: '🖨️', items: [
              { v: 'printer',      label: 'Printer',      emoji: '🖨️', desc: 'Thermal printer setup' },
              { v: 'receipt',      label: 'Receipt & QR', emoji: '🧾', desc: 'Receipt layout & QR' },
              { v: 'receiptstyle', label: 'Receipt Fonts', emoji: '📝', desc: 'Receipt typography' },
              { v: 'kot',          label: 'KOT Settings', emoji: '🍳', desc: 'Kitchen order ticket' },
            ]},
            { title: 'Integrations', emoji: '🔌', items: [
              { v: 'whatsapp',    label: 'WhatsApp',       emoji: '💬', desc: 'Customer messaging' },
              { v: 'online',      label: 'Online Order',   emoji: '🌐', desc: 'Website ordering links' },
              { v: 'cities',      label: 'Cities',         emoji: '📍', desc: 'Active service areas' },
              { v: 'serviceareas',label: 'Service Areas',  emoji: '🚚', desc: 'Manual delivery cities/areas' },
              { v: 'display',     label: 'Display',        emoji: '📺', desc: 'Customer display screen' },
            ]},
            { title: 'Advanced', emoji: '🧩', items: [
              { v: 'features', label: 'Features / Modules', emoji: '🧩', desc: 'Turn new features on/off' },
              { v: 'branches', label: 'Branches', emoji: '🏢', desc: 'Multi-branch setup' },
              { v: 'devices',  label: 'Devices',  emoji: '📱', desc: 'Approved devices' },
              { v: 'dayclose', label: 'Day Close', emoji: '🔚', desc: 'End-of-day reset' },
            ]},
          ];
          if (modern) {
            return (
              <nav aria-label="Settings sections" className="lg:sticky lg:top-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto pos-scrollbar rounded-[var(--ui-radius-card,1rem)] border bg-card p-2 shadow-sm">
                <TabsList className="!h-auto !w-full !flex-col !items-stretch !justify-start !gap-0.5 !bg-transparent !p-0 [&>*]:w-full">
                  {groups.map(g => (
                    <div key={g.title} className="mb-1 last:mb-0">
                      <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{g.title}</div>
                      {g.items.map(it => {
                        const Icon = SETTINGS_ICONS[it.v] || SettingsIcon;
                        return (
                          <TabsTrigger
                            key={it.v} value={it.v} title={it.desc}
                            className="group !h-10 !w-full !justify-start gap-3 !rounded-[10px] !px-3 text-[13.5px] font-semibold text-foreground/80 transition-colors hover:bg-accent data-[state=active]:!bg-primary/10 data-[state=active]:!text-primary data-[state=active]:!shadow-none"
                          >
                            <Icon className="h-[18px] w-[18px] shrink-0" /><span className="truncate">{it.label}</span>
                          </TabsTrigger>
                        );
                      })}
                    </div>
                  ))}
                </TabsList>
              </nav>
            );
          }
          return (
            <div className="space-y-5 mb-5">
              {groups.map(g => (
                <div key={g.title}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-base">{g.emoji}</span>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary/80">{g.title}</h3>
                    <div className="flex-1 h-px bg-gradient-to-r from-primary/30 to-transparent" />
                  </div>
                  <TabsList className="!h-auto !p-0 !bg-transparent grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full">
                    {g.items.map(it => (
                      <TabsTrigger
                        key={it.v}
                        value={it.v}
                        title={it.desc}
                        className="group !h-auto !w-full !p-3 flex flex-col items-start gap-1 rounded-2xl border-2 border-primary/25 !bg-card/70 backdrop-blur-sm text-left transition-all hover:border-primary hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.45)] data-[state=active]:!bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-accent data-[state=active]:!text-primary-foreground data-[state=active]:border-primary data-[state=active]:shadow-lg"
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="text-2xl leading-none">{it.emoji}</span>
                          <span className="text-sm font-extrabold leading-tight truncate">{it.label}</span>
                        </div>
                        <span className="text-[11px] font-medium leading-snug opacity-70 group-data-[state=active]:opacity-90 line-clamp-2">{it.desc}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ============ LOCATION & PRIVACY ============ */}
        <TabsContent value="location" className="space-y-4">
          <div className="bg-card border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">Location & Privacy</h3>
                <p className="text-[11px] text-muted-foreground">
                  System tabhi location maangega jab yeh ON ho. OFF rakhne se app bina location ke bhi chalega — Super Admin ko branch/device locations nahi dikheinge.
                </p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div>
                <div className="text-sm font-bold">📡 Master: Location Tracking</div>
                <div className="text-[11px] text-muted-foreground">Sab location features ka master switch</div>
              </div>
              <Switch
                checked={settings.locationTrackingEnabled !== false}
                onCheckedChange={v => setSettings({ ...settings, locationTrackingEnabled: v })}
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { key: 'trackRestaurantLocation', label: '🏪 Restaurant Location', desc: 'Branch ki physical location track' },
                { key: 'trackDeviceLocation',     label: '💻 Device Location',     desc: 'Where each device is running from' },
                { key: 'trackRiderLocation',      label: '🏍️ Rider Live Tracking', desc: 'Rider Go-Live pe path track ho' },
                { key: 'trackCustomerLocation',   label: '📍 Customer Location',    desc: 'Customer ka delivery location pin' },
              ].map(opt => (
                <label key={opt.key} className="flex items-center justify-between gap-2 p-3 rounded-lg border">
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{opt.label}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{opt.desc}</div>
                  </div>
                  <Switch
                    disabled={settings.locationTrackingEnabled === false}
                    checked={(settings as any)[opt.key] !== false}
                    onCheckedChange={v => setSettings({ ...settings, [opt.key]: v } as any)}
                  />
                </label>
              ))}
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 rounded-lg p-3 text-[11px] text-amber-900 dark:text-amber-200">
              <b>How it works:</b> Master ON → app start hone par browser se ek-baar location permission maangi jayegi. User Allow kare to tracking shuru. Block kare to system chalta rahega lekin location features off rahenge.
            </div>

            <Button onClick={handleSaveSettings} className="w-full">💾 Save Location Settings</Button>
          </div>
        </TabsContent>

        {/* ============ SELF-PICKUP ============ */}
        <TabsContent value="pickup" className="space-y-4">
          <div className="bg-card border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">Self-Pickup Settings</h3>
                <p className="text-[11px] text-muted-foreground">
                  Customer cart mein "Self-Pickup" option dikhe — delivery ki jagah customer khud aa kar order le jaye.
                </p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div>
                <div className="text-sm font-bold">🏃 Enable Self-Pickup</div>
                <div className="text-[11px] text-muted-foreground">Show a self-pickup option in the customer cart</div>
              </div>
              <Switch
                checked={settings.selfPickupEnabled === true}
                onCheckedChange={v => setSettings({ ...settings, selfPickupEnabled: v })}
              />
            </label>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-pink-400/40 bg-pink-50 dark:bg-pink-950/20">
              <div>
                <div className="text-sm font-bold">🛵 Enable Foodpanda Mode</div>
                <div className="text-[11px] text-muted-foreground">Adds "Foodpanda" as a 4th order type in the POS, with its own list, status pipeline and reports.</div>
              </div>
              <Switch
                checked={settings.foodpandaEnabled === true}
                onCheckedChange={v => setSettings({ ...settings, foodpandaEnabled: v })}
              />
            </label>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Pickup Time Slots (minutes)</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {[15, 30, 45, 60, 90, 120].map(min => {
                  const slots = settings.pickupTimeSlots || [15, 30, 45, 60];
                  const on = slots.includes(min);
                  return (
                    <button
                      key={min}
                      onClick={() => {
                        const next = on ? slots.filter(s => s !== min) : [...slots, min].sort((a, b) => a - b);
                        setSettings({ ...settings, pickupTimeSlots: next });
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${
                        on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:border-primary/50'
                      }`}
                    >
                      {min} min
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground">"Order Ready" WhatsApp Message</label>
              <Textarea
                value={settings.pickupReadyMessage || ''}
                onChange={e => setSettings({ ...settings, pickupReadyMessage: e.target.value })}
                placeholder="Your order #{orderNo} is ready! Please collect it from the counter. Thank you!"
                className="text-xs"
              />
            </div>

            <Button onClick={handleSaveSettings} className="w-full">💾 Save Pickup Settings</Button>
          </div>
        </TabsContent>

        {/* ============ CITIES ============ */}
        <TabsContent value="cities" className="space-y-4">
          <div className="bg-card border rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Globe2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">Cities & Areas</h3>
                <p className="text-[11px] text-muted-foreground">
                  Select only the cities where you have branches. You can also add any custom city name using the input below.
                </p>
              </div>
            </div>

            {/* Custom city adder */}
            <div className="border rounded-lg p-3 bg-primary/5 space-y-2">
              <div className="text-xs font-extrabold text-primary">➕ Add a custom city</div>
              <div className="flex gap-2">
                <input
                  list="custom-city-suggest"
                  type="text"
                  id="custom-city-input"
                  placeholder="e.g. Chiniot, Shorkot, Ahmedpur Sial, Kot Shakir..."
                  className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const input = document.getElementById('custom-city-input') as HTMLInputElement;
                      const val = input.value.trim();
                      if (!val) return;
                      const list = settings.enabledCities || [];
                      if (list.some(x => x.toLowerCase() === val.toLowerCase())) {
                        toast.error('This city already exists'); return;
                      }
                      setSettings({ ...settings, enabledCities: [...list, val] });
                      input.value = '';
                      toast.success(`${val} added`);
                    }
                  }}
                />
                <datalist id="custom-city-suggest">
                  {PAKISTAN_AREAS.flatMap(p => p.cities.map(c => c.city)).map(c => <option key={c} value={c} />)}
                </datalist>
                <Button
                  size="sm"
                  onClick={() => {
                    const input = document.getElementById('custom-city-input') as HTMLInputElement;
                    const val = input.value.trim();
                    if (!val) return;
                    const list = settings.enabledCities || [];
                    if (list.some(x => x.toLowerCase() === val.toLowerCase())) {
                      toast.error('This city already exists'); return;
                    }
                    setSettings({ ...settings, enabledCities: [...list, val] });
                    input.value = '';
                    toast.success(`${val} added`);
                  }}
                >
                  ➕ Add
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                You can type any city that is not in the list. Suggestions are only there to help.
              </p>
            </div>

            {/* Selected cities chips */}
            {(settings.enabledCities || []).length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <div className="text-xs font-extrabold text-primary">✅ Selected / Added Cities ({(settings.enabledCities || []).length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {(settings.enabledCities || []).map(city => (
                    <span
                      key={city}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-primary text-primary-foreground border border-primary"
                    >
                      {city}
                      <button
                        onClick={() => {
                          const list = (settings.enabledCities || []).filter(x => x !== city);
                          setSettings({ ...settings, enabledCities: list });
                        }}
                        className="hover:bg-white/20 rounded-full px-1 ml-0.5"
                        title="Remove"
                      >×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {PAKISTAN_AREAS.map(prov => (
                <div key={prov.province} className="border rounded-lg p-3 bg-muted/30">
                  <div className="text-xs font-extrabold text-primary mb-2">{prov.province}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {prov.cities.map(c => {
                      const enabled = (settings.enabledCities || []).includes(c.city);
                      return (
                        <button
                          key={c.city}
                          onClick={() => {
                            const list = settings.enabledCities || [];
                            const next = enabled ? list.filter(x => x !== c.city) : [...list, c.city];
                            setSettings({ ...settings, enabledCities: next });
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-bold border-2 transition-all ${
                            enabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:border-primary/50'
                          }`}
                        >
                          {enabled ? '✓ ' : '+ '}{c.city}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-muted-foreground bg-muted/40 p-2 rounded">
              Selected: <b className="text-primary">{(settings.enabledCities || []).length} cities</b> — yeh BranchesPage ke City dropdown mein dikheinge.
            </div>

            <Button onClick={handleSaveSettings} className="w-full">💾 Save Cities</Button>
          </div>
        </TabsContent>

        {/* ============ SERVICE AREAS (manual entry, with suggestions + GPS) ============ */}
        <TabsContent value="serviceareas" className="space-y-4">
          <ServiceAreasEditor settings={settings} setSettings={setSettings} onSave={handleSaveSettings} />
        </TabsContent>



        <TabsContent value="online" className="space-y-4">
          <div className="bg-card border rounded-xl p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold mb-1">Online Ordering Website</h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                Yeh links sirf <b>{getTenantName() || 'your restaurant'}</b> only. Every restaurant gets its own unique link — customers can never see another restaurant's menu.
              </p>
              {(() => {
                const tid = getTenantId() || '';
                const origin = window.location.origin;
                const links: { key: string; label: string; url: string; emoji: string }[] = [
                  { key: 'order', label: 'CUSTOMER ORDER', emoji: '🛒', url: tid ? `${origin}/#/order/${tid}` : `${origin}/#/order` },
                  { key: 'track', label: 'ORDER TRACKING', emoji: '📍', url: tid ? `${origin}/#/track/${tid}` : `${origin}/#/track` },
                  { key: 'rider', label: 'RIDER PORTAL',   emoji: '🏍️', url: tid ? `${origin}/#/rider-portal/${tid}` : `${origin}/#/rider-portal` },
                ];
                return (
                  <div className="space-y-2">
                    {links.map(l => (
                      <div key={l.key} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                        <span className="text-[11px] font-bold text-muted-foreground shrink-0 w-28">{l.emoji} {l.label}</span>
                        <code className="text-[11px] flex-1 truncate font-mono">{l.url}</code>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => { navigator.clipboard.writeText(l.url); toast.success(`${l.label} link copied!`); }}>
                          📋 Copy
                        </Button>
                        <a href={l.url.replace(origin, '')} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]">↗ Open</Button>
                        </a>
                      </div>
                    ))}
                    {!tid && <div className="text-[10px] text-destructive">⚠️ No tenant ID found — sign in as the owner so a unique link can be generated.</div>}
                  </div>
                );
              })()}
            </div>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border">
              <div>
                <div className="text-sm font-semibold">Enable Online Ordering</div>
                <div className="text-xs text-muted-foreground">Master switch — website ON/OFF</div>
              </div>
              <input type="checkbox" className="w-5 h-5" checked={settings.onlineOrderEnabled !== false}
                onChange={e => setSettings({ ...settings, onlineOrderEnabled: e.target.checked })} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-2 p-3 rounded-lg border">
                <span className="text-xs font-semibold">Delivery Orders</span>
                <input type="checkbox" className="w-5 h-5" checked={settings.onlineDeliveryEnabled !== false}
                  onChange={e => setSettings({ ...settings, onlineDeliveryEnabled: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between gap-2 p-3 rounded-lg border">
                <span className="text-xs font-semibold">Pickup Orders</span>
                <input type="checkbox" className="w-5 h-5" checked={settings.onlinePickupEnabled !== false}
                  onChange={e => setSettings({ ...settings, onlinePickupEnabled: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between gap-2 p-3 rounded-lg border col-span-2">
                <span className="text-xs font-semibold">Allow Guest Checkout (no signup)</span>
                <input type="checkbox" className="w-5 h-5" checked={settings.allowGuestCheckout !== false}
                  onChange={e => setSettings({ ...settings, allowGuestCheckout: e.target.checked })} />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Delivery Charge ({currencySymbol()})</label>
                <Input type="number" value={settings.deliveryCharge ?? 0}
                  onChange={e => setSettings({ ...settings, deliveryCharge: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Free Delivery Above ({currencySymbol()})</label>
                <Input type="number" value={settings.freeDeliveryThreshold ?? 0}
                  onChange={e => setSettings({ ...settings, freeDeliveryThreshold: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Minimum Order ({currencySymbol()})</label>
                <Input type="number" value={settings.minOnlineOrder ?? 0}
                  onChange={e => setSettings({ ...settings, minOnlineOrder: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Delivery Radius (KM)</label>
                <Input type="number" value={settings.deliveryRadiusKm ?? 0}
                  onChange={e => setSettings({ ...settings, deliveryRadiusKm: Number(e.target.value) || 0 })} />
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground bg-muted/30 p-2 rounded">
              💡 Tip: share the website link in your Facebook / Instagram / WhatsApp bio. Orders arrive automatically in your <b>Delivery Board</b> and <b>Kitchen Queue</b>.
            </div>
          </div>
        </TabsContent>

        <TabsContent value="branches" className="space-y-3">
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-bold mb-1">Branch Management</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Add or edit your restaurant branches here. Every bill is saved with the active branch, and Reports show each branch separately.
            </p>
            <a href="#/branches" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline">
              → Open Branches page
            </a>
          </div>
        </TabsContent>

        <TabsContent value="devices" className="space-y-3">
          <div className="bg-card border rounded-xl p-4">
            <h3 className="text-sm font-bold mb-1">Multi-Device Login (Online Mode)</h3>
            <p className="text-xs text-muted-foreground mb-3">
              When cloud mode is active you can approve or block every new device. Offline mode runs on a single device only.
            </p>
            <a href="#/devices" className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline">
              → Open Devices page
            </a>
          </div>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Restaurant Name</label>
            <Input value={settings.name} onChange={e => setSettings({ ...settings, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Address</label>
            <Input value={settings.address} onChange={e => setSettings({ ...settings, address: e.target.value })} />
          </div>

          {/* ===== v1.4.0 — Country & Currency (international) ===== */}
          <div className="rounded-lg border p-3 space-y-2">
            <label className="text-xs font-bold flex items-center gap-1.5">
              🌍 Country & Currency
            </label>
            <select
              className="w-full h-10 border rounded-md px-2 text-sm bg-background"
              value={settings.currencyCode || 'PKR'}
              onChange={e => {
                const def = getCurrencyDef(e.target.value);
                // Country drives which languages are offered. If the current
                // language isn't used in the new country, fall back to English.
                let lang = currentLang;
                if (!isLanguageAllowed(lang, def.country)) {
                  lang = 'en';
                  setLanguage('en');
                  setCurrentLang('en');
                }
                setSettings({ ...settings, currencyCode: def.code, countryName: def.country, appLanguage: lang });
              }}
            >
              {currencyOptions().map(c => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.country} — {c.name} ({c.symbol})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Poore software me — POS, bills, receipts, reports — yehi currency use hogi.
              Sample: <strong>{formatMoney(1234.5, { code: settings.currencyCode })}</strong>
            </p>
            <p className="text-[11px] text-amber-600">
              ⚠️ Changing the currency does not convert the <strong>numbers</strong> on old bills — only the symbol changes. Set this before you start trading.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Website URL (optional)</label>
            <Input
              placeholder="https://yourrestaurant.com"
              value={settings.externalWebsiteUrl || ''}
              onChange={e => setSettings({ ...settings, externalWebsiteUrl: e.target.value })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">If you have your own website, paste the link here. It appears on receipts and the portal.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Phone 1</label>
              <Input value={settings.phone1} onChange={e => setSettings({ ...settings, phone1: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Phone 2</label>
              <Input value={settings.phone2} onChange={e => setSettings({ ...settings, phone2: e.target.value })} />
            </div>
          </div>
          {/* ===== v1.14.0 Language ===== */}
          <div className="rounded-lg border p-3 space-y-2">
            <h4 className="text-sm font-bold">🌐 Language / زبان</h4>
            <p className="text-[11px] text-muted-foreground">
              The whole app interface switches to this language. The available languages depend on the <b>country</b> you selected above — Pakistan shows English, Urdu and Roman Urdu; other countries show English (plus their local language where relevant).
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {languagesForCountry(settings.countryName).map(l => {
                const active = currentLang === l.code;
                const cov = translationCoverage(l.code);
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      setLanguage(l.code);
                      setCurrentLang(l.code);
                      setSettings({ ...settings, appLanguage: l.code });
                    }}
                    className={`rounded-lg border-2 p-2 text-left transition-all ${
                      active ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="text-sm font-bold">{l.flag} {l.nativeName}</div>
                    <div className="text-[10px] text-muted-foreground">{l.englishName}</div>
                    <div className={`text-[10px] font-bold mt-0.5 ${
                      cov === 100 ? 'text-green-700' : cov >= 50 ? 'text-amber-700' : 'text-muted-foreground'
                    }`}>
                      {cov}% translated
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Honesty: the app is NOT fully translated yet, and saying so in
                the product is better than a client discovering it mid-service. */}
            {translationCoverage(currentLang) < 100 && (
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded p-2 leading-snug">
                <b>Note:</b> {totalKeys()} core terms are translated so far (POS, payment, tables, notifications). Anything not translated yet <b>stays in English</b> — no screen will ever be blank or broken. Coverage keeps growing with each update.
              </p>
            )}
          </div>

          {/* ===== v1.12.0 Quick Discount Presets (feedback #1 item 11) ===== */}
          <div className="rounded-lg border p-3 space-y-2">
            <h4 className="text-sm font-bold">🏷️ Quick Discount Buttons</h4>
            <p className="text-[11px] text-muted-foreground">
              One-tap discount buttons for the POS. Separate values with commas. Leave empty to hide the buttons completely.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Percent presets (%)</label>
                <Input
                  value={pctPresetText}
                  placeholder="5, 10, 15, 20"
                  inputMode="decimal"
                  onChange={e => {
                    const raw = e.target.value;
                    setPctPresetText(raw);                       // raw text survives
                    setSettings({ ...settings, discountPresets: parsePresets(raw, 100) });
                  }}
                  onBlur={() => setPctPresetText((settings.discountPresets || []).join(', '))}
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {[5, 10, 15, 20, 25, 50].map(v => {
                    const on = (settings.discountPresets || []).includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => togglePreset('pct', v)}
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
                          on ? 'border-primary bg-primary/15 text-primary' : 'hover:bg-accent'
                        }`}
                      >{on ? '✓ ' : '+ '}{v}%</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount presets</label>
                <Input
                  value={amtPresetText}
                  placeholder="50, 100, 200"
                  inputMode="decimal"
                  onChange={e => {
                    const raw = e.target.value;
                    setAmtPresetText(raw);
                    setSettings({ ...settings, discountPresetsAmount: parsePresets(raw) });
                  }}
                  onBlur={() => setAmtPresetText((settings.discountPresetsAmount || []).join(', '))}
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {[20, 50, 100, 200, 500].map(v => {
                    const on = (settings.discountPresetsAmount || []).includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => togglePreset('amt', v)}
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
                          on ? 'border-primary bg-primary/15 text-primary' : 'hover:bg-accent'
                        }`}
                      >{on ? '✓ ' : '+ '}{v}</button>
                    );
                  })}
                </div>
              </div>
            </div>
            {((settings.discountPresets || []).length > 0 || (settings.discountPresetsAmount || []).length > 0) && (
              <div className="flex flex-wrap gap-1 pt-1">
                <span className="text-[10px] text-muted-foreground mr-1">Preview:</span>
                {(settings.discountPresets || []).map(p => (
                  <span key={`p${p}`} className="px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-[10px] font-bold">{p}%</span>
                ))}
                {(settings.discountPresetsAmount || []).map(a => (
                  <span key={`a${a}`} className="px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-[10px] font-bold">{a}</span>
                ))}
              </div>
            )}
          </div>

          {/* ===== v1.6.1 Custom Payment Types (feedback #2 item 3) ===== */}
          <div className="rounded-lg border p-3 space-y-2">
            <h4 className="text-sm font-bold">💳 Payment Types</h4>
            <p className="text-[11px] text-muted-foreground">
              Built-in: Cash, Card, Online, Credit. Add your own extra types here (for example NETS, PayNow, GrabPay) — they appear as buttons on the payment screen and are counted separately in reports.
              {' '}<b>Note:</b> first turn on "Custom Payment Types" under Advanced → Features.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(settings.customPaymentTypes || []).map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs font-semibold">
                  {t}
                  <button
                    type="button"
                    onClick={() => setSettings({
                      ...settings,
                      customPaymentTypes: (settings.customPaymentTypes || []).filter((_, j) => j !== i),
                    })}
                    className="text-destructive font-bold ml-0.5"
                    aria-label={`Remove ${t}`}
                  >×</button>
                </span>
              ))}
              {(settings.customPaymentTypes || []).length === 0 && (
                <span className="text-xs text-muted-foreground italic">Koi custom type nahi</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="New type (e.g. NETS)"
                value={newPayType}
                onChange={e => setNewPayType(e.target.value)}
                className="h-8 text-xs"
                onKeyDown={e => { if (e.key === 'Enter') addPayType(); }}
              />
              <Button size="sm" className="h-8" onClick={addPayType}>Add</Button>
            </div>
          </div>

          {/* ===== v1.5.0 Service Charge + GST / Tax ===== */}
          <div className="rounded-lg border p-3 space-y-3">
            <h4 className="text-sm font-bold">💰 Service Charge & Tax (GST)</h4>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Tax Mode</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {([
                  { v: 'none', label: 'Off', desc: 'Koi GST nahi' },
                  { v: 'exclusive', label: 'Exclusive', desc: 'GST will be added on top' },
                  { v: 'inclusive', label: 'Inclusive', desc: 'Included in the price' },
                ] as const).map(m => {
                  const active = (settings.taxMode || 'none') === m.v;
                  return (
                    <button
                      key={m.v}
                      type="button"
                      onClick={() => setSettings({ ...settings, taxMode: m.v })}
                      className={`rounded-lg border p-2 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
                    >
                      <div className="text-xs font-bold">{m.label}</div>
                      <div className="text-[10px] text-muted-foreground">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Service Charge (%)</label>
                <Input
                  type="number" min={0} max={100} step={0.5}
                  value={settings.serviceChargePercent ?? 0}
                  onChange={e => setSettings({ ...settings, serviceChargePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {settings.taxLabel || 'GST'} (%)
                </label>
                <Input
                  type="number" min={0} max={100} step={0.5}
                  value={settings.taxPercent ?? 0}
                  disabled={(settings.taxMode || 'none') === 'none'}
                  onChange={e => setSettings({ ...settings, taxPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tax Label (receipt par)</label>
                <Input
                  value={settings.taxLabel ?? 'GST'}
                  placeholder="GST / VAT / Sales Tax"
                  onChange={e => setSettings({ ...settings, taxLabel: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tax Amount (PKR) — legacy flat</label>
                <Input
                  type="number"
                  value={settings.taxAmount ?? 0}
                  disabled={(settings.taxMode || 'none') !== 'none'}
                  onChange={e => setSettings({ ...settings, taxAmount: Number(e.target.value) || 0 })}
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Sirf tab use hota hai jab Tax Mode = Off ho.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={settings.taxOnServiceCharge !== false}
                disabled={(settings.taxMode || 'none') === 'none'}
                onCheckedChange={(v) => setSettings({ ...settings, taxOnServiceCharge: !!v })}
              />
              Service charge par bhi {settings.taxLabel || 'GST'} lagayein
            </label>

            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={settings.roundGrandTotal === true}
                onCheckedChange={(v) => setSettings({ ...settings, roundGrandTotal: !!v })}
              />
              Round the grand total to a whole number
            </label>

            {/* v1.9.1 — cash rounding (Singapore 5c, Australia/NZ etc.) */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Cash Rounding — nearest
              </label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {([
                  { v: 0, label: 'Off' },
                  { v: 0.05, label: '0.05' },
                  { v: 0.10, label: '0.10' },
                  { v: 1, label: '1.00' },
                ] as const).map(o => {
                  const active = (Number(settings.roundToNearest) || 0) === o.v;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setSettings({ ...settings, roundToNearest: o.v })}
                      className={`h-9 rounded-lg border text-xs font-bold transition-colors ${
                        active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Singapore no longer uses 1c/2c coins — choose <b>0.05</b>. Tax stays exact; only the customer's final amount is rounded, and the difference is shown as a "Rounding" line on the receipt.
              </p>
            </div>

            {/* Live worked example — cashier/owner ko foran samajh aa jata hai
                ke unki settings se bill kaisa banega. */}
            {(() => {
              const preview = computeBillTotals(100, 0, {
                taxMode: settings.taxMode || 'none',
                taxPercent: settings.taxPercent || 0,
                serviceChargePercent: settings.serviceChargePercent || 0,
                taxOnServiceCharge: settings.taxOnServiceCharge !== false,
                taxLabel: settings.taxLabel || 'GST',
                legacyFlatTax: settings.taxAmount || 0,
                roundTotal: settings.roundGrandTotal === true,
              });
              return (
                <div className="rounded-md bg-muted/50 p-2 text-[11px] font-mono space-y-0.5">
                  <div className="font-sans font-bold text-muted-foreground mb-1">
                    Misaal — Rs.100 ka item:
                  </div>
                  <div className="flex justify-between"><span>Item</span><span>100.00</span></div>
                  {preview.serviceCharge > 0 && (
                    <div className="flex justify-between">
                      <span>Service Charge ({preview.serviceChargePercent}%)</span>
                      <span>{preview.serviceCharge.toFixed(2)}</span>
                    </div>
                  )}
                  {preview.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span>
                        {preview.taxLabel}
                        {preview.taxMode === 'inclusive'
                          ? ` ${preview.taxPercent}% (inclusive)`
                          : preview.taxPercent > 0 ? ` (${preview.taxPercent}%)` : ''}
                      </span>
                      <span>{preview.taxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t pt-0.5 mt-0.5">
                    <span>Grand Total</span><span>Rs.{preview.grandTotal.toFixed(2)}</span>
                  </div>
                  {preview.taxMode === 'inclusive' && preview.taxAmount > 0 && (
                    <div className="text-[10px] text-muted-foreground font-sans pt-0.5">
                      Inclusive: customer sirf Rs.{preview.grandTotal.toFixed(2)} deta hai —
                      {' '}{preview.taxLabel} pehle se price me shamil hai.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* COST TRACKING TOGGLE — master switch for food cost / profitability features */}
          <div className="border-2 rounded-lg p-4 space-y-2 border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">💰 Food Cost & Profit Tracking</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ON: enables Recipes, Food Cost %, Margin, Profitability reports and Inventory Valuation.
                  <br/>OFF: simple POS + stock management (no cost columns, no profit reports).
                </p>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={!!settings.costTrackingEnabled}
                  onChange={e => setSettings({ ...settings, costTrackingEnabled: e.target.checked })}
                />
                <span className="text-xs font-bold">{settings.costTrackingEnabled ? 'ON' : 'OFF'}</span>
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Reload the page after saving so the sidebar updates.
            </p>
          </div>

          {/* DISCOUNT MANAGEMENT */}
          <div className="border-2 rounded-lg p-4 space-y-3 border-status-warning/40 bg-status-warning/5">
            <h3 className="text-sm font-bold flex items-center gap-2">🏷️ Discount Management</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="flex items-center gap-2 bg-card border rounded-md px-3 py-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary"
                  checked={settings.pkrDiscountEnabled !== false}
                  onChange={e => setSettings({ ...settings, pkrDiscountEnabled: e.target.checked })} />
                <span className="text-xs font-bold">PKR Discount</span>
              </label>
              <label className="flex items-center gap-2 bg-card border rounded-md px-3 py-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary"
                  checked={settings.percentDiscountEnabled !== false}
                  onChange={e => setSettings({ ...settings, percentDiscountEnabled: e.target.checked })} />
                <span className="text-xs font-bold">% Discount</span>
              </label>
              <label className="flex items-center gap-2 bg-card border rounded-md px-3 py-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary"
                  checked={!!settings.eventDiscountEnabled}
                  onChange={e => setSettings({ ...settings, eventDiscountEnabled: e.target.checked })} />
                <span className="text-xs font-bold">Event Discount</span>
              </label>
            </div>
            {settings.eventDiscountEnabled && (
              <div className="grid grid-cols-3 gap-2 bg-card rounded-md p-3 border">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Event Title</label>
                  <Input value={settings.eventDiscountTitle || ''}
                    onChange={e => setSettings({ ...settings, eventDiscountTitle: e.target.value })}
                    placeholder="e.g. Eid Discount" />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Type</label>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                    value={settings.eventDiscountType || 'percent'}
                    onChange={e => setSettings({ ...settings, eventDiscountType: e.target.value as 'percent' | 'pkr' })}
                  >
                    <option value="percent">Percentage %</option>
                    <option value="pkr">Flat PKR</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">
                    {(settings.eventDiscountType || 'percent') === 'percent' ? 'Percent (%)' : 'Amount ({currencySymbol()})'}
                  </label>
                  {(settings.eventDiscountType || 'percent') === 'percent' ? (
                    <Input type="number" value={settings.eventDiscountPercent || ''}
                      onChange={e => setSettings({ ...settings, eventDiscountPercent: Number(e.target.value) || 0 })}
                      placeholder="10" />
                  ) : (
                    <Input type="number" value={settings.eventDiscountAmount || ''}
                      onChange={e => setSettings({ ...settings, eventDiscountAmount: Number(e.target.value) || 0 })}
                      placeholder="100" />
                  )}
                </div>
                <p className="col-span-3 text-[10px] text-muted-foreground">
                  This discount is applied automatically to every bill (except excluded categories).
                </p>
              </div>
            )}
            <div className="bg-card rounded-md p-3 border space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground">Excluded Categories (no discount)</label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {getCategories().map(c => {
                  const checked = (settings.discountExcludedCategoryIds || []).includes(c.id);
                  return (
                    <button key={c.id}
                      onClick={() => {
                        const cur = settings.discountExcludedCategoryIds || [];
                        const next = checked ? cur.filter(x => x !== c.id) : [...cur, c.id];
                        setSettings({ ...settings, discountExcludedCategoryIds: next });
                      }}
                      className={`text-[11px] px-2 py-1 rounded-md border font-bold transition-colors ${
                        checked ? 'bg-destructive/15 text-destructive border-destructive/40' : 'bg-muted hover:bg-accent'
                      }`}
                    >
                      {checked ? '✕ ' : ''}{c.icon} {c.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground italic">Example: Beverages / Cold Drinks per discount na lage.</p>
            </div>
          </div>

          {/* SOFTWARE FEATURE CONTROL — CASHIER RESTRICTIONS */}
          <div className="border-2 rounded-lg p-4 space-y-3 border-violet-500/40 bg-violet-500/5">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">🔒 Software Feature Control — Cashier Restrictions</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Control which actions a cashier can perform alone and which need admin approval. These restrictions never apply to Admin / Manager users.
              </p>
            </div>
            <label className="flex items-start gap-3 bg-card border rounded-md px-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary mt-0.5"
                checked={!!settings.cashierDiscountRequiresApproval}
                onChange={e => setSettings({ ...settings, cashierDiscountRequiresApproval: e.target.checked })}
              />
              <div className="flex-1">
                <div className="text-xs font-bold flex items-center gap-2">
                  Discount require Admin Approval
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${settings.cashierDiscountRequiresApproval ? 'bg-amber-500/20 text-amber-700' : 'bg-green-500/20 text-green-700'}`}>
                    {settings.cashierDiscountRequiresApproval ? 'ON — Approval Required' : 'OFF — Cashier Can Discount'}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  ON: the discount field is disabled for cashiers in the POS. Discounts must be applied in the Bill Editor (Admin), where an admin approves or edits them.
                  <br />OFF: cashiers can apply discounts directly in the POS.
                </p>
              </div>
            </label>
          </div>

          {/* LOYALTY PROGRAM */}
          <div className="border-2 rounded-lg p-4 space-y-3 border-gold/40 bg-gold/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">🏆 Loyalty Program</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Customers ko har paid order par automatic points milein. Points balance Customers page par dikhe.
                </p>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                <input type="checkbox" className="h-5 w-5 accent-primary"
                  checked={!!settings.loyaltyEnabled}
                  onChange={e => setSettings({ ...settings, loyaltyEnabled: e.target.checked })} />
                <span className="text-xs font-bold">{settings.loyaltyEnabled ? 'ON' : 'OFF'}</span>
              </label>
            </div>
            {settings.loyaltyEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-card rounded-md p-3 border">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Earn (points per Rs. 100)</label>
                  <Input type="number" min={0} step={0.5}
                    value={settings.loyaltyEarnPerRs100 ?? 1}
                    onChange={e => setSettings({ ...settings, loyaltyEarnPerRs100: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Redeem value (Rs. per 1 point)</label>
                  <Input type="number" min={0} step={0.5}
                    value={settings.loyaltyRedeemRate ?? 1}
                    onChange={e => setSettings({ ...settings, loyaltyRedeemRate: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Min points to redeem</label>
                  <Input type="number" min={0}
                    value={settings.loyaltyMinRedeemPoints ?? 100}
                    onChange={e => setSettings({ ...settings, loyaltyMinRedeemPoints: Number(e.target.value) || 0 })} />
                </div>
                <p className="col-span-full text-[10px] text-muted-foreground italic">
                  Example: 1 pt / Rs.100 spent. Rs.1000 bill = 10 points. 100 points = Rs.100 redeem value.
                </p>
              </div>
            )}
          </div>

          {/* QR Master Toggle (granular QR settings already in Receipt & QR tab) */}
          <div className="border rounded-lg p-3 flex items-center justify-between bg-card">
            <div>
              <h3 className="text-sm font-bold">📱 Receipt QR Code</h3>
              <p className="text-[11px] text-muted-foreground">Master toggle — when OFF, no QR code is printed on receipts.</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-5 w-5 accent-primary"
                checked={settings.qrEnabled !== false}
                onChange={e => setSettings({ ...settings, qrEnabled: e.target.checked })} />
              <span className="text-xs font-bold">{settings.qrEnabled !== false ? 'ON' : 'OFF'}</span>
            </label>
          </div>

          {/* Urdu Font Selection */}
          <div className="border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-bold">🔤 Urdu Font Selection</h3>
            <p className="text-xs text-muted-foreground">ریسٹورنٹ نام، ایڈریس، آئٹم نام وغیرہ کے لیے اردو فونٹ منتخب کریں</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'none', label: 'Default (English)', preview: 'Restaurant Name' },
                { value: 'Aseer Unicode', label: 'Aseer Unicode', preview: 'ریسٹورنٹ نام' },
                { value: 'AA Sameer Armaa', label: 'AA Sameer Armaa', preview: 'ریسٹورنٹ نام' },
                { value: 'Jameel Noori Nastaleeq', label: 'Jameel Noori Nastaleeq', preview: 'ریسٹورنٹ نام' },
                { value: 'Jameel Noori Nastaleeq Regular', label: 'Jameel Noori Nastaleeq Regular', preview: 'ریسٹورنٹ نام' },
              ] as const).map(font => (
                <button
                  key={font.value}
                  onClick={() => setSettings({ ...settings, urduFont: font.value })}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    settings.urduFont === font.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-accent'
                  }`}
                >
                  <span className="text-xs font-bold block">{font.label}</span>
                  <span
                    className="text-sm block mt-1"
                    style={{ fontFamily: font.value === 'none' ? 'inherit' : `'${font.value}', serif`, direction: font.value !== 'none' ? 'rtl' : 'ltr' }}
                  >
                    {font.value === 'none' ? settings.name || 'Restaurant Name' : font.preview}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Receipt / KOT Logo</label>
            <p className="text-[10px] text-muted-foreground mb-1">This logo appears only on printed receipts and kitchen tickets.</p>
            <div className="flex items-center gap-4 mt-1">
              {settings.logo && (
                <img
                  src={settings.logo}
                  alt="Logo"
                  className="object-contain rounded border bg-background"
                  style={{ width: `${settings.logoWidth || 60}px`, height: `${settings.logoHeight || 60}px` }}
                />
              )}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      Upload Receipt Logo
                      <input type="file" accept="image/*" className="hidden" onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        void uploadAndPersistLogo('logo', file);
                        e.currentTarget.value = '';
                      }} />
                    </label>
                  </Button>
                  {settings.logo && (
                    <Button variant="ghost" size="sm" onClick={() => setSettings({ ...settings, logo: '' })}>Remove</Button>
                  )}
                </div>
                {settings.logo && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-muted-foreground">W</label>
                      <Input
                        type="number"
                        className="w-16 h-7 text-xs"
                        value={settings.logoWidth || 60}
                        onChange={e => setSettings({ ...settings, logoWidth: Math.max(20, Math.min(200, Number(e.target.value))) })}
                        min={20} max={200}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-muted-foreground">H</label>
                      <Input
                        type="number"
                        className="w-16 h-7 text-xs"
                        value={settings.logoHeight || 60}
                        onChange={e => setSettings({ ...settings, logoHeight: Math.max(20, Math.min(200, Number(e.target.value))) })}
                        min={20} max={200}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">px</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===== PER-SURFACE LOGOS ===== */}
          <div className="border-2 rounded-lg p-4 space-y-4 border-primary/30 bg-primary/5">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">🖼️ Per-Surface Logos</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Each surface can use its own logo. Leave empty to fall back to the Receipt Logo above. Uploading here does not affect anywhere else.
              </p>
            </div>

            {/* App/Login logo */}
            <SurfaceLogoRow
              label="Admin App + Login Screen"
              hint="POS sidebar aur owner/cashier login screen ka logo."
              value={settings.appLogo}
              onChange={(v) => setSettings({ ...settings, appLogo: v })}
              onFile={(file) => uploadAndPersistLogo('appLogo', file)}
            />

            {/* Web Portal logo */}
            <SurfaceLogoRow
              label="Web Ordering Portal"
              hint="Online order page (#/order) aur Track Order page ka logo."
              value={settings.webPortalLogo}
              onChange={(v) => setSettings({ ...settings, webPortalLogo: v })}
              onFile={(file) => uploadAndPersistLogo('webPortalLogo', file)}
            />

            {/* Order Taker logo */}
            <SurfaceLogoRow
              label="Order Taker / Waiter App"
              hint="Order Taker mobile portal (#/order-taker/...) ka logo."
              value={settings.orderTakerLogo}
              onChange={(v) => setSettings({ ...settings, orderTakerLogo: v })}
              onFile={(file) => uploadAndPersistLogo('orderTakerLogo', file)}
            />
          </div>

          {/* ===== RESTAURANT PHYSICAL LOCATION ===== */}
          <div className="border-2 rounded-lg p-4 space-y-3 border-status-info/30 bg-status-info/5">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2">📍 Restaurant Physical Location</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Aapke restaurant ki actual location. Yeh Super Admin map par dikhaayi degi (devices ke alawa).
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground">Latitude</label>
                <Input type="number" step="0.000001" value={settings.restaurantLat ?? ''}
                  onChange={e => setSettings({ ...settings, restaurantLat: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder="30.1575" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-muted-foreground">Longitude</label>
                <Input type="number" step="0.000001" value={settings.restaurantLng ?? ''}
                  onChange={e => setSettings({ ...settings, restaurantLng: e.target.value === '' ? undefined : Number(e.target.value) })}
                  placeholder="72.6504" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-muted-foreground">Label</label>
                <Input value={settings.restaurantLocationLabel || ''}
                  onChange={e => setSettings({ ...settings, restaurantLocationLabel: e.target.value })}
                  placeholder="Jhang Main Branch" />
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => {
              if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setSettings({
                    ...settings,
                    restaurantLat: Number(pos.coords.latitude.toFixed(6)),
                    restaurantLng: Number(pos.coords.longitude.toFixed(6)),
                  });
                  toast.success('Location captured');
                },
                (err) => toast.error(err.message || 'Failed to get location'),
                { enableHighAccuracy: true, timeout: 10000 }
              );
            }}>
              📡 Use Current GPS Location
            </Button>
          </div>

          <Button onClick={handleSaveSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving to cloud…' : 'Save Settings'}
          </Button>
        </TabsContent>

        {/* Module Management — what the menu shows, where, and in what order */}
        <TabsContent value="modules" className="space-y-4">
          <ModuleManagementCard />
        </TabsContent>

        {/* Theme Manager */}
        <TabsContent value="theme" className="space-y-4">
          <InterfaceStyleCard />
          {/* The colour themes and Premium Polish belong to the Classic (DT Enterprise) style; Modern has its own
              theme manager above. */}
          {!modern && (<>
          <div className="border-2 rounded-lg p-4 bg-gradient-to-r from-fuchsia-50 to-purple-50 border-fuchsia-200">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2">
                  <span className="text-lg">✨</span>
                  <h3 className="text-sm font-bold">Premium Polish</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Soft card shadows, a subtle background wash, a refined focus ring and a button press-lift.
                  Works on top of every theme — the layout and colours stay the same.
                </p>
              </div>
              <Switch
                checked={premiumPolish}
                onCheckedChange={(v) => {
                  setPremiumPolish(v);
                  setPremiumPolishState(v);
                  toast.success(v ? 'Premium Polish ON ✨' : 'Premium Polish OFF');
                }}
              />
            </div>
          </div>
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              <h3 className="text-sm font-bold">🎨 DT Enterprise colour themes / تھیم تبدیل کریں</h3>
            </div>
            <p className="text-xs text-muted-foreground">اپنی پسند کا تھیم منتخب کریں — تمام سکرینز آٹو اپڈیٹ ہو جائیں گی</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {themes.filter(t => !REFERENCE_THEME_SPECS.some(r => r.id === t.id)).map((theme, themeIdx, shown) => {
                // v1.68.0 — a heading wherever the group changes (the reference collections).
                const groupHeading = theme.group && theme.group !== shown[themeIdx - 1]?.group ? theme.group : null;
                // v1.61.0 — every premium theme is gated, not just the first.
                const isPremium = PREMIUM_THEME_IDS.includes(theme.id);
                const premiumAllowed = !!(settings as any).premiumThemeAllowed;
                const locked = isPremium && !premiumAllowed;
                return (
                  <Fragment key={theme.id}>
                  {groupHeading && (
                    <div className="col-span-full mt-2 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">{groupHeading}</div>
                  )}
                  <button
                    disabled={locked}
                    onClick={() => {
                      if (locked) {
                        toast.error('🔒 Premium Theme locked — Super Admin se allotment maangein (digitaltarget.digital@gmail.com)');
                        return;
                      }
                      setActiveTheme(theme.id);
                      setCurrentTheme(theme.id);
                      // Auto-mark premium as enabled when user picks it
                      if (isPremium) {
                        saveSettings({ ...(settings as any), premiumThemeEnabled: true });
                      } else if ((settings as any).premiumThemeEnabled) {
                        saveSettings({ ...(settings as any), premiumThemeEnabled: false });
                      }
                      toast.success(`Theme changed to ${theme.name}`);
                    }}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${
                      currentTheme === theme.id
                        ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                        : locked
                          ? 'border-dashed border-fuchsia-400/40 bg-fuchsia-50/30 opacity-70 cursor-not-allowed'
                          : 'border-border hover:border-primary/40'
                    }`}
                  >
                    {isPremium && (
                      <span className={`absolute top-2 right-2 text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                        premiumAllowed ? 'bg-fuchsia-600 text-white' : 'bg-gray-300 text-gray-700'
                      }`}>
                        {premiumAllowed ? '✓ UNLOCKED' : '🔒 LOCKED'}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{theme.emoji}</span>
                      <span className="text-sm font-bold">{theme.name}</span>
                      {currentTheme === theme.id && (
                        <span className="ml-auto text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Active</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{theme.description}</p>
                    {locked && (
                      <p className="text-[10px] text-fuchsia-700 mt-1 font-semibold">
                        Premium feature — Super Admin allotment required
                      </p>
                    )}
                    <div className="flex gap-1 mt-2">
                      {['--primary', '--background', '--card', '--accent', '--pos-sidebar'].map(varName => (
                        <div
                          key={varName}
                          className="h-4 w-4 rounded-full border border-border/50"
                          style={{ backgroundColor: `hsl(${theme.variables[varName]})` }}
                        />
                      ))}
                    </div>
                  </button>
                  </Fragment>
                );
              })}
            </div>
          </div>
          </>)}
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          {/* WhatsApp Number & Floating Button Settings */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#25D366]/15 text-[#25D366] flex items-center justify-center shrink-0">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">WhatsApp Floating Button</h3>
                <p className="text-[11px] text-muted-foreground">
                  Online order web pe bottom-right corner mein WhatsApp button dikhega. Customer click kare to seedha WhatsApp pe chala jaye ga.
                </p>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5">
              <div>
                <div className="text-sm font-bold">💬 Enable Floating Button</div>
                <div className="text-[11px] text-muted-foreground">Online order pages pe WhatsApp button show kare</div>
              </div>
              <Switch
                checked={settings.whatsappFloatingEnabled !== false}
                onCheckedChange={v => setSettings({ ...settings, whatsappFloatingEnabled: v })}
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">WhatsApp Number</label>
                <Input
                  value={settings.supportWhatsappNumber || ''}
                  onChange={e => setSettings({ ...settings, supportWhatsappNumber: e.target.value })}
                  placeholder="03001234567 ya +923001234567"
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground">Customers are redirected to this number. If it is empty, phone1 is used.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-muted-foreground">Default Button Message</label>
                <Input
                  value={settings.whatsappFloatingMessage || ''}
                  onChange={e => setSettings({ ...settings, whatsappFloatingMessage: e.target.value })}
                  placeholder="Hello! I wanted to ask about an order."
                  className="text-sm"
                />
                <p className="text-[10px] text-muted-foreground">This pre-filled message is sent to the customer on WhatsApp.</p>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold">WhatsApp Message Templates</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Edit the automatic message templates here. Variables: {'{customer_name}'}, {'{order_number}'}, {'{grand_total}'}, {'{restaurant_name}'}, {'{delivery_status_line}'}, {'{rider_block}'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Default paid message</label>
                <Select
                  value={settings.defaultPaidWhatsAppTemplateId || 'paid-default'}
                  onValueChange={(value) => setSettings({ ...settings, defaultPaidWhatsAppTemplateId: value })}
                >
                  <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    {getWhatsAppTemplates(settings).map(template => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Default delivery message</label>
                <Select
                  value={settings.defaultDeliveryWhatsAppTemplateId || 'delivery-default'}
                  onValueChange={(value) => setSettings({ ...settings, defaultDeliveryWhatsAppTemplateId: value })}
                >
                  <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    {getWhatsAppTemplates(settings).map(template => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setSettings({
                  ...settings,
                  whatsappTemplates: [
                    ...getWhatsAppTemplates(settings),
                    { id: `custom-${Date.now()}`, name: 'Custom Template', body: 'Dear {customer_name},\n' },
                  ],
                })}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Template
              </Button>
            </div>

            {getWhatsAppTemplates(settings).map((template) => (
              <div key={template.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold">{template.name}</p>
                    <p className="text-[10px] text-muted-foreground">ID: {template.id}</p>
                  </div>
                  <div className="flex gap-2">
                    {!['paid-default', 'delivery-default'].includes(template.id) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSettings({
                          ...settings,
                          whatsappTemplates: getWhatsAppTemplates(settings).filter(t => t.id !== template.id),
                          defaultPaidWhatsAppTemplateId: (settings.defaultPaidWhatsAppTemplateId === template.id ? 'paid-default' : settings.defaultPaidWhatsAppTemplateId),
                          defaultDeliveryWhatsAppTemplateId: (settings.defaultDeliveryWhatsAppTemplateId === template.id ? 'delivery-default' : settings.defaultDeliveryWhatsAppTemplateId),
                        })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <Input
                  value={template.name}
                  onChange={e => setSettings({
                    ...settings,
                    whatsappTemplates: getWhatsAppTemplates(settings).map(t => t.id === template.id ? { ...t, name: e.target.value } : t),
                  })}
                />
                <Textarea
                  rows={6}
                  value={template.body}
                  onChange={e => setSettings({
                    ...settings,
                    whatsappTemplates: getWhatsAppTemplates(settings).map(t => t.id === template.id ? { ...t, body: e.target.value } : t),
                  })}
                />
              </div>
            ))}
          </div>

          <Button onClick={handleSaveSettings} className="w-full">Save WhatsApp Templates</Button>
        </TabsContent>

        {/* Receipt & QR Settings */}
        <TabsContent value="receipt" className="space-y-4">
          <ReceiptSettingsTab
            settings={settings}
            setSettings={setSettings}
            onSave={handleSaveSettings}
            sampleOrder={sampleOrder}
          />
        </TabsContent>

        {/* Receipt Text Styling Tab */}
        <TabsContent value="receiptstyle" className="space-y-4">
          <div className="bg-accent/50 rounded-lg p-3 mb-2">
            <p className="text-xs font-bold">📝 ہر ٹیکسٹ لائن کا فونٹ، سائز، بولڈ، اور پوزیشن الگ الگ سیٹ کریں</p>
            <p className="text-[10px] text-muted-foreground mt-1">ہر سیکشن کا اپنا فونٹ، سائز (px)، بولڈ، اور الائنمنٹ (Left/Center/Right) ہے</p>
          </div>

          {([
            { key: 'restaurantName', label: '🏪 Restaurant Name', preview: settings.name || 'Restaurant' },
            { key: 'address', label: '📍 Address', preview: settings.address || 'Address' },
            { key: 'phone', label: '📞 Phone Number', preview: settings.phone1 || '0300-0000000' },
            { key: 'orderId', label: '🔢 Order # / Header', preview: 'ORDER # 123' },
            { key: 'items', label: '🍽️ Item Names', preview: 'Chicken Biryani' },
            { key: 'totals', label: '💰 Totals / Grand Total', preview: 'Grand Total: 1500' },
            { key: 'footer', label: '📜 Footer Text', preview: settings.receiptFooter?.slice(0, 30) || 'Thank you!' },
            { key: 'status', label: '✅ Status (PAID/HOLD)', preview: '★ PAID ★' },
            { key: 'customerDetails', label: '👤 Customer Details', preview: 'Name / Phone / Address' },
              { key: 'visitAgain', label: '🔁 Visit Again Text', preview: 'Please Visit Again' },
              { key: 'marketingFooter', label: '🏷 Marketing Footer', preview: (settings.marketingFooter || 'DIGITAL TARGET').split('\n')[0] },
          ] as const).map(item => {
            const defaultStyle: ReceiptTextStyle = { font: 'default', size: 12, align: 'center', bold: true };
            const currentStyle = settings.receiptStyles?.[item.key] || defaultStyle;
            return (
              <ReceiptStyleEditor
                key={item.key}
                label={item.label}
                preview={item.preview}
                style={currentStyle}
                onChange={(newStyle) => setSettings({
                  ...settings,
                  receiptStyles: {
                    ...settings.receiptStyles,
                    [item.key]: newStyle,
                  },
                })}
                onReset={() => {
                  const next = { ...(settings.receiptStyles || {}) };
                  delete (next as Record<string, unknown>)[item.key];
                  setSettings({ ...settings, receiptStyles: next });
                }}
              />
            );
          })}

          <div className="border-t pt-4 mt-4">
            <h3 className="text-sm font-bold mb-3">🖥️ POS Display Fonts</h3>
            <p className="text-[10px] text-muted-foreground mb-3">POS سکرین پر کیٹیگری اور آئٹم کے فونٹ سیٹ کریں</p>
            <div className="space-y-4">
              <ReceiptStyleEditor
                label="📂 Category Names"
                preview="Biryani / بریانی"
                style={settings.categoryStyle || { font: 'default', size: 12, align: 'left', bold: true }}
                onChange={(s) => setSettings({ ...settings, categoryStyle: s })}
              />
              <ReceiptStyleEditor
                label="🍽️ Menu Item Names"
                preview="Chicken Karahi / چکن کڑاہی"
                style={settings.menuItemStyle || { font: 'default', size: 12, align: 'left', bold: true }}
                onChange={(s) => setSettings({ ...settings, menuItemStyle: s })}
              />
              <div>
                <label className="text-[11px] font-bold text-muted-foreground mb-1 block">🧮 Menu Items Per Row</label>
                <select
                  className="w-full sm:w-auto h-9 rounded-md border bg-background px-2 text-sm"
                  value={settings.menuGridColumns || 6}
                  onChange={e => setSettings({ ...settings, menuGridColumns: Number(e.target.value) })}
                >
                  <option value={3}>3 columns</option>
                  <option value={4}>4 columns</option>
                  <option value={5}>5 columns</option>
                  <option value={6}>6 columns</option>
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">How many menu items appear per row on the POS screen (most useful with the sidebar collapsed).</p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-muted-foreground mb-1 block">📂 Category Layout (POS)</label>
                <select
                  className="w-full sm:w-auto h-9 rounded-md border bg-background px-2 text-sm"
                  value={settings.categoryLayout || 'top'}
                  onChange={e => setSettings({ ...settings, categoryLayout: e.target.value as 'top' | 'side' })}
                >
                  <option value="top">Top — horizontal ribbon (default)</option>
                  <option value="side">Side — left vertical sidebar</option>
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Admin apni restaurant ke hisaab se categories ki position select kar sakta hai — upar (ribbon) ya menu ke saath bagal mein (sidebar).</p>
              </div>
            </div>
          </div>

          {/* ===== Advanced Menu Flow (Flavors + Size/Inch) ===== */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-lg p-4 space-y-3 border border-amber-200/50">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">🍕 Advanced Menu Flow</h3>
              <p className="text-[11px] text-muted-foreground">Pizza-style items ke liye Flavor → Size/Inch selection. Simple items (Burger, Fries, Beverages) pe koi farq nahi.</p>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={!!settings.advancedMenuFlow}
                onCheckedChange={(v) => setSettings({ ...settings, advancedMenuFlow: !!v })}
                className="mt-0.5"
              />
              <div className="text-xs">
                <div className="font-bold">Enable Advanced Menu Flow</div>
                <div className="text-[10px] text-muted-foreground">ON: items that have Size/Inch variants open a selection popup in the POS. OFF: the classic flow is used.</div>
              </div>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={!!settings.enableFlavorLayer}
                onCheckedChange={(v) => setSettings({ ...settings, enableFlavorLayer: !!v })}
                className="mt-0.5"
              />
              <div className="text-xs">
                <div className="font-bold">Enable Sub-Category / Flavor Layer</div>
                <div className="text-[10px] text-muted-foreground">ON: category click pe pehle flavors (Chicken Fajita / BBQ / Supreme …) show hon, phir item.</div>
              </div>
            </label>

          </div>

          <Button onClick={handleSaveSettings} className="w-full">Save Receipt Font Settings</Button>
        </TabsContent>

        <TabsContent value="tables" className="space-y-4">
          {/* Floors section */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Floors / Sections</h4>
                <p className="text-[10px] text-muted-foreground">e.g. Ground, First Floor, Outdoor, Car Dining, Family Hall</p>
              </div>
              <Button size="sm" variant="outline" onClick={addFloor}><Plus className="h-3 w-3 mr-1" /> Add Floor</Button>
            </div>
            {floors.length === 0 && <p className="text-[11px] text-muted-foreground italic">No floors yet. Tables will show under "Unassigned".</p>}
            <div className="flex flex-wrap gap-2">
              {floors.map(f => (
                <div key={f.id} className="flex items-center gap-1 bg-card border rounded-md pl-2 pr-1 py-1">
                  <Input
                    value={f.name}
                    className="h-6 w-32 text-xs border-0 p-0 focus-visible:ring-0"
                    onChange={e => { const v = e.target.value; setFloors(prev => prev.map(x => x.id === f.id ? { ...x, name: v } : x)); saveFloor({ ...f, name: v }); }}
                  />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeFloor(f.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Kitchens section */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Kitchens / Stations</h4>
                <p className="text-[10px] text-muted-foreground">e.g. Main, BBQ, Beverage, Basement, Outdoor — used to route items on KDS.</p>
              </div>
              <Button size="sm" variant="outline" onClick={addKitchen}><Plus className="h-3 w-3 mr-1" /> Add Kitchen</Button>
            </div>
            {kitchens.length === 0 && <p className="text-[11px] text-muted-foreground italic">No kitchens yet. All items will show on the default kitchen display.</p>}
            <div className="flex flex-wrap gap-2">
              {kitchens.map(k => (
                <div key={k.id} className="flex items-center gap-1 bg-card border rounded-md pl-2 pr-1 py-1">
                  <Input
                    value={k.name}
                    className="h-6 w-32 text-xs border-0 p-0 focus-visible:ring-0"
                    onChange={e => { const v = e.target.value; setKitchens(prev => prev.map(x => x.id === k.id ? { ...x, name: v } : x)); saveKitchen({ ...k, name: v }); }}
                  />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeKitchen(k.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">Assign each menu item to a kitchen from <strong>Menu Manager → Edit Item → Kitchen</strong>.</p>
          </div>



          {/* Tables list */}
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tables</h4>
            <Button size="sm" onClick={addTable}><Plus className="h-3 w-3 mr-1" /> Add Table</Button>
          </div>
          {tables.map(t => (
            <div key={t.id} className="flex items-center gap-2 bg-card border rounded-lg p-3 flex-wrap">
              <Input value={t.name} className="flex-1 min-w-[120px] h-8 text-xs" placeholder="Name"
                onChange={e => { const v = e.target.value; setTables(prev => prev.map(x => x.id === t.id ? { ...x, name: v } : x)); saveTable({ ...t, name: v }); }} />
              <Input type="number" min={1} max={20} value={t.seats} className="w-20 h-8 text-xs" placeholder="Chairs"
                onChange={e => { const v = Math.max(1, Number(e.target.value) || 1); setTables(prev => prev.map(x => x.id === t.id ? { ...x, seats: v } : x)); saveTable({ ...t, seats: v }); }} />
              <Select
                value={t.shape || 'square'}
                onValueChange={(v) => { const sh = v as any; setTables(prev => prev.map(x => x.id === t.id ? { ...x, shape: sh } : x)); saveTable({ ...t, shape: sh }); }}
              >
                <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="Shape" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="round">🟢 Round</SelectItem>
                  <SelectItem value="square">🟦 Square</SelectItem>
                  <SelectItem value="rectangle">▭ Rectangle</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={t.floorId || '__none__'}
                onValueChange={(v) => { const fid = v === '__none__' ? undefined : v; setTables(prev => prev.map(x => x.id === t.id ? { ...x, floorId: fid } : x)); saveTable({ ...t, floorId: fid }); }}
              >
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Floor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Unassigned —</SelectItem>
                  {floors.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => { deleteTable(t.id); setTables(getTables().slice()); }}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </TabsContent>


        <TabsContent value="waiters" className="space-y-3">
          <Button size="sm" onClick={addWaiter}><Plus className="h-3 w-3 mr-1" /> Add Waiter</Button>
          {waiters.map(w => (
            <div key={w.id} className="flex items-center gap-2 bg-card border rounded-lg p-3">
              <Input value={w.name} className="flex-1 h-8 text-xs" placeholder="Name"
                onChange={e => { const v = e.target.value; setWaiters(prev => prev.map(x => x.id === w.id ? { ...x, name: v } : x)); saveWaiter({ ...w, name: v }); }} />
              <Input value={w.phone} className="w-32 h-8 text-xs" placeholder="Phone"
                onChange={e => { const v = e.target.value; setWaiters(prev => prev.map(x => x.id === w.id ? { ...x, phone: v } : x)); saveWaiter({ ...w, phone: v }); }} />
              <Button variant="ghost" size="sm" onClick={() => { deleteWaiter(w.id); setWaiters(getWaiters().slice()); }}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="riders" className="space-y-3">
          <Button size="sm" onClick={addRider}><Plus className="h-3 w-3 mr-1" /> Add Rider</Button>
          <p className="text-[11px] text-muted-foreground">
            Riders sign in to this restaurant's <b>Rider Portal</b> with their phone number + PIN. Default PIN = <b>0000</b>.
            <br />
            Riders created in <b>Users &amp; Access</b> (role: Rider) appear here automatically — this list is for quick edits only.
          </p>
          {riders.map(r => (
            <div key={r.id} className="flex items-center gap-2 bg-card border rounded-lg p-3 flex-wrap">
              <Input value={r.name} className="flex-1 min-w-[120px] h-8 text-xs" placeholder="Name"
                onChange={e => { const v = e.target.value; setRiders(prev => prev.map(x => x.id === r.id ? { ...x, name: v } : x)); saveRider({ ...r, name: v }); }} />
              <Input value={r.phone} className="w-32 h-8 text-xs" placeholder="Phone (03xxxxxxxxx)"
                onChange={e => { const v = e.target.value; setRiders(prev => prev.map(x => x.id === r.id ? { ...x, phone: v } : x)); saveRider({ ...r, phone: v }); }} />
              <Input value={r.pin || ''} maxLength={6} className="w-20 h-8 text-xs font-mono" placeholder="PIN"
                onChange={e => { const v = e.target.value.replace(/\D/g, ''); setRiders(prev => prev.map(x => x.id === r.id ? { ...x, pin: v } : x)); saveRider({ ...r, pin: v }); }} />
              <label className="flex items-center gap-1 text-[11px]">
                <input type="checkbox" checked={r.isActive} onChange={e => { saveRider({ ...r, isActive: e.target.checked }); setRiders(getRiders().slice()); }} />
                Active
              </label>
              <Button variant="ghost" size="sm" onClick={() => { deleteRider(r.id); setRiders(getRiders().slice()); }}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </TabsContent>

        {/* KOT Settings Tab */}
        <TabsContent value="kot" className="space-y-4">
          <KotSettingsTab
            settings={settings}
            setSettings={setSettings}
            onSave={handleSaveSettings}
            printers={printers}
            kitchens={kitchens}
            sampleOrder={sampleOrder}
            onTestPrint={setTestPrintKind}
          />
        </TabsContent>

        {/* Printer Settings Tab */}
        <TabsContent value="printer" className="space-y-4">
          <PrinterSettingsTab
            settings={settings}
            setSettings={setSettings}
            onSave={handleSaveSettings}
            printers={printers}
            receiptSizePresets={receiptSizePresets}
            autoStartEnabled={autoStartEnabled}
            onToggleAutoStart={handleToggleAutoStart}
          />
        </TabsContent>

        {/* Display Settings Tab */}
        <TabsContent value="display" className="space-y-4">
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-bold">📺 Customer Display / Kitchen Screen</h3>
            <p className="text-xs text-muted-foreground">سیکنڈری سکرین پر کسٹمر کو آرڈر اور ٹوٹل دکھائیں یا پروموشنل ویڈیو/امیجز چلائیں۔</p>

            {/* Enable Toggle */}
            <div className="flex items-center justify-between bg-card border rounded-lg p-3">
              <div>
                <p className="text-xs font-bold">Enable Display Screen</p>
                <p className="text-[10px] text-muted-foreground">سیکنڈری سکرین یا TV پر ڈسپلے آن کریں</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, displayEnabled: !settings.displayEnabled })}
                className={`w-12 h-6 rounded-full transition-colors relative ${settings.displayEnabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.displayEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {settings.displayEnabled && (
              <div className="space-y-3 pl-2 border-l-2 border-primary/30">
                {/* Show Items */}
                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Show Live Order Items</p>
                    <p className="text-[10px] text-muted-foreground">آرڈر کی آئٹمز لائیو دکھائیں</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, displayShowItems: !settings.displayShowItems })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.displayShowItems !== false ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.displayShowItems !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Show Total */}
                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Show Total Amount</p>
                    <p className="text-[10px] text-muted-foreground">ٹوٹل رقم بڑے فونٹ میں دکھائیں</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, displayShowTotal: !settings.displayShowTotal })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.displayShowTotal !== false ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.displayShowTotal !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Fullscreen */}
                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Fullscreen Mode</p>
                    <p className="text-[10px] text-muted-foreground">ڈسپلے فل سکرین ہو</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, displayFullscreen: !settings.displayFullscreen })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.displayFullscreen ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.displayFullscreen ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Promo Images Upload */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Promotional Images / Slideshow</label>
                  <p className="text-[10px] text-muted-foreground mb-2">جب کوئی آرڈر نہ ہو تو یہ تصاویر سلائیڈ شو کے طور پر دکھائی جائیں گی</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(settings.displayPromoImages || []).map((img, idx) => (
                      <div key={idx} className="relative group">
                        <img src={img} alt={`Promo ${idx + 1}`} className="h-16 w-24 rounded object-cover border" />
                        <button
                          onClick={() => {
                            const imgs = [...(settings.displayPromoImages || [])];
                            imgs.splice(idx, 1);
                            setSettings({ ...settings, displayPromoImages: imgs });
                          }}
                          className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-4 w-4 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      Add Image
                      <input type="file" accept="image/*" className="hidden" onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 2 * 1024 * 1024) { toast.error('Image max 2MB'); return; }
                        try {
                          const url = await uploadTenantImage(file, 'promo');
                          setSettings({
                            ...settings,
                            displayPromoImages: [...(settings.displayPromoImages || []), url],
                          });
                        } catch (err: any) { toast.error(err?.message || 'Upload failed'); }
                      }} />
                    </label>
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Button onClick={handleSaveSettings} className="w-full">Save Display Settings</Button>
        </TabsContent>

        {/* Features / Modules Tab — v1.3.1 multi-tenant control centre */}
        <TabsContent value="features" className="space-y-4">
          <OptionalFeaturesPanel
            settings={settings}
            onChange={(next) => setSettings(next)}
            readOnly={!isAdmin}
          />
          <Button onClick={handleSaveSettings} className="w-full" disabled={!isAdmin}>
            Save Feature Settings
          </Button>
        </TabsContent>

        {/* Day Close Tab */}
        <TabsContent value="dayclose" className="space-y-4">
          {/* v1.96.0 — Day Close has its own page (sidebar → Day Close); this tab only points to it. */}
          <div className="bg-card border rounded-xl p-6 space-y-3">
            <div className="flex items-start gap-3">
              <Moon className="h-6 w-6 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold">Day Close has its own page</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Print the shift report, choose what the day close clears and which modules reset to 00, then close the day —
                  step by step, with the counts shown before anything happens.
                </p>
              </div>
            </div>
            <Button onClick={() => { window.location.hash = '#/day-close'; }}>
              <Moon className="h-4 w-4 mr-2" /> Open Day Close
            </Button>
          </div>
        </TabsContent>
      </Tabs>



      {/* Hidden Test Print render — KitchenReceipt / ReceiptPreview with autoPrint */}
      {testPrintKind && (() => {
        const now = new Date().toISOString();
        const testOrder: any = {
          id: 'TEST-' + Date.now(),
          orderNumber: 9999,
          orderType: 'dine-in',
          status: 'pending',
          source: 'pos',
          tableName: 'TEST',
          cashierName: currentUser?.name || 'Test',
          items: [
            { id: 'ti1', name: 'Test Item A', qty: 1, price: 100, total: 100, unit: 'pcs', categoryName: 'Test' },
            { id: 'ti2', name: 'Test Item B', qty: 2, price: 50, total: 100, unit: 'pcs', categoryName: 'Test', notes: 'Extra cheese' },
          ],
          subtotal: 200, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0,
          grandTotal: 200, paymentMethod: 'cash',
          createdAt: now, notes: '*** TEST PRINT — this is not a real order ***',
        };
        return (
          <div style={{ position: 'fixed', left: -9999, top: -9999, width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
            {testPrintKind === 'kot' ? (
              <KitchenReceipt
                order={testOrder}
                settings={settings}
                autoPrint
                autoPrintDelayMs={80}
                showPrintButton={false}
                onAutoPrintComplete={() => { setTestPrintKind(null); toast.success('Test KOT print sent'); }}
              />
            ) : (
              <ReceiptPreview
                order={testOrder}
                settings={settings}
                autoPrint
                showPrintButton={false}
              />
            )}
          </div>
        );
      })()}
    </div>
  );
}

// Reusable per-surface logo uploader (used in General tab)
function SurfaceLogoRow({ label, hint, value, onChange, onFile }: {
  label: string;
  hint?: string;
  value?: string;
  onChange: (v: string) => void;
  onFile: (file: File) => Promise<void>;
}) {
  return (
    <div className="bg-card border rounded-lg p-3 space-y-2">
      <div>
        <div className="text-xs font-bold">{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex items-center gap-3">
        {value
          ? <img src={value} alt="" className="h-14 w-14 rounded-lg object-cover border" />
          : <div className="h-14 w-14 rounded-lg border-2 border-dashed bg-muted/40 flex items-center justify-center text-[9px] text-muted-foreground">No logo</div>}
        <div className="flex-1 flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <label className="cursor-pointer">
              {value ? 'Replace' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                void onFile(f);
                e.currentTarget.value = '';
              }} />
            </label>
          </Button>
          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange('')}>Remove</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// NotePresetsEditor — manage a list of quick-pick special-note chips.
// =====================================================================
function NotePresetsEditor({ value, onChange }: { value: string[]; onChange: (list: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.some(x => x.toLowerCase() === v.toLowerCase())) { setDraft(''); return; }
    onChange([...value, v].slice(0, 30));
    setDraft('');
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, 80))}
          placeholder="e.g. No onion"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="h-9 text-xs"
        />
        <Button type="button" size="sm" onClick={add} className="h-9 px-3">Add</Button>
      </div>
      {value.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Abhi koi preset nahi — upar likh kar Add one.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/30 text-[11px] font-semibold text-primary">
              {n}
              <button type="button" onClick={() => remove(i)} className="hover:bg-destructive/20 rounded-full px-1 text-destructive font-bold leading-none">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
function toEmbedUrl(mapUrl?: string, lat?: number, lng?: number): string | null {
  if (mapUrl) {
    // If user pasted full iframe HTML, extract src
    const srcMatch = mapUrl.match(/src=["']([^"']+)["']/i);
    const url = srcMatch ? srcMatch[1] : mapUrl;
    if (url.includes('google.com/maps/embed')) return url;
    // Short link expansion not possible client-side; fall through
  }
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d5000!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2s`;
  }
  return null;
}

// ServiceAreasEditor: City + Area entry with suggestions + GPS + Map Embed
// =============================================================================
function ServiceAreasEditor({
  settings,
  setSettings,
  onSave,
}: {
  settings: RestaurantSettings;
  setSettings: (s: RestaurantSettings) => void;
  onSave: () => void;
}) {
  const [cityInput, setCityInput] = useState('');
  const [areaCity, setAreaCity] = useState<string>('');
  const [areaInput, setAreaInput] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // Flatten PK dataset for suggestions
  const allCities = PAKISTAN_AREAS.flatMap(p => p.cities.map(c => c.city));
  const cityToAreas: Record<string, string[]> = {};
  PAKISTAN_AREAS.forEach(p => p.cities.forEach(c => { cityToAreas[c.city.toLowerCase()] = c.areas; }));

  const cities = settings.serviceCities || [];
  const areas = settings.serviceAreas || [];
  const locs = settings.serviceLocations || {};

  const updateLoc = (key: string, patch: Partial<{ lat: number; lng: number; mapUrl: string }>) => {
    const next = { ...(settings.serviceLocations || {}) };
    next[key] = { ...(next[key] || {}), ...patch };
    setSettings({ ...settings, serviceLocations: next });
  };
  const clearLoc = (key: string) => {
    const next = { ...(settings.serviceLocations || {}) };
    delete next[key];
    setSettings({ ...settings, serviceLocations: next });
  };

  const addCity = () => {
    const val = cityInput.trim();
    if (!val) return;
    if (cities.some(x => x.toLowerCase() === val.toLowerCase())) {
      toast.error('This city already exists'); return;
    }
    setSettings({ ...settings, serviceCities: [...cities, val] });
    setCityInput('');
  };

  const addArea = () => {
    const val = areaInput.trim();
    if (!val) return;
    if (!areaCity) { toast.error('Select a city first'); return; }
    const key = `${areaCity}::${val}`;
    if (areas.some(x => x.toLowerCase() === val.toLowerCase()) && !locs[key]) {
      // allow same area string under different city via prefix display, but warn duplicate plain area
    }
    if (areas.includes(val) === false) {
      setSettings({ ...settings, serviceAreas: [...areas, val] });
    }
    setAreaInput('');
  };

  // Capture current GPS for a key
  const captureGps = async (key: string, label: string) => {
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        if (!navigator.geolocation) return rej(new Error('No geolocation'));
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 });
      });
      const lat = +pos.coords.latitude.toFixed(6);
      const lng = +pos.coords.longitude.toFixed(6);
      updateLoc(key, { lat, lng, mapUrl: `https://www.google.com/maps?q=${lat},${lng}` });
      toast.success(`📍 Location saved for ${label}`);
    } catch (e: any) {
      toast.error('GPS unavailable: ' + (e?.message || 'denied'));
    }
  };

  const editMapUrl = (key: string, label: string) => {
    const current = locs[key]?.mapUrl || '';
    const v = window.prompt(`Paste a map link or embed code for ${label}:`, current);
    if (v === null) return;
    const raw = v.trim();
    if (!raw) { clearLoc(key); return; }
    // Strip iframe wrapper if pasted
    const srcMatch = raw.match(/src=["']([^"']+)["']/i);
    const url = srcMatch ? srcMatch[1] : raw;
    const patch: any = { mapUrl: url };
    // try extract lat/lng from URL
    const m = url.match(/[?&@\/]([+-]?\d+\.\d+)[,%2C\s]+([+-]?\d+\.\d+)/);
    if (m) { patch.lat = parseFloat(m[1]); patch.lng = parseFloat(m[2]); }
    updateLoc(key, patch);
    toast.success('Map link saved');
  };

  const MapPreview = ({ mapUrl, lat, lng }: { mapUrl?: string; lat?: number; lng?: number }) => {
    const embed = toEmbedUrl(mapUrl, lat, lng);
    if (!embed) return null;
    return (
      <div className="mt-2 rounded-lg overflow-hidden border bg-white">
        <iframe
          src={embed}
          width="100%"
          height="260"
          style={{ border: 0, display: 'block' }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Map"
        />
      </div>
    );
  };

  return (
    <div className="bg-card border rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0 text-xl">🚚</div>
        <div>
          <h3 className="text-sm font-extrabold">Delivery Service Areas</h3>
          <p className="text-[11px] text-muted-foreground">
            Type a city — suggestions appear automatically. Then select the city and add its areas. You can save a GPS / map link with each city or area, and preview it with the 🗺️ button.
          </p>
        </div>
      </div>

      {/* ===== Cities ===== */}
      <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
        <div className="text-xs font-extrabold text-primary">🏙️ Service Cities</div>
        <div className="flex gap-2">
          <input
            list="svc-city-suggest"
            type="text"
            value={cityInput}
            onChange={e => setCityInput(e.target.value)}
            placeholder="e.g. Burewala, Jhang, Lahore…"
            className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCity(); } }}
          />
          <datalist id="svc-city-suggest">
            {allCities.map(c => <option key={c} value={c} />)}
          </datalist>
          <Button size="sm" onClick={addCity}>➕ Add</Button>
        </div>

        {cities.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No cities added.</div>
        ) : (
          <div className="space-y-1.5">
            {cities.map(c => {
              const key = c;
              const loc = locs[key];
              const hasLoc = !!(loc?.lat && loc?.lng) || !!loc?.mapUrl;
              const isPreview = previewKey === key;
              return (
                <div key={c} className="bg-card border rounded-md px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-primary flex-1">🏙️ {c}</span>
                    {loc?.lat && loc?.lng ? (
                      <a href={loc.mapUrl || `https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 underline truncate max-w-[160px]">
                        📍 {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </a>
                    ) : loc?.mapUrl ? (
                      <a href={loc.mapUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 underline truncate max-w-[160px]">📍 Map link</a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">no location</span>
                    )}
                    {hasLoc && (
                      <Button size="sm" variant="ghost" className={`h-7 px-2 text-[10px] ${isPreview ? 'text-primary bg-primary/10' : ''}`} onClick={() => setPreviewKey(isPreview ? null : key)} title="Map preview">
                        🗺️ {isPreview ? 'Hide' : 'View'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => captureGps(key, c)} title="Use my current GPS">📡 GPS</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => editMapUrl(key, c)} title="Paste Google Maps URL / embed code">🔗 Link</Button>
                    <button
                      onClick={() => {
                        setSettings({ ...settings, serviceCities: cities.filter(x => x !== c) });
                        clearLoc(key);
                        if (previewKey === key) setPreviewKey(null);
                      }}
                      className="text-destructive font-bold px-1.5"
                      title="Remove"
                    >×</button>
                  </div>
                  {isPreview && <MapPreview mapUrl={loc?.mapUrl} lat={loc?.lat} lng={loc?.lng} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Areas ===== */}
      <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
        <div className="text-xs font-extrabold text-primary">📍 Service Areas / Neighborhoods</div>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2">
          <select
            value={areaCity}
            onChange={e => { setAreaCity(e.target.value); setAreaInput(''); }}
            className="px-2 py-2 rounded-md border border-border bg-background text-sm"
          >
            <option value="">— Select city —</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <input
            list={areaCity ? `svc-area-suggest-${areaCity}` : undefined}
            type="text"
            value={areaInput}
            onChange={e => setAreaInput(e.target.value)}
            placeholder={areaCity ? `${areaCity} ka area, e.g. Model Town` : 'Select a city first'}
            disabled={!areaCity}
            className="px-3 py-2 rounded-md border border-border bg-background text-sm disabled:opacity-60"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } }}
          />
          {areaCity && (
            <datalist id={`svc-area-suggest-${areaCity}`}>
              {(cityToAreas[areaCity.toLowerCase()] || []).map(a => <option key={a} value={a} />)}
            </datalist>
          )}
          <Button size="sm" onClick={addArea} disabled={!areaCity}>➕ Add</Button>
        </div>

        {areas.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No areas added.</div>
        ) : (
          <div className="space-y-1.5">
            {areas.map(a => {
              // pick best matching key: if any key starts with `${city}::${a}` use it; else plain a
              const matchKey = Object.keys(locs).find(k => k.endsWith(`::${a}`)) || a;
              const loc = locs[matchKey];
              const hasLoc = !!(loc?.lat && loc?.lng) || !!loc?.mapUrl;
              const isPreview = previewKey === matchKey;
              return (
                <div key={a} className="bg-card border rounded-md px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1">📍 {a}</span>
                    {loc?.lat && loc?.lng ? (
                      <a href={loc.mapUrl || `https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 underline truncate max-w-[160px]">
                        📍 {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </a>
                    ) : loc?.mapUrl ? (
                      <a href={loc.mapUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 underline truncate max-w-[160px]">📍 Map link</a>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">no location</span>
                    )}
                    {hasLoc && (
                      <Button size="sm" variant="ghost" className={`h-7 px-2 text-[10px] ${isPreview ? 'text-primary bg-primary/10' : ''}`} onClick={() => setPreviewKey(isPreview ? null : matchKey)} title="Map preview">
                        🗺️ {isPreview ? 'Hide' : 'View'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => captureGps(areaCity ? `${areaCity}::${a}` : a, a)} title="Use my current GPS">📡 GPS</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => editMapUrl(areaCity ? `${areaCity}::${a}` : a, a)} title="Paste Google Maps URL / embed code">🔗 Link</Button>
                    <button
                      onClick={() => {
                        setSettings({ ...settings, serviceAreas: areas.filter(x => x !== a) });
                        // remove any location keys for this area
                        const next = { ...(settings.serviceLocations || {}) };
                        Object.keys(next).forEach(k => { if (k === a || k.endsWith(`::${a}`)) delete next[k]; });
                        setSettings({ ...settings, serviceAreas: areas.filter(x => x !== a), serviceLocations: next });
                        if (previewKey === matchKey) setPreviewKey(null);
                      }}
                      className="text-destructive font-bold px-1.5"
                      title="Remove"
                    >×</button>
                  </div>
                  {isPreview && <MapPreview mapUrl={loc?.mapUrl} lat={loc?.lat} lng={loc?.lng} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground bg-muted/40 p-2 rounded">
        <b>{cities.length} cities</b> · <b>{areas.length} areas</b> · <b>{Object.keys(locs).length} with location</b> — delivery form & online order me dikheinge.
      </div>

      <Button onClick={onSave} className="w-full">💾 Save Service Areas</Button>
    </div>
  );
}
