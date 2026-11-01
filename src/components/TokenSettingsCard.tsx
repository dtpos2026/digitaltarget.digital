// ============================================================
// PRINTING CENTER — Tandoor Token + No-Receipt-on-Pay card.
// These are the same settings found under Settings→KOT tab, but
// they're kept here too since the Printing Center is the user's home base.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { getSettings, saveSettings, getCategories } from '@/lib/store';
import { LANGUAGES, getLanguage, setLanguage, type LanguageCode } from '@/lib/i18n';
import { resolveTokenRules } from '@/lib/tokenRules';
import { TOKEN_TEMPLATES } from '@/lib/tokenSlip';
import { Link } from '@/lib/hash-router';
import { Button } from '@/components/ui/button';

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function TokenSettingsCard() {
  const [s, setS] = useState<any>(() => getSettings());
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [newPayType, setNewPayType] = useState('');

  useEffect(() => { try { setCats(getCategories() as any); } catch {} }, []);

  const save = (patch: any) => {
    const next = { ...getSettings(), ...patch };
    saveSettings(next as any);
    setS(next);
    toast.success('Saved');
  };

  const addPayType = () => {
    const t = newPayType.trim();
    if (!t) return;
    const list = ((s.customPaymentTypes as string[]) || []);
    if (list.some(x => x.toLowerCase() === t.toLowerCase())) { toast.error('This type already exists'); return; }
    save({ customPaymentTypes: [...list, t] });
    setNewPayType('');
  };

  const tokenOn = !!s.tokenPrintEnabled;
  // Categories AND individually-selected items both count towards "configured".
  const tokenRules = resolveTokenRules(s);
  const tokenRuleSummary = tokenRules.hasRules
    ? `${tokenRules.categoryIds.size} categor${tokenRules.categoryIds.size === 1 ? 'y' : 'ies'} · ${tokenRules.menuItemIds.size} individual item${tokenRules.menuItemIds.size === 1 ? '' : 's'} selected`
    : 'Nothing selected yet';
  const countsOn = s.tokenCountsInSales !== false;
  const noReceipt = !!s.noReceiptOnPay;
  const diningReceipt = s.diningReceiptOnPay !== false;
  const billOnHold = s.printBillOnHold !== false;
  const kotOn = s.kotEnabled !== false;
  const manualKot = !!s.manualSendToKitchen;
  const kotStrict = s.kotFallbackToReceipt === false; // ON = KOT sirf kitchen printer pe

  const PRESETS: Record<string, { label: string; patch: any }> = {
    restaurant:   { label: 'Restaurant',        patch: { kotEnabled: true,  tokenPrintEnabled: false, noReceiptOnPay: false, manualSendToKitchen: false } },
    hotel:        { label: 'Hotel + Tandoor',   patch: { kotEnabled: true,  tokenPrintEnabled: true,  noReceiptOnPay: false, manualSendToKitchen: false } },
    fastfood:     { label: 'Fast Food',         patch: { kotEnabled: true,  tokenPrintEnabled: false, noReceiptOnPay: false, manualSendToKitchen: false } },
    pizza:        { label: 'Pizza Shop',        patch: { kotEnabled: true,  tokenPrintEnabled: false, noReceiptOnPay: false, manualSendToKitchen: false } },
    cafe:         { label: 'Cafe',              patch: { kotEnabled: true,  tokenPrintEnabled: false, noReceiptOnPay: false, manualSendToKitchen: true  } },
    nashta:       { label: 'Nashta Point',      patch: { kotEnabled: false, tokenPrintEnabled: false, noReceiptOnPay: false } },
    shawarma:     { label: 'Shawarma / Sajji',  patch: { kotEnabled: false, tokenPrintEnabled: false, noReceiptOnPay: false } },
    khokha:       { label: 'Khokha / Stall',    patch: { kotEnabled: false, tokenPrintEnabled: false, noReceiptOnPay: true  } },
    minimart:     { label: 'Minimart / Grocery', patch: { kotEnabled: false, tokenPrintEnabled: false, noReceiptOnPay: false, minimartMode: true } },
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-bold">🫓 Tandoor Token &amp; Receipt Options</h3>
        <p className="text-xs text-muted-foreground">What gets printed at the time of payment — control it right here</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">🌐 Language / زبان</p>
          <p className="text-[11px] text-muted-foreground">Language of POS buttons and labels</p>
        </div>
        <select
          className="border rounded-md px-2 py-1.5 text-xs bg-background"
          defaultValue={getLanguage()}
          onChange={(e) => { setLanguage(e.target.value as LanguageCode); toast.success('Language changed'); }}
        >
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
        </select>
      </div>

      {/* ===== KOT FONT SIZE (client: "KOT font cannot enlarge, must be variable") ===== */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">🔠 KOT Font Size</p>
            <p className="text-[11px] text-muted-foreground">Kitchen slip font — increase it for easier reading from a distance in the kitchen</p>
          </div>
          <span className="text-sm font-black tabular-nums px-2 py-1 rounded bg-muted">{Number(s.kotFontScale) || 100}%</span>
        </div>
        <input
          type="range" min={80} max={220} step={10}
          value={Number(s.kotFontScale) || 100}
          onChange={(e) => save({ kotFontScale: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex gap-1.5">
          {[100, 120, 140, 160, 200].map(v => (
            <button key={v} onClick={() => save({ kotFontScale: v })}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${(Number(s.kotFontScale) || 100) === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/50 border-transparent'}`}>
              {v}%
            </button>
          ))}
        </div>
      </div>

      {/* ===== CUSTOM PAYMENT TYPES (NETS / PayNow / GrabPay …) ===== */}
      <div className="border-t pt-3 space-y-2">
        <div>
          <p className="text-xs font-semibold">💳 Custom Payment Types</p>
          <p className="text-[11px] text-muted-foreground">Built-in: Cash, Online, Split. Add new ones here — they will appear on the payment screen, receipt, and reports.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(((s.customPaymentTypes as string[]) || []).length === 0) && (
            <span className="text-[11px] text-muted-foreground italic">No custom type</span>
          )}
          {((s.customPaymentTypes as string[]) || []).map((t: string) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs font-bold">
              {t}
              <button
                className="text-destructive font-black"
                onClick={() => save({ customPaymentTypes: ((s.customPaymentTypes as string[]) || []).filter((x: string) => x !== t) })}
              >×</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 border rounded-md px-2 py-1.5 text-xs bg-background"
            placeholder="New type (e.g. NETS, PayNow, GrabPay)"
            value={newPayType}
            onChange={(e) => setNewPayType(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPayType(); }}
          />
          <button className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold" onClick={addPayType}>Add</button>
        </div>
      </div>

      {/* ===== MINIMART / RETAIL MODE ===== */}
      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer border-t pt-3">
        <div>
          <span className="text-xs font-semibold block">🛒 Minimart / Retail Mode</span>
          <span className="text-[11px] text-muted-foreground">Barcode scanning + weight scale (sabzi/phal)</span>
        </div>
        <Toggle on={!!s.minimartMode} onClick={() => save({ minimartMode: !s.minimartMode })} />
      </label>

      {!!s.minimartMode && (
        <div className="space-y-2 pl-1 border-l-2 border-primary/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">Weight-embedded barcode</p>
              <p className="text-[11px] text-muted-foreground">Weight or price is embedded in the scale label</p>
            </div>
            <select className="border rounded-md px-2 py-1.5 text-xs bg-background max-w-[160px]"
              value={s.embeddedBarcodeMode || 'weight'}
              onChange={(e) => save({ embeddedBarcodeMode: e.target.value })}>
              <option value="weight">Weight (prefix 20–29)</option>
              <option value="price">Price (prefix 20–29)</option>
              <option value="off">Off — normal barcodes</option>
            </select>
          </div>
          {/* The serial weighing-scale card (COM port, live weight) is not part of the cloud build. */}
          <p className="text-[11px] text-muted-foreground">💡 Set each item's <b>barcode</b> and <b>PLU</b> in the Menu Manager.</p>
        </div>
      )}

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">Tandoor Token</span>
          <span className="text-[11px] text-muted-foreground">A separate token slip for roti / naan, printed on payment</span>
        </div>
        <Toggle on={tokenOn} onClick={() => save({ tokenPrintEnabled: !tokenOn })} />
      </label>

      {tokenOn && (
        <div className="space-y-3 pl-1">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-xs font-semibold">Token Categories &amp; Items</p>
            <p className="text-[11px] text-muted-foreground">
              Choose as many categories as you need, plus individual items, in
              <b> Token Printing — Rules &amp; Design</b> just below.
            </p>
            <p className="mt-1 text-[11px] font-semibold">
              {tokenRuleSummary}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">Token Template (design)</p>
              <p className="text-[11px] text-muted-foreground">Slip style — preview below</p>
            </div>
            <select
              className="border rounded-md px-2 py-1.5 text-xs bg-background max-w-[180px]"
              value={s.tokenTemplate || 'standard'}
              onChange={(e) => save({ tokenTemplate: e.target.value })}
            >
              {TOKEN_TEMPLATES.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
            <div>
              <span className="text-xs font-semibold block">Token pe "Total pieces" dikhayein</span>
              <span className="text-[11px] text-muted-foreground">OFF = only item and qty (e.g. "Naan 8") — staff won't double count</span>
            </div>
            <Toggle on={s.tokenShowTotal !== false} onClick={() => save({ tokenShowTotal: s.tokenShowTotal === false })} />
          </label>
          {!tokenRules.hasRules && (
            <p className="text-[11px] text-amber-600 font-semibold">⚠️ Token will NOT print until a category or item is selected</p>
          )}
          <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
            <div>
              <span className="text-xs font-semibold block">Count token items in sales</span>
              <span className="text-[11px] text-muted-foreground">OFF = token only, not included in report sales</span>
            </div>
            <Toggle on={countsOn} onClick={() => save({ tokenCountsInSales: !countsOn })} />
          </label>
          <p className="text-[11px] text-muted-foreground">
            💡 Which printer the token goes to: set a printer's role to <b>"Tandoor Token Printer"</b> in the printer list below
            (otherwise it will go to the Kitchen printer).
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <div>
          <p className="text-xs font-semibold">Business Type (presets)</p>
          <p className="text-[11px] text-muted-foreground">Select the business type — modules will be set automatically</p>
        </div>
        <select
          className="border rounded-md px-2 py-1.5 text-xs bg-background max-w-[170px]"
          value={s.businessType || ''}
          onChange={(e) => {
            const k = e.target.value;
            if (!k) return;
            save({ businessType: k, ...PRESETS[k].patch });
          }}
        >
          <option value="">— select —</option>
          {Object.entries(PRESETS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">Enable KOT Printing</span>
          <span className="text-[11px] text-muted-foreground">OFF = no KOT will be printed (both auto/manual disabled)</span>
        </div>
        <Toggle on={kotOn} onClick={() => save({ kotEnabled: !kotOn })} />
      </label>

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">Manual "Send Kitchen" only</span>
          <span className="text-[11px] text-muted-foreground">ON = KOT only when the button is pressed, never automatically</span>
        </div>
        <Toggle on={manualKot} onClick={() => save({ manualSendToKitchen: !manualKot })} />
      </label>

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">KOT on the kitchen printer only</span>
          <span className="text-[11px] text-muted-foreground">ON = if no kitchen printer is set, KOT will NOT fall back to the cash counter — an error will show</span>
        </div>
        <Toggle on={kotStrict} onClick={() => save({ kotFallbackToReceipt: kotStrict ? undefined : false })} />
      </label>

      {tokenOn && (
        <Button asChild size="sm" variant="secondary" className="w-full">
          <Link to="/token-module">🫓 Token Module kholen (register / milaan)</Link>
        </Button>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Receipt Status Label</p>
          <p className="text-[11px] text-muted-foreground">What prints as "PAID/UNPAID" on the receipt</p>
        </div>
        <select
          className="border rounded-md px-2 py-1.5 text-xs bg-background"
          value={s.receiptStatusMode || 'smart'}
          onChange={(e) => save({ receiptStatusMode: e.target.value })}
        >
          <option value="smart">Smart (auto — status ke mutabiq)</option>
          <option value="always-paid">Hamesha "PAID"</option>
          <option value="always-unpaid">Hamesha "UNPAID"</option>
          <option value="none">Kuch na likhein</option>
        </select>
      </div>

      <div className="border-t pt-3 space-y-2">
        <p className="text-xs font-semibold">Receipt Label — per Order Type</p>
        <p className="text-[11px] text-muted-foreground">Each type has its own rule (empty = use the global rule above)</p>
        {([['dining','Dine-In'],['takeaway','Takeaway'],['delivery','Delivery'],['foodpanda','Online / Drive']] as [string,string][]).map(([k,lbl]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <span className="text-[11px]">{lbl}</span>
            <select
              className="border rounded-md px-2 py-1 text-[11px] bg-background max-w-[160px]"
              value={(s.receiptModeByType || {})[k] || ''}
              onChange={(e) => save({ receiptModeByType: { ...(s.receiptModeByType || {}), [k]: e.target.value || undefined } })}
            >
              <option value="">— global —</option>
              <option value="smart">Smart (auto)</option>
              <option value="always-paid">Hamesha PAID</option>
              <option value="always-unpaid">Hamesha UNPAID</option>
              <option value="none">Kuch na likhein</option>
            </select>
          </div>
        ))}
      </div>

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">No Receipt on Pay</span>
          <span className="text-[11px] text-muted-foreground">ON = no customer receipt on payment (Reprint buttons still work)</span>
        </div>
        <Toggle on={noReceipt} onClick={() => save({ noReceiptOnPay: !noReceipt })} />
      </label>

      <label className={`flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer ${noReceipt ? 'opacity-60' : ''}`}>
        <div>
          <span className="text-xs font-semibold block">Print Receipt Automatically on Dining Payment</span>
          <span className="text-[11px] text-muted-foreground">
            {noReceipt
              ? 'No Receipt on Pay is ON, so no order type prints a receipt on payment.'
              : diningReceipt
                ? 'ON = paying a dining bill marks it PAID and prints the paid receipt.'
                : 'OFF = paying a dining bill marks it PAID without printing or opening a print dialog. Reprint it later from Retrieve or Bill Reprint.'}
          </span>
        </div>
        <Toggle on={diningReceipt} onClick={() => save({ diningReceiptOnPay: !diningReceipt })} />
      </label>

      <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
        <div>
          <span className="text-xs font-semibold block">Print Bill on Hold</span>
          <span className="text-[11px] text-muted-foreground">
            {billOnHold
              ? 'ON = putting a bill on Hold prints the customer bill marked ON HOLD (UNPAID). Items that never reached the kitchen get their KOT too.'
              : 'OFF = Hold prints only the KOT for items that never reached the kitchen.'}
          </span>
        </div>
        <Toggle on={billOnHold} onClick={() => save({ printBillOnHold: !billOnHold })} />
      </label>
    </Card>
  );
}
