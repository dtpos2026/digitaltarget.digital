// Super Admin → Client A-to-Z billing dialog
// Shows: restaurant info, plan, expiry editor, generate invoice, record payment, history, print
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Receipt, CreditCard, Calendar, Printer, Trash2, Plus, CheckCircle2, AlertTriangle, Clock,
  MessageCircle, Phone,
} from 'lucide-react';
import {
  Invoice, Payment, fetchInvoices, fetchPayments, createInvoice, deleteInvoice, updateInvoice,
  recordPayment, deletePayment, setPlanExpiry, tsToDate, daysUntil, isExpired, formatRs, planPriceFor,
} from '@/lib/billing';
import { PLAN_OPTIONS, getPlan } from '@/lib/plans';
import { AdminPackage, fetchPackages } from '@/lib/packages';
import { AdminPlan, fetchAdminPlans } from '@/lib/adminPlans';
import { MarketingContact, fetchContacts } from '@/lib/marketingContacts';
import InvoicePreviewDialog from '@/components/InvoicePreviewDialog';
import SupportInboxDialog from '@/components/SupportInboxDialog';
import { fetchTenantPhone, waLink } from '@/lib/support';

interface Props {
  tenantId: string;
  restaurantName: string;
  email?: string;
  planId: string;
  planExpiryAt?: any;
  onClose: () => void;
  onSaved?: () => void;
}

export default function ClientBillingDialog({
  tenantId, restaurantName, email, planId, planExpiryAt, onClose, onSaved,
}: Props) {
  const [tab, setTab] = useState<'overview' | 'invoices' | 'payments'>('overview');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvForm, setShowInvForm] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [showPayForm, setShowPayForm] = useState<Invoice | null | 'standalone'>(null);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [phone, setPhone] = useState('');
  useEffect(() => { fetchTenantPhone(tenantId).then(setPhone); }, [tenantId]);

  // Map invoiceId -> total paid (for partial-payment display)
  const paidByInvoice = useMemo(() => {
    const m: Record<string, number> = {};
    payments.forEach(p => { if (p.invoiceId) m[p.invoiceId] = (m[p.invoiceId] || 0) + (p.amount || 0); });
    return m;
  }, [payments]);

  const expDate = tsToDate(planExpiryAt);
  const expDays = daysUntil(planExpiryAt);
  const expired = isExpired(planExpiryAt);

  const load = async () => {
    setLoading(true);
    try {
      const [inv, pay] = await Promise.all([fetchInvoices(tenantId), fetchPayments(tenantId)]);
      setInvoices(inv);
      setPayments(pay);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const totalBilled = useMemo(() => invoices.reduce((s, i) => s + (i.total || 0), 0), [invoices]);
  const totalPaid = useMemo(() => payments.reduce((s, p) => s + (p.amount || 0), 0), [payments]);
  const outstanding = Math.max(0, totalBilled - totalPaid);

  const updateExpiry = async (date: Date | null) => {
    try {
      await setPlanExpiry(tenantId, date);
      toast.success(date ? `Expiry set: ${date.toLocaleDateString()}` : 'Expiry removed');
      onSaved?.();
    } catch (e: any) { toast.error(e?.message); }
  };

  const openPreview = (inv: Invoice) => setPreviewInvoice(inv);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-violet-600" />
            Client Account — {restaurantName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{email} · uid: {tenantId.slice(0, 16)}…</p>
        </DialogHeader>

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatBox label="Current Plan" value={getPlan(planId).name} tone="violet" />
          <StatBox label="Plan Expiry" value={expDate ? expDate.toLocaleDateString() : '—'}
            tone={expired ? 'red' : (expDays !== null && expDays <= 7 ? 'amber' : 'green')}
            sub={expDate ? (expired ? `Expired ${Math.abs(expDays || 0)}d ago` : `${expDays}d remaining`) : 'Not set'} />
          <StatBox label="Total Billed" value={formatRs(totalBilled)} tone="primary" />
          <StatBox label="Outstanding" value={formatRs(outstanding)} tone={outstanding > 0 ? 'red' : 'green'}
            sub={`Paid: ${formatRs(totalPaid)}`} />
        </div>

        {/* Expiry quick controls */}
        <div className="bg-muted/40 border rounded-lg p-3 space-y-2">
          <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Plan Expiry Controls
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              type="date"
              value={expDate ? expDate.toISOString().slice(0, 10) : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const d = new Date(v + 'T23:59:59');
                updateExpiry(d);
              }}
              className="h-8 w-44 text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => updateExpiry(addDaysFromNow(30))}>+30 days</Button>
            <Button size="sm" variant="outline" onClick={() => updateExpiry(addDaysFromNow(90))}>+90 days</Button>
            <Button size="sm" variant="outline" onClick={() => updateExpiry(addDaysFromNow(365))}>+1 year</Button>
            {expDate && (
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => updateExpiry(null)}>
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Reminders / Contact */}
        <div className="bg-muted/40 border rounded-lg p-3 space-y-2">
          <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> Reminders & Contact
            {phone ? <span className="ml-1 text-green-600">· {phone}</span> : <span className="ml-1 text-red-500">· No phone in Settings</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowChat(true)}
              className="border-violet-500/40 text-violet-700 hover:bg-violet-500/10">
              <MessageCircle className="h-4 w-4 mr-1" /> In-App Message
            </Button>
            {phone ? (
              <>
                <a target="_blank" rel="noreferrer"
                  href={waLink(phone, buildUnpaidMsg(restaurantName, outstanding, expDate, expDays, expired))}>
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                    <Phone className="h-4 w-4 mr-1" /> WhatsApp Unpaid Reminder
                  </Button>
                </a>
                <a target="_blank" rel="noreferrer"
                  href={waLink(phone, buildPaidMsg(restaurantName, totalPaid, expDate))}>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                    <Phone className="h-4 w-4 mr-1" /> WhatsApp Paid Receipt
                  </Button>
                </a>
                <a target="_blank" rel="noreferrer"
                  href={waLink(phone, buildExpiryMsg(restaurantName, expDate, expDays, expired))}>
                  <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10">
                    <Phone className="h-4 w-4 mr-1" /> WhatsApp Expiry Notice
                  </Button>
                </a>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">Ask the owner to set phone1 in Settings.</span>
            )}
          </div>
        </div>



        {/* Tabs */}
        <div className="inline-flex p-1 bg-muted/60 rounded-lg border">
          {(['overview', 'invoices', 'payments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-bold uppercase rounded-md ${tab === t ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              {t}
            </button>
          ))}
        </div>

        {loading ? <div className="text-center text-muted-foreground text-sm py-8">Loading…</div> : (
          <>
            {tab === 'overview' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setShowInvForm(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
                    <Plus className="h-4 w-4 mr-1" /> New Invoice
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowPayForm('standalone')}>
                    <CreditCard className="h-4 w-4 mr-1" /> Record Payment
                  </Button>
                </div>
                <RecentList title="Recent Invoices" items={invoices.slice(0, 5).map(i => ({
                  k: i.id,
                  left: i.number,
                  mid: `${i.months}mo · ${getPlan(i.planId).name}`,
                  right: formatRs(i.total),
                  status: i.status,
                  date: tsToDate(i.issuedAt),
                }))} />
                <RecentList title="Recent Payments" items={payments.slice(0, 5).map(p => ({
                  k: p.id,
                  left: p.invoiceNumber || 'Direct',
                  mid: `${p.method} · ${p.months}mo`,
                  right: formatRs(p.amount),
                  status: 'paid',
                  date: tsToDate(p.paidAt),
                }))} />
              </div>
            )}

            {tab === 'invoices' && (
              <div className="space-y-2">
                <Button size="sm" onClick={() => setShowInvForm(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
                  <Plus className="h-4 w-4 mr-1" /> Generate Invoice
                </Button>
                {invoices.length === 0 && <EmptyState msg="No invoices yet" />}
                {invoices.map(inv => {
                  const paid = paidByInvoice[inv.id] || 0;
                  const remaining = Math.max(0, (inv.total || 0) - paid);
                  const isPartial = paid > 0 && remaining > 0;
                  const isFullyPaid = inv.total > 0 && paid >= inv.total;
                  return (
                  <div key={inv.id} className="border rounded-lg p-3 bg-card flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                        {inv.number}
                        <StatusBadge status={isFullyPaid ? 'paid' : (isPartial ? 'partial' : inv.status)} />
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {tsToDate(inv.issuedAt)?.toLocaleDateString()} · {getPlan(inv.planId).name} · {inv.months} month(s)
                      </div>
                      {(paid > 0 || isPartial) && (
                        <div className="text-[11px] mt-0.5">
                          <span className="text-green-700 font-bold">Paid: {formatRs(paid)}</span>
                          {remaining > 0 && <span className="text-red-600 font-bold ml-2">Remaining: {formatRs(remaining)}</span>}
                        </div>
                      )}
                      {inv.notes && <div className="text-[11px] italic text-muted-foreground mt-1">{inv.notes}</div>}
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-base">{formatRs(inv.total)}</div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => openPreview(inv)} title="Print / Preview">
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditInvoice(inv)} title="Edit invoice"
                        className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10">
                        ✎ Edit
                      </Button>
                      {!isFullyPaid && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setShowPayForm(inv)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {isPartial ? 'Add Payment' : 'Mark Paid'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-red-600"
                        onClick={async () => {
                          if (!confirm(`Delete invoice ${inv.number}? Linked payments may be affected too.`)) return;
                          await deleteInvoice(tenantId, inv.id); load();
                        }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}

            {tab === 'payments' && (
              <div className="space-y-2">
                <Button size="sm" onClick={() => setShowPayForm('standalone')}>
                  <Plus className="h-4 w-4 mr-1" /> Record Payment
                </Button>
                {payments.length === 0 && <EmptyState msg="No payments yet" />}
                {payments.map(p => (
                  <div key={p.id} className="border rounded-lg p-3 bg-card flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm">{formatRs(p.amount)} <span className="text-[10px] uppercase text-muted-foreground">via {p.method}</span></div>
                      <div className="text-[11px] text-muted-foreground">
                        {tsToDate(p.paidAt)?.toLocaleString()} · {p.months}mo {p.invoiceNumber ? `· ${p.invoiceNumber}` : ''}
                      </div>
                      {p.notes && <div className="text-[11px] italic">{p.notes}</div>}
                    </div>
                    <Button size="sm" variant="ghost" className="text-red-600"
                      title="Delete payment (to correct the ledger)"
                      onClick={async () => {
                        if (!confirm(`Delete the payment of ${formatRs(p.amount)}? It will be removed from the ledger and the linked invoice will be recalculated.`)) return;
                        try {
                          await deletePayment(tenantId, p.id, { invoiceId: p.invoiceId });
                          toast.success('Payment deleted');
                          load();
                        } catch (e: any) { toast.error(e?.message || 'Failed to delete'); }
                      }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {showInvForm && (
          <InvoiceForm
            tenantId={tenantId}
            defaultPlanId={planId}
            clientPhone={phone}
            onClose={() => setShowInvForm(false)}
            onSaved={() => { setShowInvForm(false); load(); onSaved?.(); }}
          />
        )}
        {showPayForm && (
          <PaymentForm
            tenantId={tenantId}
            invoice={showPayForm === 'standalone' ? null : showPayForm}
            defaultPlanId={planId}
            currentExpiry={planExpiryAt}
            remainingHint={
              showPayForm !== 'standalone' && showPayForm
                ? Math.max(0, (showPayForm.total || 0) - (paidByInvoice[showPayForm.id] || 0))
                : undefined
            }
            onClose={() => setShowPayForm(null)}
            onSaved={() => { setShowPayForm(null); load(); onSaved?.(); }}
          />
        )}
        {editInvoice && (
          <InvoiceEditForm
            tenantId={tenantId}
            invoice={editInvoice}
            onClose={() => setEditInvoice(null)}
            onSaved={() => { setEditInvoice(null); load(); onSaved?.(); }}
          />
        )}
        {previewInvoice && (
          <InvoicePreviewDialog
            invoice={previewInvoice}
            restaurantName={restaurantName}
            email={email}
            tenantId={tenantId}
            onClose={() => setPreviewInvoice(null)}
          />
        )}
        {showChat && (
          <SupportInboxDialog
            tenantId={tenantId}
            restaurantName={restaurantName}
            onClose={() => setShowChat(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function addDaysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d;
}

function buildUnpaidMsg(name: string, outstanding: number, exp: Date | null, days: number | null, expired: boolean): string {
  const dueLine = expired
    ? `⚠️ Your subscription expired ${Math.abs(days || 0)} days ago.`
    : exp ? `Plan expiry: ${exp.toLocaleDateString()} (${days} din baqi)` : '';
  return `Dear ${name},

This is a DT POS billing reminder (Digital Target):

💰 Outstanding Dues: ${formatRs(outstanding)}
${dueLine}

Please settle your payment soon so your POS keeps running.

Payment methods:
• JazzCash / EasyPaisa: 0345-1873354
• Bank transfer: reply for details

Shukriya,
Digital Target — DT POS Team`;
}

function buildPaidMsg(name: string, paid: number, exp: Date | null): string {
  return `Dear ${name},

✅ Thank you! We have received your payment.

Total Paid: ${formatRs(paid)}
${exp ? `New plan expiry: ${exp.toLocaleDateString()}` : ''}

Your subscription is active. Let us know if you have any problems.

Regards,
Digital Target — DT POS Team`;
}

function buildExpiryMsg(name: string, exp: Date | null, days: number | null, expired: boolean): string {
  if (expired) {
    return `Dear ${name},

⚠️ IMPORTANT: your DT POS subscription ${Math.abs(days || 0)} days ago. The POS may now be blocked.

Please foran renew karwa lein.

Contact: 0345-1873354
Digital Target Team`;
  }
  return `Dear ${name},

Reminder: your DT POS subscription ${exp ? exp.toLocaleDateString() : ''} expires on (${days} days remaining).

To renew, contact us: 0345-1873354

Digital Target Team`;
}


function StatBox({ label, value, tone, sub }: { label: string; value: string; tone: 'violet'|'green'|'red'|'amber'|'primary'; sub?: string }) {
  const tones: any = {
    violet: 'text-violet-600 bg-violet-500/10 border-violet-500/20',
    green: 'text-green-600 bg-green-500/10 border-green-500/20',
    red: 'text-red-600 bg-red-500/10 border-red-500/20',
    amber: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
    primary: 'text-primary bg-primary/10 border-primary/20',
  };
  return (
    <div className={`border rounded-lg p-2.5 ${tones[tone]}`}>
      <div className="text-[10px] uppercase font-bold tracking-wider opacity-80">{label}</div>
      <div className="text-base font-extrabold leading-tight mt-0.5 truncate">{value}</div>
      {sub && <div className="text-[10px] opacity-75 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: any = {
    paid: 'bg-green-500/15 text-green-700 border-green-500/30',
    partial: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    sent: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
    draft: 'bg-gray-500/15 text-gray-700 border-gray-500/30',
    overdue: 'bg-red-500/15 text-red-700 border-red-500/30',
    cancelled: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
  };
  return <span className={`text-[9px] uppercase font-bold border px-1.5 py-0.5 rounded ${cls[status] || cls.draft}`}>{status}</span>;
}

function EmptyState({ msg }: { msg: string }) {
  return <div className="text-xs text-muted-foreground italic py-6 text-center bg-muted/30 rounded-lg border border-dashed">{msg}</div>;
}

function RecentList({ title, items }: { title: string; items: { k: string; left: string; mid: string; right: string; status: string; date: Date | null }[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">{title}</div>
      {items.length === 0 ? <EmptyState msg="—" /> : (
        <div className="space-y-1">
          {items.map(it => (
            <div key={it.k} className="flex items-center justify-between text-xs border rounded px-2 py-1.5 bg-card">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold">{it.left}</span>
                <span className="text-muted-foreground truncate">{it.mid}</span>
                <StatusBadge status={it.status} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted-foreground">{it.date?.toLocaleDateString()}</span>
                <span className="font-extrabold">{it.right}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Invoice form -----
function InvoiceForm({ tenantId, defaultPlanId, clientPhone: initialPhone = '', onClose, onSaved }: { tenantId: string; defaultPlanId: string; clientPhone?: string; onClose: () => void; onSaved: () => void }) {
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [packageId, setPackageId] = useState<string>('');
  const [adminPlans, setAdminPlans] = useState<AdminPlan[]>([]);
  const [adminPlanId, setAdminPlanId] = useState<string>('');
  const [planId, setPlan] = useState(defaultPlanId);
  const [months, setMonths] = useState(1);
  const [setupFee, setSetupFee] = useState(0);
  const [monthlyFee, setMonthlyFee] = useState(getPlan(defaultPlanId).monthlyPriceRs);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Marketing contacts (owner picker)
  const [contacts, setContacts] = useState<MarketingContact[]>([]);
  const [contactId, setContactId] = useState<string>('');

  // Client snapshot + period
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [clientPhone, setClientPhone] = useState(initialPhone);
  const [clientAddress, setClientAddress] = useState('');
  const [approvedDevices, setApprovedDevices] = useState<number>(0);
  const [ownerName, setOwnerName] = useState('');
  const [contactName, setContactName] = useState('');

  const amount = (setupFee || 0) + (monthlyFee || 0) * (months || 0);
  const total = Math.max(0, amount - discount);
  const selectedPkg = packages.find(p => p.id === packageId);
  const selectedContact = contacts.find(c => c.id === contactId);

  // Auto end date = start + months
  const endDate = useMemo(() => {
    if (!startDate) return '';
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + (months || 0));
    return d.toISOString().slice(0, 10);
  }, [startDate, months]);

  useEffect(() => { fetchPackages().then(ps => setPackages(ps.filter(p => p.active))).catch(() => {}); }, []);
  useEffect(() => { fetchAdminPlans().then(ps => setAdminPlans(ps.filter(p => p.active))).catch(() => {}); }, []);
  useEffect(() => {
    fetchContacts().then(cs => {
      setContacts(cs);
      // Auto-pick the contact linked to this tenant
      const linked = cs.find(c => c.linkedTenantId === tenantId);
      if (linked) {
        setContactId(linked.id);
        setOwnerName(linked.ownerName || linked.name || '');
        setContactName(linked.name || '');
        if (linked.phone && !initialPhone) setClientPhone(linked.phone);
        if (linked.address) setClientAddress(linked.address);
      }
    }).catch(() => {});
  }, [tenantId, initialPhone]);

  // When user changes contact dropdown
  const applyContact = (cid: string) => {
    setContactId(cid);
    const c = contacts.find(x => x.id === cid);
    if (!c) { setOwnerName(''); setContactName(''); return; }
    setOwnerName(c.ownerName || c.name || '');
    setContactName(c.name || '');
    if (c.phone) setClientPhone(c.phone);
    if (c.address) setClientAddress(c.address);
  };

  // Load approved device count + tenant address from Firestore
  useEffect(() => {
    (async () => {
      try {
        const { fbDb } = await import('@/lib/firebase');
        const { collection, getDocs, doc, getDoc } = await import('firebase/firestore');
        const devSnap = await getDocs(collection(fbDb(), 'tenants', tenantId, 'devices'));
        let approved = 0;
        devSnap.forEach(d => { const v = d.data() as any; if (v.approved && !v.blocked) approved++; });
        setApprovedDevices(approved);
        const settings = await getDoc(doc(fbDb(), 'tenants', tenantId, 'meta', 'settings'));
        const s = settings.data() as any;
        if (s?.address && !clientAddress) setClientAddress(s.address);
        if (!initialPhone && s?.phone1) setClientPhone(s.phone1);
      } catch { /* ignore */ }
    })();
  }, [tenantId, initialPhone]);

  // When plan changes via dropdown (no package selected), refresh monthly default
  useEffect(() => {
    if (!packageId) setMonthlyFee(getPlan(planId).monthlyPriceRs);
  }, [planId, packageId]);

  const applyPackage = (pid: string) => {
    setPackageId(pid);
    if (!pid) return;
    const p = packages.find(x => x.id === pid);
    if (!p) return;
    setSetupFee(p.setupFeeRs);
    setMonthlyFee(p.monthlyRs);
    setMonths(p.durationMonths);
    if (!notes) setNotes(p.description || p.name);
  };

  const applyAdminPlan = (pid: string) => {
    setAdminPlanId(pid);
    if (!pid) return;
    const p = adminPlans.find(x => x.id === pid);
    if (!p) return;
    setMonthlyFee(p.monthlyRs || 0);
    if (p.maxDevices && p.maxDevices > 0) setApprovedDevices(p.maxDevices);
    setNotes(`${p.name} Plan${p.maxDevices ? ` (${p.maxDevices} devices allowed)` : ''}`);
    toast.success(`${p.name} plan applied`);
  };


  const save = async () => {
    if (!contactId) { toast.error('You must select a client (owner)'); return; }
    setSaving(true);
    try {
      await createInvoice(tenantId, {
        planId, months, amount, discount, notes,
        packageId: selectedPkg?.id,
        packageName: selectedPkg?.name,
        setupFee, monthlyFee,
        includedFeatures: selectedPkg?.includedFeatures,
        periodStart: startDate,
        periodEnd: endDate,
        clientPhone, clientAddress, approvedDevices,
        contactId, ownerName, contactName,
      });
      toast.success('Invoice created');
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Generate Invoice</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Admin Plan suggest (click to apply) */}
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-2.5">
            <label className="text-[10px] uppercase font-bold text-indigo-700 flex items-center gap-1">
              <Receipt className="h-3 w-3" /> Suggested Plans (click to apply)
            </label>
            {adminPlans.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic mt-1">
                No plans — create them in Super Admin → Plans (Basic, Starter, Pro…).
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {adminPlans.map(p => {
                  const active = adminPlanId === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => applyAdminPlan(p.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-all text-left ${active ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-card border-indigo-500/30 text-indigo-700 hover:bg-indigo-500/10'}`}>
                      <div>{p.name}</div>
                      <div className={`text-[9px] font-normal ${active ? 'text-indigo-100' : 'text-muted-foreground'}`}>
                        {p.maxDevices ? `${p.maxDevices} dev` : 'Unlimited'} · Rs {(p.monthlyRs||0).toLocaleString()}/mo
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>


          {/* Package selector */}
          <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-2.5">
            <label className="text-[10px] uppercase font-bold text-violet-700 flex items-center gap-1">
              <Receipt className="h-3 w-3" /> Use Package (auto-fill)
            </label>
            <select
              value={packageId}
              onChange={e => applyPackage(e.target.value)}
              className="w-full h-9 border rounded px-2 text-sm bg-card mt-1"
            >
              <option value="">— Manual (no package) —</option>
              {packages.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} · Rs {p.setupFeeRs.toLocaleString()} + {p.monthlyRs.toLocaleString()}×{p.durationMonths} = Rs {((p.setupFeeRs)+(p.monthlyRs*p.durationMonths)).toLocaleString()}
                </option>
              ))}
            </select>
            {packages.length === 0 && (
              <div className="text-[10px] text-muted-foreground italic mt-1">
                No packages — create them in Super Admin → Packages.
              </div>
            )}
          </div>

          {/* Duration chips */}
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Duration (Months)</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {[1, 3, 5, 6, 12].map(n => (
                <button key={n} type="button" onClick={() => setMonths(n)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${months === n ? 'bg-violet-600 text-white border-violet-700' : 'bg-card border-violet-500/30 text-violet-700 hover:bg-violet-500/10'}`}>
                  {n} mo
                </button>
              ))}
              <Input type="number" min={1} value={months} onChange={e => setMonths(Math.max(1, parseInt(e.target.value) || 1))} className="h-7 w-20 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Setup (Rs)</label>
              <Input type="number" min={0} value={setupFee} onChange={e => setSetupFee(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Monthly (Rs)</label>
              <Input type="number" min={0} value={monthlyFee} onChange={e => setMonthlyFee(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          {/* Client (Owner) picker — MANDATORY */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 space-y-2">
            <label className="text-[10px] uppercase font-bold text-amber-700 flex items-center gap-1">
              <Receipt className="h-3 w-3" /> Client / Owner * (required for the invoice)
            </label>
            <select
              value={contactId}
              onChange={e => applyContact(e.target.value)}
              className="w-full h-9 border rounded px-2 text-sm bg-card"
            >
              <option value="">— Select client (owner) —</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>
                  {c.ownerName || c.name} · {c.restaurantName} {c.phone ? `· ${c.phone}` : ''}
                </option>
              ))}
            </select>
            {contacts.length === 0 && (
              <div className="text-[10px] text-muted-foreground italic">
                No marketing contacts — add them in Super Admin → Clients.
              </div>
            )}
            {selectedContact && (
              <div className="text-[11px] text-muted-foreground">
                <strong>Owner:</strong> {ownerName || '—'} · <strong>Restaurant:</strong> {selectedContact.restaurantName}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Owner Name (on invoice)</label>
                <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Restaurant owner" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Phone</label>
                <Input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="0300-1234567" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Approved Devices</label>
                <Input type="number" value={approvedDevices} onChange={e => setApprovedDevices(parseInt(e.target.value) || 0)} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Address</label>
                <Input value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Restaurant address" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Plan (for tracking)</label>
            <select value={planId} onChange={e => setPlan(e.target.value)} className="w-full h-9 border rounded px-2 text-sm bg-card">
              {PLAN_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.name} (Rs {p.monthlyPriceRs}/mo)</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Discount (Rs)</label>
              <Input type="number" value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Start Date</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">End Date (auto)</label>
              <Input type="date" value={endDate} readOnly className="bg-muted/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. December subscription" />
            </div>
          </div>


          <div className="bg-muted/40 rounded p-2.5 space-y-1 text-sm">
            <div className="flex justify-between text-xs"><span>Setup fee:</span><span>{formatRs(setupFee)}</span></div>
            <div className="flex justify-between text-xs"><span>{formatRs(monthlyFee)} × {months} mo:</span><span>{formatRs(monthlyFee * months)}</span></div>
            {discount > 0 && <div className="flex justify-between text-xs text-red-600"><span>Discount:</span><span>− {formatRs(discount)}</span></div>}
            <div className="flex justify-between items-center pt-1 border-t">
              <span className="font-bold">TOTAL:</span>
              <span className="text-lg font-extrabold text-violet-600">{formatRs(total)}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
              {saving ? 'Saving…' : 'Create Invoice'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----- Payment form -----
function PaymentForm({ tenantId, invoice, defaultPlanId, currentExpiry, remainingHint, onClose, onSaved }: {
  tenantId: string; invoice: Invoice | null; defaultPlanId: string; currentExpiry: any;
  remainingHint?: number;
  onClose: () => void; onSaved: () => void;
}) {
  const initialAmount = invoice
    ? (typeof remainingHint === 'number' && remainingHint > 0 ? remainingHint : (invoice.total || 0))
    : planPriceFor(defaultPlanId, 1);
  const [amount, setAmount] = useState(initialAmount);
  const [method, setMethod] = useState<Payment['method']>('cash');
  const [months, setMonths] = useState(invoice?.months || 1);
  const [notes, setNotes] = useState('');
  const [extend, setExtend] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await recordPayment(tenantId, {
        amount, method, months, invoice, notes,
        currentExpiry, extendExpiry: extend,
      });
      toast.success('Payment recorded');
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment {invoice ? `— ${invoice.number}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {invoice && typeof remainingHint === 'number' && (
            <div className="text-[11px] bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              <span className="font-bold">Invoice Total:</span> {formatRs(invoice.total)} ·{' '}
              <span className="font-bold text-red-600">Remaining: {formatRs(remainingHint)}</span>
              <div className="text-[10px] text-muted-foreground mt-0.5">For a partial payment, reduce the amount (e.g. Rs 10,000 only).</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Amount (Rs)</label>
              <Input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value as any)} className="w-full h-9 border rounded px-2 text-sm bg-card">
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="jazzcash">JazzCash</option>
                <option value="easypaisa">EasyPaisa</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Months to add to plan</label>
            <Input type="number" min={0} value={months} onChange={e => setMonths(parseInt(e.target.value) || 0)} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={extend} onChange={e => setExtend(e.target.checked)} />
            Extend plan expiry by {months} month(s)
          </label>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Receipt #, reference, etc." />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
              {saving ? 'Saving…' : 'Save Payment'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ----- Invoice Edit form (correct wrong receivings / amounts) -----
function InvoiceEditForm({ tenantId, invoice, onClose, onSaved }: {
  tenantId: string; invoice: Invoice; onClose: () => void; onSaved: () => void;
}) {
  const [months, setMonths] = useState(invoice.months || 1);
  const [setupFee, setSetupFee] = useState(invoice.setupFee || 0);
  const [monthlyFee, setMonthlyFee] = useState(invoice.monthlyFee || invoice.amount / Math.max(1, invoice.months || 1));
  const [discount, setDiscount] = useState(invoice.discount || 0);
  const [tax, setTax] = useState(invoice.tax || 0);
  const [notes, setNotes] = useState(invoice.notes || '');
  const [status, setStatus] = useState(invoice.status);
  const [saving, setSaving] = useState(false);

  const amount = (setupFee || 0) + (monthlyFee || 0) * (months || 0);
  const total = Math.max(0, amount - (discount || 0)) + (tax || 0);

  const save = async () => {
    setSaving(true);
    try {
      await updateInvoice(tenantId, invoice.id, {
        months, setupFee, monthlyFee, amount, discount, tax, total, notes, status,
      });
      toast.success('Invoice updated');
      onSaved();
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Invoice — {invoice.number}</DialogTitle>
          <p className="text-[11px] text-muted-foreground">Correct a wrong receiving entry or amount. The ledger updates automatically.</p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Months</label>
              <Input type="number" min={1} value={months} onChange={e => setMonths(Math.max(1, parseInt(e.target.value) || 1))} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as any)} className="w-full h-9 border rounded px-2 text-sm bg-card">
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Setup (Rs)</label>
              <Input type="number" min={0} value={setupFee} onChange={e => setSetupFee(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Monthly (Rs)</label>
              <Input type="number" min={0} value={monthlyFee} onChange={e => setMonthlyFee(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Discount (Rs)</label>
              <Input type="number" min={0} value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Tax (Rs)</label>
              <Input type="number" min={0} value={tax} onChange={e => setTax(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="bg-muted/40 rounded p-2.5 space-y-1 text-sm">
            <div className="flex justify-between text-xs"><span>Setup:</span><span>{formatRs(setupFee)}</span></div>
            <div className="flex justify-between text-xs"><span>{formatRs(monthlyFee)} × {months}:</span><span>{formatRs(monthlyFee * months)}</span></div>
            {discount > 0 && <div className="flex justify-between text-xs text-red-600"><span>Discount:</span><span>− {formatRs(discount)}</span></div>}
            {tax > 0 && <div className="flex justify-between text-xs"><span>Tax:</span><span>{formatRs(tax)}</span></div>}
            <div className="flex justify-between items-center pt-1 border-t">
              <span className="font-bold">NEW TOTAL:</span>
              <span className="text-lg font-extrabold text-violet-600">{formatRs(total)}</span>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? 'Saving…' : 'Update Invoice'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}



// ----- Printable invoice HTML -----
function invoicePrintHtml({ inv, restaurantName, email, tenantId, planName }: {
  inv: Invoice; restaurantName: string; email?: string; tenantId: string; planName: string;
}): string {
  const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
  const issued = tsToDate(inv.issuedAt)?.toLocaleDateString() || '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 24px auto; padding: 24px; color: #1a1a1a; }
  .hd { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #7c3aed; padding-bottom:16px; margin-bottom:24px; }
  .brand { font-size:24px; font-weight:900; color:#3c096c; letter-spacing:-.5px; }
  .sub { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:2px; margin-top:4px; }
  .inv-no { text-align:right; }
  .inv-no h1 { margin:0; font-size:28px; color:#7c3aed; letter-spacing:1px; }
  .inv-no .date { font-size:12px; color:#666; margin-top:4px; }
  .row { display:flex; justify-content:space-between; gap:24px; margin-bottom:24px; }
  .box { flex:1; }
  .box .lbl { font-size:10px; text-transform:uppercase; color:#888; font-weight:700; letter-spacing:1.5px; margin-bottom:4px; }
  .box .val { font-size:14px; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin-top:16px; }
  th { background:#3c096c; color:#fff; text-align:left; padding:10px 12px; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  td { padding:14px 12px; border-bottom:1px solid #eee; font-size:13px; }
  .totals { margin-top:16px; margin-left:auto; width:280px; }
  .totals .line { display:flex; justify-content:space-between; padding:6px 0; font-size:13px; }
  .totals .grand { border-top:2px solid #3c096c; margin-top:8px; padding-top:10px; font-weight:900; font-size:18px; color:#3c096c; }
  .ft { margin-top:48px; padding-top:16px; border-top:1px solid #ddd; font-size:11px; color:#666; text-align:center; }
  .ft .big { font-weight:700; color:#3c096c; font-size:13px; margin-bottom:4px; }
  .status { display:inline-block; padding:4px 12px; border-radius:4px; font-size:11px; font-weight:700; text-transform:uppercase; }
  .status.paid { background:#dcfce7; color:#15803d; }
  .status.sent { background:#dbeafe; color:#1d4ed8; }
  .status.overdue { background:#fee2e2; color:#b91c1c; }
</style></head><body>
<div class="hd">
  <div>
    <div class="brand">Digital Target</div>
    <div class="sub">DT POS · Restaurant Management System</div>
    <div style="font-size:11px;color:#666;margin-top:8px">Taimoor Younas · 0345-1873354</div>
  </div>
  <div class="inv-no">
    <h1>INVOICE</h1>
    <div class="date">${esc(inv.number)}</div>
    <div class="date">${esc(issued)}</div>
    <div style="margin-top:6px"><span class="status ${esc(inv.status)}">${esc(inv.status)}</span></div>
  </div>
</div>

<div class="row">
  <div class="box">
    <div class="lbl">Bill To</div>
    <div class="val">${esc(restaurantName)}</div>
    <div style="font-size:12px;color:#555">${esc(email || '')}</div>
    <div style="font-size:10px;color:#999;font-family:monospace">UID: ${esc(tenantId)}</div>
  </div>
  <div class="box" style="text-align:right">
    <div class="lbl">Subscription</div>
    <div class="val">${esc(planName)} Plan</div>
    <div style="font-size:12px;color:#555">${esc(inv.months)} month(s)</div>
  </div>
</div>

<table>
  <thead><tr><th>Description</th><th style="text-align:right">Months</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    <tr>
      <td><strong>${esc(planName)} Subscription</strong><br><span style="font-size:11px;color:#666">${esc(inv.notes || 'DT POS software subscription')}</span></td>
      <td style="text-align:right">${esc(inv.months)}</td>
      <td style="text-align:right">${formatRs(inv.amount)}</td>
    </tr>
  </tbody>
</table>

<div class="totals">
  <div class="line"><span>Subtotal:</span><span>${formatRs(inv.amount)}</span></div>
  ${inv.discount ? `<div class="line"><span>Discount:</span><span>− ${formatRs(inv.discount)}</span></div>` : ''}
  ${inv.tax ? `<div class="line"><span>Tax:</span><span>${formatRs(inv.tax)}</span></div>` : ''}
  <div class="line grand"><span>TOTAL:</span><span>${formatRs(inv.total)}</span></div>
</div>

<div class="ft">
  <div class="big">Thank you for choosing DT POS by Digital Target</div>
  <div>For support: 0345-1873354 · This is a system-generated invoice.</div>
</div>
</body></html>`;
}
