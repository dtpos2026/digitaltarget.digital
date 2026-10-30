import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { money } from '@/lib/currency';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPaymentAccounts, findCustomerByPhone, getSettings } from '@/lib/store';
import { PaymentAccount, PaymentMethod, PaymentEntry, CartItem } from '@/lib/types';
import { splitEqual, splitByItems, sharesToPayments, type SplitShare } from '@/lib/splitBill';
import { featureActive } from '@/lib/optionalModules';
import { Banknote, Landmark, Wallet, Smartphone, CreditCard, Sparkles, SplitSquareHorizontal, type LucideIcon } from 'lucide-react';

interface Result {
  /** Primary method (first payment) for legacy fields. */
  method: PaymentMethod;
  accountId?: string;
  accountName?: string;
  cashReceived?: number;
  /** Full breakdown — single, split, or partial. */
  payments: Omit<PaymentEntry, 'id' | 'at' | 'by'>[];
  totalReceived: number;
  loyaltyPointsUsed?: number;
  loyaltyRedeemValue?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  onConfirm: (r: Result) => void;
  customerPhone?: string;
  /** When set, dialog title says "Receive Remaining Payment" and disables loyalty redeem. */
  remainingMode?: boolean;
  /** v1.6.1: order lines — enables "Split by Items". Optional (older callers). */
  items?: CartItem[];
}

const ICONS: Record<string, any> = {
  bank: Landmark, jazzcash: Smartphone, easypaisa: Smartphone,
  wallet: Wallet, cash: Banknote, other: CreditCard,
};

type Mode = 'cash' | 'online' | 'split' | 'custom';

function MethodTile({ active, disabled, onClick, icon: Icon, label }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: LucideIcon; label: string;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`h-[4.5rem] rounded-xl border-2 flex flex-col items-center justify-center gap-1 px-1 text-xs font-bold transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground hover:bg-accent'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <Icon className="h-5 w-5" />
      <span className="truncate max-w-full">{label}</span>
    </button>
  );
}

export default function PaymentDialog({ open, onClose, grandTotal, onConfirm, customerPhone, remainingMode, items }: Props) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [mode, setMode] = useState<Mode>('cash');
  const [customType, setCustomType] = useState<string>('');
  const [accountId, setAccountId] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  // Split-mode amounts
  // v1.6.1 SPLIT BILL (feedback #2 item 4) — equal / by items / by amounts.
  // methodKey encoding: 'cash' | 'card' | 'online:<accountId>' | '<CustomName>'
  type ShareRow = { amount: string; methodKey: string };
  const [splitTab, setSplitTab] = useState<'equal' | 'items' | 'amounts'>('amounts');
  const [shares, setShares] = useState<ShareRow[]>([{ amount: '', methodKey: 'cash' }, { amount: '', methodKey: 'cash' }]);
  const [equalN, setEqualN] = useState(2);
  const [itemAssign, setItemAssign] = useState<Record<string, number>>({});
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [availablePoints, setAvailablePoints] = useState(0);
  const [redeemRate, setRedeemRate] = useState(1);
  const [minRedeem, setMinRedeem] = useState(100);
  const [loyaltyOn, setLoyaltyOn] = useState(false);

  useEffect(() => {
    if (open) {
      const accs = getPaymentAccounts().filter(a => a.isActive !== false);
      setAccounts(accs);
      setMode('cash');
      setAccountId('');
      setSplitTab('amounts');
      setShares([{ amount: '', methodKey: 'cash' }, { amount: '', methodKey: 'cash' }]);
      setEqualN(2);
      setItemAssign({});
      const s = getSettings();
      const on = !!s?.loyaltyEnabled && !remainingMode;
      setLoyaltyOn(on);
      const rate = Number(s?.loyaltyRedeemRate) > 0 ? Number(s.loyaltyRedeemRate) : 1;
      const minR = Number(s?.loyaltyMinRedeemPoints) > 0 ? Number(s.loyaltyMinRedeemPoints) : 100;
      setRedeemRate(rate);
      setMinRedeem(minR);
      let pts = 0; let nm = '';
      if (on && customerPhone) {
        const c = findCustomerByPhone(customerPhone);
        if (c) { pts = c.loyaltyPoints || 0; nm = c.name || ''; }
      }
      setAvailablePoints(pts);
      setCustomerName(nm);
      setRedeemPoints(0);
      setCashReceived(String(grandTotal));
    }
  }, [open, grandTotal, customerPhone, remainingMode]);

  const onlineAccts = useMemo(() => accounts.filter(a => a.type !== 'cash'), [accounts]);
  const customTypes: string[] = useMemo(() => {
    const st = getSettings();
    if (!featureActive(st, 'customPaymentTypesEnabled')) return [];
    return (st.customPaymentTypes || []).filter(Boolean);
  }, [open]);
  const redeemValue = Math.round(redeemPoints * redeemRate);
  const netDue = Math.max(0, grandTotal - redeemValue);
  const canRedeem = loyaltyOn && availablePoints >= minRedeem;

  const shareAmounts = shares.map(r => parseFloat(r.amount) || 0);
  const splitTotal = Math.round(shareAmounts.reduce((a, b) => a + b, 0) * 100) / 100;
  const parseMethodKey = (key: string): { method: string; accountId?: string; accountName?: string } => {
    if (key.startsWith('online:')) {
      const acc = accounts.find(a => a.id === key.slice(7));
      return { method: 'online', accountId: acc?.id, accountName: acc?.name };
    }
    return { method: key || 'cash' };
  };
  const shareMethodInvalid = shares.some(
    (r, i) => shareAmounts[i] > 0 && r.methodKey.startsWith('online:') && !parseMethodKey(r.methodKey).accountId,
  );
  const applyEqual = (n: number) => {
    const parts = splitEqual(netDue, n);
    setShares(prev => parts.map((amt, i) => ({
      amount: String(amt),
      methodKey: prev[i]?.methodKey || 'cash',
    })));
  };
  const applyItems = (assign: Record<string, number>, n: number) => {
    const parts = splitByItems(items || [], assign, netDue);
    const padded = [...parts];
    while (padded.length < n) padded.push(0);
    setShares(prev => padded.map((amt, i) => ({
      amount: String(Math.round(amt * 100) / 100),
      methodKey: prev[i]?.methodKey || 'cash',
    })));
  };

  const cashReceivedNum = parseFloat(cashReceived) || 0;

  // Total received depending on mode
  const totalReceived = mode === 'cash' ? Math.min(cashReceivedNum, netDue) || cashReceivedNum
                     : mode === 'online' ? netDue
                     : splitTotal;
  const remainingAfter = Math.max(0, netDue - totalReceived);
  const isPartial = totalReceived > 0 && totalReceived < netDue;

  const applyMaxRedeem = () => {
    const maxByTotal = Math.floor(grandTotal / Math.max(0.0001, redeemRate));
    const max = Math.min(availablePoints, maxByTotal);
    setRedeemPoints(max);
    setCashReceived(String(Math.max(0, grandTotal - Math.round(max * redeemRate))));
  };
  const clearRedeem = () => { setRedeemPoints(0); setCashReceived(String(grandTotal)); };

  const confirm = () => {
    const loyaltyExtras = redeemPoints > 0
      ? { loyaltyPointsUsed: redeemPoints, loyaltyRedeemValue: redeemValue }
      : {};
    const payments: Omit<PaymentEntry, 'id' | 'at' | 'by'>[] = [];

    if (mode === 'cash') {
      const amt = Math.min(cashReceivedNum, netDue); // change is NOT a payment
      if (amt <= 0) return;
      payments.push({ method: 'cash', amount: amt });
      const total = amt;
      onConfirm({
        method: 'cash',
        cashReceived: cashReceivedNum,
        payments,
        totalReceived: total,
        ...loyaltyExtras,
      });
    } else if (mode === 'online') {
      const acc = accounts.find(a => a.id === accountId);
      if (!acc) return;
      payments.push({ method: 'online', accountId: acc.id, accountName: acc.name, amount: netDue });
      onConfirm({
        method: 'online',
        accountId: acc.id,
        accountName: acc.name,
        payments,
        totalReceived: netDue,
        ...loyaltyExtras,
      });
    } else if (mode === 'custom') {
      // v1.6.1 custom type: full amount by that method (like card/online one-tap)
      if (!customType) return;
      payments.push({ method: customType, amount: netDue });
      onConfirm({
        method: customType,
        payments,
        totalReceived: netDue,
        ...loyaltyExtras,
      });
    } else {
      // v1.6.1 split — shares (equal / items / amounts) → payment entries
      if (splitTotal <= 0 || shareMethodInvalid) return;
      const splitShares: SplitShare[] = shares
        .map((r, i) => {
          const parsed = parseMethodKey(r.methodKey);
          return {
            index: i + 1,
            amount: shareAmounts[i],
            method: parsed.method,
            accountId: parsed.accountId,
            accountName: parsed.accountName,
          };
        })
        .filter(x => x.amount > 0);
      const { payments: sp, primaryMethod } = sharesToPayments(splitShares);
      if (sp.length === 0) return;
      for (const e of sp) payments.push(e as any);
      const cashPart = sp.filter(x => x.method === 'cash').reduce((a, b) => a + b.amount, 0);
      const firstAcc = sp.find(x => x.accountId);
      onConfirm({
        method: primaryMethod,
        accountId: firstAcc?.accountId,
        accountName: firstAcc?.accountName,
        cashReceived: cashPart || undefined,
        payments,
        totalReceived: Math.min(splitTotal, netDue),
        ...loyaltyExtras,
      });
    }
  };

  const confirmDisabled =
    (mode === 'custom' && !customType) ||
    (mode === 'online' && !accountId) ||
    (mode === 'split' && splitTotal <= 0) ||
    (mode === 'split' && splitTotal > netDue + 0.01) ||
    (mode === 'split' && shareMethodInvalid) ||
    (mode === 'cash' && cashReceivedNum <= 0) ||
    (redeemPoints > 0 && redeemPoints < minRedeem);

  const doneLabel = remainingMode ? 'Receive Payment' : 'Complete Sale';
  const btnLabel = isPartial
    ? `Partial payment · ${money(totalReceived)} (due ${money(remainingAfter)})`
    : `${doneLabel}${redeemValue > 0 ? ` · ${money(netDue)}` : ''}`;

  // What the cash screen shows beside the amount: change owed, and what is still due.
  const changeAmt = cashReceivedNum > netDue ? cashReceivedNum - netDue : 0;
  const dueAmt = cashReceivedNum > 0 && cashReceivedNum < netDue ? netDue - cashReceivedNum : 0;

  // One-tap tender amounts: the next banknotes that cover the bill, plus the usual large notes.
  const quickCash = useMemo(() => {
    const covering = [50, 100, 200, 500, 1000].filter(v => v >= netDue).slice(0, 4);
    return Array.from(new Set([...covering, 500, 1000, 2000, 5000, 10000]))
      .filter(v => v !== netDue).sort((a, b) => a - b).slice(0, 6);
  }, [netDue]);

  // Enter completes the sale — but never from a button (it would also fire that
  // button), and never twice for one press.
  const submitted = useRef(false);
  useEffect(() => { if (open) submitted.current = false; }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (confirmDisabled || submitted.current) return;
    e.preventDefault();
    submitted.current = true;
    setTimeout(() => { submitted.current = false; }, 800);
    confirm();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        onKeyDown={onKeyDown}
        className="sm:max-w-3xl max-h-[94dvh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <div className="px-6 pt-5 pb-4 flex items-center gap-3 pr-14 shrink-0">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Wallet className="h-5 w-5" />
          </div>
          <DialogTitle className="text-lg font-extrabold">{remainingMode ? 'Receive Remaining Payment' : 'Payment'}</DialogTitle>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-5 grid gap-5 md:grid-cols-2 md:items-start">
          <div className="space-y-4 min-w-0">
            <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground px-5 py-5 text-center shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider opacity-90">{remainingMode ? 'Balance due' : 'Total payable'}</p>
              <p className="text-4xl font-black tabular-nums leading-tight mt-1">{money(netDue)}</p>
              {redeemValue > 0 && (
                <p className="text-[11px] mt-1 opacity-90">
                  Original {money(grandTotal)} − Loyalty {money(redeemValue)}
                </p>
              )}
            </div>

            {canRedeem && (
              <div className="rounded-lg border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  <div className="flex-1 text-xs">
                    <div className="font-extrabold text-amber-800 dark:text-amber-200">
                      {customerName || 'Customer'} has {availablePoints} loyalty points
                    </div>
                    <div className="text-[10px] text-amber-700 dark:text-amber-300">
                      Rate: 1 pt = {money(redeemRate)} · Min redeem: {minRedeem} pts
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5 items-center">
                  <Input
                    type="number"
                    placeholder="Points to use"
                    value={redeemPoints || ''}
                    onChange={e => {
                      const v = Math.max(0, Math.min(availablePoints, parseInt(e.target.value) || 0));
                      setRedeemPoints(v);
                      setCashReceived(String(Math.max(0, grandTotal - Math.round(v * redeemRate))));
                    }}
                    className="h-9 text-sm font-bold"
                  />
                  <Button size="sm" variant="outline" onClick={applyMaxRedeem} className="h-9 text-xs font-bold whitespace-nowrap">Max</Button>
                  {redeemPoints > 0 && (
                    <Button size="sm" variant="ghost" onClick={clearRedeem} className="h-9 text-xs">✕</Button>
                  )}
                </div>
                {redeemPoints > 0 && redeemPoints < minRedeem && (
                  <p className="text-[10px] text-status-warning font-bold">Min {minRedeem} pts required</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <MethodTile active={mode === 'cash'} onClick={() => setMode('cash')} icon={Banknote} label="Cash" />
              <MethodTile active={mode === 'online'} disabled={onlineAccts.length === 0} onClick={() => setMode('online')} icon={Landmark} label="Online" />
              <MethodTile active={mode === 'split'} disabled={onlineAccts.length === 0} onClick={() => setMode('split')} icon={SplitSquareHorizontal} label="Split" />
              {/* v1.6.1 — restaurant-defined payment types (Settings → Payment Types) */}
              {customTypes.map(tp => (
                <MethodTile
                  key={tp}
                  active={mode === 'custom' && customType === tp}
                  onClick={() => { setMode('custom'); setCustomType(tp); }}
                  icon={CreditCard}
                  label={tp}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            {mode === 'cash' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="pay-received" className="text-xs font-bold text-muted-foreground">
                    Amount received <span className="font-medium">(partial allowed)</span>
                  </label>
                  <Input
                    id="pay-received"
                    type="number"
                    inputMode="decimal"
                    value={cashReceived}
                    onChange={e => setCashReceived(e.target.value)}
                    className="mt-1 h-14 text-2xl font-extrabold border-2 border-primary/60 focus-visible:ring-primary/30"
                    autoFocus
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCashReceived(String(netDue))}
                    className="px-3 h-9 rounded-lg bg-primary/10 text-primary text-sm font-extrabold"
                  >Exact</button>
                  {quickCash.map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setCashReceived(String(v))}
                      className="px-3 h-9 rounded-lg border bg-card text-sm font-bold hover:bg-accent transition-colors"
                    >{money(v)}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-card px-3 py-2">
                    <div className="text-[11px] font-semibold text-muted-foreground">Change</div>
                    <div className="text-xl font-black text-status-success tabular-nums">{money(changeAmt)}</div>
                  </div>
                  <div className="rounded-xl border bg-card px-3 py-2">
                    <div className="text-[11px] font-semibold text-muted-foreground">Due (credit)</div>
                    <div className={`text-xl font-black tabular-nums ${dueAmt > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>{money(dueAmt)}</div>
                  </div>
                </div>
                {/* v1.3.3 — numeric keypad for touch terminals; it takes its colour from the theme. */}
                <div className="grid grid-cols-3 gap-1.5">
                  {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setCashReceived(prev => {
                        if (k === '⌫') return prev.slice(0, -1);
                        if (k === '.' && prev.includes('.')) return prev;
                        if (k !== '.' && prev === '0') return k;
                        return prev + k;
                      })}
                      className="h-11 rounded-lg border bg-card text-base font-extrabold flex items-center justify-center shadow-sm hover:bg-accent active:scale-[0.97] transition"
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setCashReceived('')}
                  className="w-full h-9 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-extrabold hover:bg-destructive/20 transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
            {mode === 'online' && (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {onlineAccts.length === 0 ? (
                  <div className="text-xs text-center text-muted-foreground py-6">
                    No payment accounts added. Add them under Settings → Accounts → Payment Accounts.
                  </div>
                ) : onlineAccts.map(a => {
                  const Icon = ICONS[a.type] || CreditCard;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAccountId(a.id)}
                      className={`w-full p-3 rounded-lg border-2 flex items-center gap-3 transition-all text-left ${
                        accountId === a.id ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:bg-accent'
                      }`}
                    >
                      <Icon className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-extrabold truncate">{a.name}</div>
                        {a.accountNumber && <div className="text-[11px] text-muted-foreground truncate">{a.accountNumber}</div>}
                      </div>
                      <span className="text-[10px] uppercase font-bold bg-muted px-2 py-0.5 rounded">{a.type}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {mode === 'split' && (
              <div className="space-y-3">
                {/* v1.6.1 — Equal / By Items / By Amounts */}
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { v: 'equal', label: 'Equal' },
                    { v: 'items', label: 'By items' },
                    { v: 'amounts', label: 'Amounts' },
                  ] as const).map(t => (
                    <button
                      key={t.v}
                      onClick={() => {
                        setSplitTab(t.v);
                        if (t.v === 'equal') applyEqual(equalN);
                        if (t.v === 'items') applyItems(itemAssign, equalN);
                      }}
                      className={`h-8 rounded-lg border text-[11px] font-bold transition-colors ${
                        splitTab === t.v ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {(splitTab === 'equal' || splitTab === 'items') && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-muted-foreground">Number of shares:</span>
                    {[2, 3, 4, 5, 6].map(n => (
                      <button
                        key={n}
                        onClick={() => {
                          setEqualN(n);
                          if (splitTab === 'equal') applyEqual(n);
                          else applyItems(itemAssign, n);
                        }}
                        className={`h-8 w-8 rounded-lg border font-extrabold ${
                          equalN === n ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}

                {splitTab === 'items' && (
                  (items && items.length > 0) ? (
                    <div className="space-y-1 max-h-36 overflow-auto rounded-md border p-2">
                      <p className="text-[10px] text-muted-foreground mb-1">
                        Press a number on each item to say which share it belongs to:
                      </p>
                      {items.map(it => {
                        const cur = Math.min(equalN - 1, itemAssign[it.id] ?? 0);
                        return (
                          <div key={it.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate flex-1">{it.name} × {it.quantity}</span>
                            <span className="font-mono text-muted-foreground">{money(it.lineTotal)}</span>
                            <button
                              onClick={() => {
                                const next = { ...itemAssign, [it.id]: (cur + 1) % equalN };
                                setItemAssign(next);
                                applyItems(next, equalN);
                              }}
                              className="h-7 w-14 rounded-md border border-primary/40 bg-primary/10 text-primary font-extrabold"
                            >
                              #{cur + 1}
                            </button>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-muted-foreground pt-1">
                        Service charge and tax are divided across the shares in proportion.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-600">
                      The items for this bill are not available here — use "Equal" or "Amounts" instead.
                    </p>
                  )
                )}

                {/* Shares editor — common to all three tabs */}
                <div className="space-y-1.5">
                  {shares.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-muted-foreground w-12">Share {i + 1}</span>
                      <Input
                        type="number"
                        value={r.amount}
                        readOnly={splitTab !== 'amounts'}
                        onChange={e => setShares(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                        placeholder="0"
                        className={`h-9 text-sm font-bold text-center flex-1 ${splitTab !== 'amounts' ? 'bg-muted/50' : ''}`}
                      />
                      <select
                        value={r.methodKey}
                        onChange={e => setShares(prev => prev.map((x, j) => j === i ? { ...x, methodKey: e.target.value } : x))}
                        className="h-9 text-xs rounded-md border border-input bg-background px-1.5 w-28"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        {onlineAccts.map(a => (
                          <option key={a.id} value={`online:${a.id}`}>{a.name}</option>
                        ))}
                        {customTypes.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      {splitTab === 'amounts' && shares.length > 2 && (
                        <button
                          onClick={() => setShares(prev => prev.filter((_, j) => j !== i))}
                          className="text-destructive font-bold px-1"
                          aria-label="Remove share"
                        >×</button>
                      )}
                    </div>
                  ))}
                  {splitTab === 'amounts' && shares.length < 8 && (
                    <button
                      onClick={() => setShares(prev => [...prev, { amount: '', methodKey: 'cash' }])}
                      className="text-[11px] text-primary font-bold underline"
                    >+ Add another share</button>
                  )}
                </div>

                <div className="rounded-md bg-muted p-2 text-xs flex justify-between font-bold">
                  <span>Total received:</span>
                  <span className={splitTotal > netDue + 0.01 ? 'text-destructive' : isPartial ? 'text-amber-600' : 'text-status-success'}>
                    {money(splitTotal)} / {money(netDue)}
                  </span>
                </div>
                {splitTotal > netDue + 0.01 && (
                  <div className="text-center text-xs font-bold text-destructive">
                    Rs.{(splitTotal - netDue).toFixed(2)} over — reduce the amounts
                  </div>
                )}
                {isPartial && (
                  <div className="text-center text-xs font-bold text-amber-600">
                    {money(remainingAfter)} pending — the bill stays in Slips
                  </div>
                )}
              </div>
            )}
            {mode === 'custom' && (
              <div className="rounded-xl border bg-card px-4 py-3 text-sm">
                <div className="font-extrabold">{customType}</div>
                <div className="text-muted-foreground mt-0.5">The full amount, {money(netDue)}, is recorded against this payment type.</div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t bg-card px-6 py-4 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <Button variant="outline" className="h-12 sm:px-6 font-bold" onClick={onClose}>
            {remainingMode ? 'Cancel' : 'Back to cart'}
          </Button>
          <Button
            className={`h-12 sm:px-8 text-base font-extrabold gap-2 ${isPartial ? 'bg-amber-500 hover:bg-amber-600 text-amber-950' : 'bg-status-success hover:bg-status-success/90 text-status-success-foreground'}`}
            onClick={confirm}
            disabled={confirmDisabled}
          >
            {btnLabel}
            <kbd className="text-[10px] font-bold rounded border border-current/40 px-1.5 py-0.5 opacity-80">Enter</kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
