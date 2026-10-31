// The A4 invoice Digital Target sends its restaurants — the layout of the reference invoice: a purple header with the
// brand lockup and a large INVOICE, From / Bill to / details, a table, payment details beside the totals (Total, Paid,
// Balance due), terms and signature, and a footer band. Every figure comes from the invoice; sections that have nothing
// to say (no discount, no setup fee, no bank details) are left out rather than printed empty.
// Inline styles on purpose: html2canvas (PNG/JPG/PDF) and the print window both paint exactly what is here.
import { forwardRef, type CSSProperties } from 'react';
import BrandLockup from '@/components/BrandLockup';
import { BRAND, PALETTE } from '@/lib/brand';
import { Invoice, tsToDate, formatRs } from '@/lib/billing';
import { getAdminSignature } from '@/components/BrandSignaturePanel';
import { getInvoiceProfile, hasPaymentDetails, invoiceAmounts, invoiceBadge, type InvoiceProfile } from '@/lib/invoiceProfile';

const PURPLE_DEEP = PALETTE.purpleDeep;
const PURPLE = PALETTE.purple;
const LAVENDER = PALETTE.lavender;
const INK = PALETTE.ink;
const MUTED = PALETTE.muted;

interface Props {
  invoice: Invoice;
  restaurantName: string;
  email?: string;
  tenantId: string;
  planName: string;
  issued: string;
  /** Defaults to the profile saved in Super Admin → Branding. */
  profile?: InvoiceProfile;
}

const label: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: PURPLE, marginBottom: 8 };
const small: CSSProperties = { fontSize: 13, color: MUTED, lineHeight: 1.55 };
const th: CSSProperties = { padding: '13px 16px', fontSize: 12, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase', color: '#fff' };

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '5px 0', fontSize: 13.5 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ color: INK, fontWeight: strong ? 800 : 700, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Totals({ k, v, color, size = 16, weight = 600 }: { k: string; v: string; color?: string; size?: number; weight?: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 20px', fontSize: size, fontWeight: weight, color: color || INK }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}

const A4Invoice = forwardRef<HTMLDivElement, Props>(function A4Invoice(
  { invoice, restaurantName, email, tenantId, planName, issued, profile }, ref,
) {
  const prof = profile ?? getInvoiceProfile();
  const sig = getAdminSignature();
  const { total, paid, balance } = invoiceAmounts(invoice);
  const badge = invoiceBadge(invoice);
  const isPaid = badge.label === 'Paid';
  const due = tsToDate(invoice.dueAt)?.toLocaleDateString();
  const setup = invoice.setupFee && invoice.setupFee > 0 ? invoice.setupFee : 0;
  const subscriptionAmount = invoice.monthlyFee ? invoice.monthlyFee * invoice.months : (invoice.amount - setup);
  const rate = invoice.monthlyFee || (invoice.months ? subscriptionAmount / invoice.months : subscriptionAmount);
  const terms = prof.terms.filter(Boolean);
  let n = 0;

  return (
    <div ref={ref} data-a4-invoice style={{
      width: 720, minHeight: 1018, background: '#fff', color: INK, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif', boxShadow: '0 4px 20px rgba(0,0,0,.1)',
    }}>
      {/* Header */}
      <div data-invoice-header style={{
        background: `linear-gradient(120deg, ${PURPLE_DEEP} 0%, ${PURPLE} 100%)`, padding: '34px 40px 30px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '14px 18px', color: PURPLE_DEEP }}>
          <BrandLockup size={38} />
        </div>
        <div style={{ textAlign: 'right', color: '#fff' }}>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: 9, lineHeight: 1 }}>INVOICE</div>
          <div style={{ marginTop: 10, fontSize: 16, fontWeight: 600, opacity: 0.92 }}>{invoice.number}</div>
          <span data-invoice-status style={{
            display: 'inline-block', marginTop: 10, padding: '5px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 800,
            letterSpacing: 2, textTransform: 'uppercase', background: badge.bg, color: badge.fg,
          }}>{badge.label}</span>
        </div>
      </div>

      <div style={{ padding: '30px 40px 36px', flex: 1 }}>
        {/* From / Bill to / details */}
        <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 138px' }}>
            <div style={label}>From</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{BRAND.name}</div>
            <div style={small}>{BRAND.phones[0]}<br />{BRAND.phones[1]}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={label}>Bill to</div>
            <div style={{ fontSize: 19, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.25 }}>{restaurantName}</div>
            {invoice.ownerName && <div style={{ ...small, color: INK, fontWeight: 600, marginTop: 2 }}>{invoice.ownerName}</div>}
            {invoice.clientPhone && <div style={small}>{invoice.clientPhone}</div>}
            {email && <div style={{ ...small, wordBreak: 'break-all' }}>{email}</div>}
            {invoice.clientAddress && <div style={small}>{invoice.clientAddress}</div>}
            <div style={{ fontSize: 10, color: '#9a93a8', fontFamily: 'monospace', marginTop: 5 }}>ID: {tenantId.slice(0, 8)}</div>
          </div>
          <div style={{ flex: '0 0 232px', background: LAVENDER, borderRadius: 18, padding: '16px 20px' }}>
            <Row k="Invoice date" v={issued || '—'} strong />
            <Row k="Due date" v={due || 'On receipt'} strong />
            <Row k="Service" v={invoice.packageName || `${planName} Plan`} strong />
            {invoice.periodStart && <Row k="Period start" v={invoice.periodStart} strong />}
            {invoice.periodEnd && <Row k="Period end" v={invoice.periodEnd} strong />}
            {typeof invoice.approvedDevices === 'number' && <Row k="Devices" v={String(invoice.approvedDevices)} strong />}
          </div>
        </div>

        {/* Included features */}
        {invoice.includedFeatures && invoice.includedFeatures.length > 0 && (
          <div style={{ marginTop: 20, padding: '12px 16px', background: LAVENDER, borderRadius: 14 }}>
            <div style={{ ...label, marginBottom: 6, fontSize: 10 }}>Included features</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: INK, columns: 2, columnGap: 24 }}>
              {invoice.includedFeatures.map((f, i) => <li key={i} style={{ marginBottom: 3 }}>{f}</li>)}
            </ul>
          </div>
        )}

        {/* Items */}
        <table data-invoice-items style={{ width: '100%', borderCollapse: 'collapse', marginTop: 26 }}>
          <thead>
            <tr style={{ background: PURPLE_DEEP }}>
              <th style={{ ...th, textAlign: 'left', width: 38, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }}>#</th>
              <th style={{ ...th, textAlign: 'left' }}>Description</th>
              <th style={{ ...th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...th, textAlign: 'right' }}>Rate</th>
              <th style={{ ...th, textAlign: 'right', borderTopRightRadius: 14, borderBottomRightRadius: 14 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {setup > 0 && (
              <tr style={{ borderBottom: '1px solid #ece8f3' }}>
                <td style={{ padding: '16px', fontSize: 14, color: MUTED }}>{++n}</td>
                <td style={{ padding: '16px', fontSize: 15, fontWeight: 600 }}>One-time setup fee{invoice.packageName && <div style={{ ...small, fontWeight: 400 }}>{invoice.packageName}</div>}</td>
                <td style={{ padding: '16px', textAlign: 'right', fontSize: 14 }}>1</td>
                <td style={{ padding: '16px', textAlign: 'right', fontSize: 14 }}>{(setup).toLocaleString('en-PK')}</td>
                <td style={{ padding: '16px', textAlign: 'right', fontSize: 15, fontWeight: 800 }}>{setup.toLocaleString('en-PK')}</td>
              </tr>
            )}
            <tr style={{ borderBottom: '1px solid #ece8f3' }}>
              <td style={{ padding: '16px', fontSize: 14, color: MUTED }}>{++n}</td>
              <td style={{ padding: '16px', fontSize: 15, fontWeight: 600 }}>
                {invoice.packageName || `${planName} subscription`}
                <div style={{ ...small, fontWeight: 400 }}>
                  {invoice.monthlyFee ? `${formatRs(invoice.monthlyFee)} × ${invoice.months} month(s)` : (invoice.notes || 'DT POS software subscription')}
                </div>
              </td>
              <td style={{ padding: '16px', textAlign: 'right', fontSize: 14 }}>{invoice.months}</td>
              <td style={{ padding: '16px', textAlign: 'right', fontSize: 14 }}>{Math.round(rate).toLocaleString('en-PK')}</td>
              <td style={{ padding: '16px', textAlign: 'right', fontSize: 15, fontWeight: 800 }}>{subscriptionAmount.toLocaleString('en-PK')}</td>
            </tr>
          </tbody>
        </table>

        {/* Payment details + totals */}
        <div style={{ display: 'flex', gap: 24, marginTop: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            {hasPaymentDetails(prof) && (
              <div data-invoice-payment style={{ border: '1px solid #e4def0', borderRadius: 16, padding: '16px 20px' }}>
                <div style={label}>Payment details</div>
                {prof.accountTitle && <div style={{ fontSize: 15, fontWeight: 700 }}>{prof.accountTitle}</div>}
                {prof.bank && <div style={{ fontSize: 14, color: MUTED }}>{prof.bank}</div>}
                {prof.accountNo && <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.5 }}>{prof.accountNo}</div>}
              </div>
            )}
            {isPaid && (
              <div data-invoice-paid-stamp style={{
                margin: '16px 0 0 18px', width: 118, height: 118, borderRadius: '50%', border: '4px solid #16a34a', color: '#16a34a',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
                transform: 'rotate(-12deg)', opacity: 0.88,
              }}>
                <div style={{ fontSize: 30, letterSpacing: 2, lineHeight: 1 }}>PAID</div>
                <div style={{ fontSize: 8.5, marginTop: 4, letterSpacing: 1 }}>DIGITAL TARGET</div>
                <div style={{ fontSize: 8.5, marginTop: 2 }}>{tsToDate(invoice.paidAt)?.toLocaleDateString() || ''}</div>
              </div>
            )}
          </div>
          <div data-invoice-totals style={{ flex: '0 0 300px', border: '1px solid #e4def0', borderRadius: 16, overflow: 'hidden' }}>
            <Totals k="Subtotal" v={formatRs(invoice.amount)} />
            {invoice.discount ? <Totals k="Discount" v={`− ${formatRs(invoice.discount)}`} /> : null}
            {invoice.tax ? <Totals k="Tax" v={formatRs(invoice.tax)} /> : null}
            <div style={{ background: PURPLE_DEEP, color: '#fff' }}><Totals k="Total" v={formatRs(total)} size={20} weight={800} color="#fff" /></div>
            <Totals k="Paid" v={formatRs(paid)} color="#15803d" weight={700} />
            <Totals k="Balance due" v={formatRs(balance)} color={balance > 0 ? '#dc2626' : '#15803d'} size={19} weight={800} />
          </div>
        </div>

        {/* Terms + signature */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 30, marginTop: 44 }}>
          <div style={{ flex: 1 }}>
            {terms.length > 0 && (
              <>
                <div style={label}>Terms &amp; conditions</div>
                {terms.map((t, i) => <div key={i} style={{ ...small, fontSize: 13 }}>{i + 1}. {t}</div>)}
              </>
            )}
          </div>
          <div style={{ width: 270, textAlign: 'center' }}>
            {sig && <img src={sig} alt="signature" style={{ height: 62, maxWidth: 220, objectFit: 'contain', display: 'block', margin: '0 auto 4px' }} />}
            <div style={{ borderTop: `3px solid ${PURPLE_DEEP}`, paddingTop: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{BRAND.signatory}</div>
              <div style={{ ...small, fontSize: 13 }}>Authorized Signatory</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer band */}
      <div style={{
        background: '#f6f3fc', borderTop: `3px solid ${PURPLE_DEEP}`,
        padding: '15px 40px', display: 'flex', justifyContent: 'space-between', fontSize: 13,
      }}>
        <span style={{ fontWeight: 800, color: PURPLE_DEEP }}>Thank you for your business!</span>
        <span style={{ color: MUTED }}>{BRAND.name} | {BRAND.phoneShort} | {BRAND.email}</span>
      </div>
    </div>
  );
});

export default A4Invoice;
