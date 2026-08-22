import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPaymentAccounts, findCustomerByPhone, getSettings } from '@/lib/store';
import { PaymentAccount, PaymentMethod, PaymentEntry, CartItem } from '@/lib/types';
import { splitEqual, splitByItems, sharesToPayments, type SplitShare } from '@/lib/splitBill';
import { featureActive } from '@/lib/optionalModules';
import { Banknote, Landmark, Wallet, Smartphone, CreditCard, Sparkles, SplitSquareHorizontal } from 'lucide-react';

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

  const btnLabel = isPartial
    ? `⏳ Partial Pay · ${money(totalReceived)} (Due ${money(remainingAfter)})`
    : `✓ Confirm Payment${redeemValue > 0 ? ` · ${money(netDue)}` : ''}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[92dvh] overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>💳 {remainingMode ? 'Receive Remaining Payment' : 'Payment Receive'}</DialogTitle>
        </DialogHeader>

        <div className="bg-primary/10 rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">{remainingMode ? 'BALANCE DUE' : 'AMOUNT DUE'}</p>
          <p className={`text-3xl font-extrabold ${redeemValue > 0 ? 'text-status-success' : 'text-primary'}`}>
            PKR {netDue.toLocaleString()}
          </p>
          {redeemValue > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
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
                  🏆 {customerName || 'Customer'} ke paas {availablePoints} loyalty points
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
          <button
            onClick={() => setMode('cash')}
            className={`p-2.5 rounded-lg border-2 font-bold flex flex-col items-center gap-1 transition-all ${
              mode === 'cash' ? 'bg-status-success/15 border-status-success text-status-success' : 'bg-card border-border hover:bg-accent'
            }`}
          >
            <Banknote className="h-5 w-5" />
            <span className="text-[11px]">💵 Cash</span>
          </button>
          <button
            onClick={() => setMode('online')}
            disabled={onlineAccts.length === 0}
            className={`p-2.5 rounded-lg border-2 font-bold flex flex-col items-center gap-1 transition-all ${
              mode === 'online' ? 'bg-status-info/15 border-status-info text-status-info' : 'bg-card border-border hover:bg-accent'
            } ${onlineAccts.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Landmark className="h-5 w-5" />
            <span className="text-[11px]">🏦 Online</span>
          </button>
          <button
            onClick={() => setMode('split')}
            disabled={onlineAccts.length === 0}
            className={`p-2.5 rounded-lg border-2 font-bold flex flex-col items-center gap-1 transition-all ${
              mode === 'split' ? 'bg-amber-500/15 border-amber-500 text-amber-700' : 'bg-card border-border hover:bg-accent'
            } ${onlineAccts.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <SplitSquareHorizontal className="h-5 w-5" />
            <span className="text-[11px]">🔀 Split</span>
          </button>
        </div>

        {/* v1.6.1 — restaurant-defined payment types (Settings → Payment Types) */}
        {customTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {customTypes.map(t => (
              <button
                key={t}
                onClick={() => { setMode('custom'); setCustomType(t); }}
                className={`px-3 py-1.5 rounded-lg border-2 text-[11px] font-bold transition-all ${
                  mode === 'custom' && customType === t
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-card border-border hover:bg-accent'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* v1.15.0 — quick CASH TENDER buttons.
            The client asked for one-tap amounts on the payment screen.
            These are tender amounts (what the customer handed over), not
            discounts — tapping 100 fills "cash received" with 100 so change
            is calculated instantly. Exact = the bill total, which is by far
            the most common case at a counter. */}
        {mode === 'cash' && (() => {
          const presets = [50, 100, 200, 500, 1000].filter(v => v >= netDue);
          const shown = presets.slice(0, 4);
          return (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCashReceived(String(netDue))}
                className="px-3 h-8 rounded-lg border-2 border-primary bg-primary/10 text-primary text-xs font-extrabold"
              >Exact {money(netDue)}</button>
              {shown.map(v => (
                <button
                  key={v}
                  onClick={() => setCashReceived(String(v))}
                  className="px-3 h-8 rounded-lg border text-xs font-extrabold hover:bg-accent"
                >{money(v)}</button>
              ))}
            </div>
          );
        })()}

        {mode === 'cash' && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground">Cash Received (partial allowed)</label>
            <Input
              type="number"
              inputMode="decimal"
              value={cashReceived}
              onChange={e => setCashReceived(e.target.value)}
              className="h-12 text-lg font-extrabold text-center"
              autoFocus
            />
            <div className="grid grid-cols-4 gap-1">
              {[netDue, 500, 1000, 2000, 5000, 10000].map(v => (
                <button
                  key={v}
                  onClick={() => setCashReceived(String(v))}
                  className="h-8 text-[11px] font-bold bg-muted hover:bg-accent rounded-md"
                >{money(v)}</button>
              ))}
            </div>
            {/* v1.3.3 — Numeric keypad. Client feedback: up/down arrows par
                clicking digits was very slow. On touch terminals this is
                faster, and it takes its colour from the theme. */}
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
                  className="dt-keypad-btn h-11 rounded-lg text-base font-extrabold flex items-center justify-center"
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
              CLEAR
            </button>
            {cashReceivedNum > netDue && (
              <div className="text-center text-sm font-bold text-status-success">
                Change: {money((cashReceivedNum - netDue))}
              </div>
            )}
            {cashReceivedNum > 0 && cashReceivedNum < netDue && (
              <div className="text-center text-sm font-bold text-amber-600">
                ⏳ Partial — {money((netDue - cashReceivedNum))} pending
              </div>
            )}
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
                { v: 'equal', label: '➗ Equal' },
                { v: 'items', label: '🍽️ By Items' },
                { v: 'amounts', label: '✍️ Amounts' },
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
                <span className="font-bold text-muted-foreground">Kitne hisse?</span>
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
                    <option value="cash">💵 Cash</option>
                    <option value="card">💳 Card</option>
                    {onlineAccts.map(a => (
                      <option key={a.id} value={`online:${a.id}`}>🏦 {a.name}</option>
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
                ⏳ {money(remainingAfter)} pending — the bill stays in Slips
              </div>
            )}
          </div>
        )}

        <Button
          className={`w-full h-12 text-base font-extrabold ${isPartial ? 'bg-amber-500 hover:bg-amber-600' : 'bg-status-success hover:bg-status-success/90'}`}
          onClick={confirm}
          disabled={confirmDisabled}
        >
          {btnLabel}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
