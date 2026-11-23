// v1.151.0 — CRM insights in the design's shape (SW-20): "Last 90 days", Send offer, four figure cards, the bars of "Orders per customer" and the list
// "At risk — send an offer" with "Message all N". Below them what the old page had: the totals, the top customers and the sign-ups by month.
// Messages go to the software's own WhatsApp queue (the WhatsApp page sends them); the page owns that and the data — this is the picture and the clicks.
import { useState, type ReactNode } from 'react';
import { Cake, MessageCircle, Repeat, Send, UserMinus, Users } from 'lucide-react';
import KpiCard from '@/components/ui-kit/KpiCard';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { money } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  deltaWord, offerTemplate, ordersPerCustomer, personalise, type Bar, type CrmFigures, type CrmPerson, type Customer, type OfferAudience,
} from '@/lib/crmBoard';

export interface CrmTotals { customers: number; orders: number; sales: number; avgBasket: number }
export interface OfferMessage { phone: string; name: string; message: string }

export interface RefinedCrmProps {
  figures: CrmFigures;
  /** the people who ordered in the last 90 days */
  people: CrmPerson[];
  atRisk: CrmPerson[];
  birthdays: Customer[];
  totals: CrmTotals;
  top: Customer[];
  signups: { month: string; count: number }[];
  restaurant: string;
  /** active promo codes the offer can mention */
  promoCodes: string[];
  /** the branch picker (only when the restaurant has branches) */
  branchPicker: ReactNode;
  onQueue: (messages: OfferMessage[]) => void;
  /** open the WhatsApp page on one person with the message typed */
  onChat: (phone: string, message: string) => void;
}

const initial = (name: string) => (String(name).trim()[0] || '?').toUpperCase();
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

function Bars({ bars, highlightLast, label }: { bars: Bar[]; highlightLast?: boolean; label: string }) {
  const max = Math.max(1, ...bars.map(b => b.count));
  return (
    <div className="crm-bars" role="img" aria-label={label} data-crm-bars>
      {bars.map((b, i) => (
        <div key={b.label} className="crm-bar-col" data-crm-bar={b.label} data-count={b.count} title={`${b.label}: ${b.count}`}>
          <i className="crm-bar" data-last={highlightLast && i === bars.length - 1 ? '' : undefined} style={{ height: `${b.count > 0 ? Math.max(6, Math.round((b.count / max) * 100)) : 3}%` }} />
          <span>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function OfferDialog({ p, audience, onAudience, onClose }: { p: RefinedCrmProps; audience: OfferAudience; onAudience: (a: OfferAudience) => void; onClose: () => void }) {
  const [promo, setPromo] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const lists: Record<OfferAudience, { name: string; phone: string }[]> = { atRisk: p.atRisk, birthdays: p.birthdays, active: p.people };
  const list = lists[audience];
  const withPhone = list.filter(x => String(x.phone || '').replace(/\D/g, '').length >= 7);
  const template = edited ?? offerTemplate(audience, p.restaurant, promo || undefined);
  const pick = (a: OfferAudience) => { setEdited(null); onAudience(a); };
  const AUD: { key: OfferAudience; label: string; n: number }[] = [
    { key: 'atRisk', label: 'At risk', n: p.atRisk.length }, { key: 'birthdays', label: 'Birthdays this month', n: p.birthdays.length }, { key: 'active', label: 'All active', n: p.people.length },
  ];
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg" data-crm-offer>
        <DialogHeader>
          <DialogTitle>Send an offer</DialogTitle>
          <DialogDescription>Messages are added to the WhatsApp queue; the WhatsApp page sends them.</DialogDescription>
        </DialogHeader>
        <div className="crm-aud" role="group" aria-label="Who to message">
          {AUD.map(a => <button key={a.key} type="button" data-crm-aud={a.key} aria-pressed={audience === a.key} onClick={() => pick(a.key)}>{a.label} · {a.n}</button>)}
        </div>
        {p.promoCodes.length > 0 && (
          <label className="crm-field"><span>Mention a promo code (optional)</span>
            <select value={promo} aria-label="Promo code" onChange={e => { setPromo(e.target.value); setEdited(null); }}>
              <option value="">No code</option>{p.promoCodes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <label className="crm-field"><span>Message — {'{name}'} becomes each customer's first name</span>
          <textarea rows={4} aria-label="Message" value={template} onChange={e => setEdited(e.target.value)} />
        </label>
        <p className="crm-count" data-crm-count>
          {withPhone.length} {withPhone.length === 1 ? 'customer' : 'customers'} will get it{list.length > withPhone.length ? ` · ${list.length - withPhone.length} without a phone number are left out` : ''}.
        </p>
        <DialogFooter>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="crm-btn crm-btn-primary" data-crm-queue disabled={withPhone.length === 0 || !template.trim()}
            onClick={() => { p.onQueue(withPhone.map(x => ({ phone: x.phone, name: x.name, message: personalise(template, x.name) }))); onClose(); }}>
            <Send aria-hidden className="h-4 w-4" />Add {withPhone.length} to the WhatsApp queue
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RefinedCrm(p: RefinedCrmProps) {
  const [offer, setOffer] = useState<OfferAudience | null>(null);
  const f = p.figures;
  const bars = ordersPerCustomer(p.people);
  const shown = p.atRisk.slice(0, 6);
  const maxSign = Math.max(1, ...p.signups.map(s => s.count));
  return (
    <div className="crm-root" data-crm-page>
      <div className="crm-head">
        <div className="crm-titles"><h1 data-crm-title>CRM insights</h1><p data-crm-subtitle>Last 90 days</p></div>
        <div className="crm-head-actions">
          {p.branchPicker}
          <button type="button" className="crm-btn crm-btn-primary crm-btn-lg" data-crm-send onClick={() => setOffer('atRisk')}><Send aria-hidden className="h-4 w-4" />Send offer</button>
        </div>
      </div>

      <div className="crm-kpis">
        <KpiCard label="Active customers" value={String(f.active)} icon={Users} caption={deltaWord(f.activeDelta, '%')} captionTone={f.activeDelta == null || f.activeDelta === 0 ? undefined : f.activeDelta > 0 ? 'ok' : 'bad'} />
        <KpiCard label="Repeat rate" value={`${f.repeatPct}%`} icon={Repeat} caption={deltaWord(f.repeatDeltaPts, ' pts')} captionTone={f.repeatDeltaPts == null || f.repeatDeltaPts === 0 ? undefined : f.repeatDeltaPts > 0 ? 'ok' : 'bad'} />
        <KpiCard label="At risk" value={String(f.atRisk)} icon={UserMinus} caption="No order in 30 d" captionTone="bad" />
        <KpiCard label="Birthdays this month" value={String(f.birthdays)} icon={Cake} />
      </div>

      <div className="crm-grid">
        <section className="crm-card" data-crm-chart aria-label="Orders per customer">
          <h2>Orders per customer</h2>
          {p.people.length === 0 ? <div className="crm-empty" data-crm-empty>No paid bills with a customer on them in the last 90 days.</div> : <Bars bars={bars} highlightLast label="Customers by number of orders" />}
        </section>
        <section className="crm-card" data-crm-risk aria-label="At risk">
          <h2>At risk — send an offer</h2>
          {shown.length === 0 ? <div className="crm-empty" data-crm-risk-empty>Nobody has gone quiet. Customers who ordered in the last 90 days but not in the last 30 show here.</div> : (
            <ul className="crm-list">
              {shown.map(c => {
                const hasPhone = String(c.phone).replace(/\D/g, '').length >= 7;
                return (
                  <li key={c.key}>
                    <button type="button" data-crm-person={c.key} disabled={!hasPhone} title={hasPhone ? `Message ${c.name} on WhatsApp` : 'No phone number on file'}
                      onClick={() => p.onChat(c.phone, offerTemplate('atRisk', p.restaurant).replace(/\{name\}/g, c.name.trim().split(/\s+/)[0] || 'there'))}>
                      <i className="crm-avatar" aria-hidden>{initial(c.name)}</i><span className="crm-person">{c.name}</span><em>{c.daysSince} d</em>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {p.atRisk.length > 0 && <button type="button" className="crm-all" data-crm-all onClick={() => setOffer('atRisk')}><MessageCircle aria-hidden className="h-4 w-4" />Message all {p.atRisk.length}</button>}
        </section>
      </div>

      <div className="crm-totals" data-crm-totals>
        <span><b>{p.totals.customers}</b> customers on record</span>
        <span><b>{p.totals.orders}</b> paid bills</span>
        <span><b>{money(Math.round(p.totals.sales))}</b> sales</span>
        <span>Average basket <b>{money(Math.round(p.totals.avgBasket))}</b></span>
      </div>

      <div className="crm-grid crm-grid-low">
        <section className="crm-card crm-table-card" data-crm-top aria-label="Top customers">
          <h2>Top 10 customers (by spend)</h2>
          {p.top.length === 0 ? <div className="crm-empty">No customers yet.</div> : (
            <div className="overflow-x-auto">
              <table data-roomy className="w-full text-[14px]">
                <thead><tr><th>#</th><th>Name</th><th className="hidden sm:table-cell">Phone</th><th className="text-right">Orders</th><th className="text-right">Spent</th><th className="hidden md:table-cell">Last order</th></tr></thead>
                <tbody>
                  {p.top.map((c, i) => (
                    <tr key={c.id} data-crm-top-row={c.id}>
                      <td>{i + 1}</td><td className="crm-person">{c.name}</td><td className="hidden sm:table-cell">{c.phone || '—'}</td>
                      <td className="text-right tabular-nums">{c.totalOrders}</td><td className="text-right tabular-nums"><b>{money(c.totalSpent)}</b></td><td className="hidden md:table-cell">{fmtDay(c.lastOrderAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="crm-card" data-crm-signups aria-label="Sign-ups by month">
          <h2>Sign-ups by month</h2>
          {p.signups.length === 0 ? <div className="crm-empty">No sign-ups yet.</div> : <Bars bars={p.signups.map(s => ({ label: s.month.slice(2), count: s.count }))} label="New customers by month" />}
          <span className={cn('sr-only')}>{maxSign} at most in a month</span>
        </section>
      </div>

      {offer && <OfferDialog p={p} audience={offer} onAudience={setOffer} onClose={() => setOffer(null)} />}
    </div>
  );
}
