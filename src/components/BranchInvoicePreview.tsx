// ============================================================
// Branch Invoice Preview — live 80mm thermal header/footer preview
// Renders the SAME lines StandardReceipt prints for a branch, but from
// the in-progress (unsaved) draft so edits are visible in real time.
// Empty fields are hidden exactly like on the real print.
// ============================================================
import type { Branch, RestaurantSettings } from '@/lib/types';

const mono = "'Lucida Console','Consolas','Courier New',monospace";

interface Props { branch: Branch; settings: RestaurantSettings }

export default function BranchInvoicePreview({ branch, settings }: Props) {
  const s = settings as any;
  const compact = !!s.receiptCompactMode;
  const fsBody = compact ? 10 : 11;
  const addressLine = branch.address || settings.address;
  const phoneLine = branch.phone || [settings.phone1, settings.phone2].filter(Boolean).join(' | ');
  const showLogo = s.receiptShowLogo !== false && !!settings.logo;

  return (
    <div
      style={{ fontFamily: mono, color: '#000', background: '#fff', width: '100%', maxWidth: 300, padding: 8, lineHeight: 1.25 }}
      className="mx-auto border rounded-md shadow-sm"
    >
      <div style={{ textAlign: 'center' }}>
        {showLogo && (
          <img src={settings.logo} alt="" style={{ maxWidth: 60, maxHeight: 60, margin: '0 auto 2px', display: 'block' }} />
        )}
        <div style={{ fontSize: compact ? 14 : 16, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase' }}>
          {settings.name || 'Restaurant Name'}
        </div>
        {!!branch.name && (
          <div style={{ fontSize: fsBody, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
            {branch.name} BRANCH
          </div>
        )}
        {s.receiptShowAddress !== false && !!addressLine && (
          <div style={{ fontSize: fsBody, fontWeight: 700, marginTop: 2 }}>{addressLine}</div>
        )}
        {s.receiptShowPhone !== false && !!phoneLine && (
          <div style={{ fontSize: fsBody, fontWeight: 700 }}>{phoneLine}</div>
        )}
        {!!branch.registrationNumber && (
          <div style={{ fontSize: fsBody, fontWeight: 700 }}>Registration No: {branch.registrationNumber}</div>
        )}
        {!!branch.taxNumber && (
          <div style={{ fontSize: fsBody, fontWeight: 700 }}>Tax No: {branch.taxNumber}</div>
        )}
        {!!branch.email && (
          <div style={{ fontSize: fsBody, fontWeight: 700 }}>{branch.email}</div>
        )}
      </div>

      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', textAlign: 'center', padding: '2px 0', margin: '3px 0' }}>
        <span style={{ fontSize: compact ? 13 : 14, fontWeight: 900, letterSpacing: 2 }}>CUSTOMER RECEIPT</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fsBody, fontWeight: 700 }}>
        <tbody>
          <tr>
            <td>Date</td><td>: 01-01-2026</td>
            <td style={{ textAlign: 'right' }}>Time</td><td style={{ textAlign: 'right' }}>: 12:30</td>
          </tr>
          <tr>
            <td>Order No</td>
            <td>: {branch.invoicePrefix || '#'}1042</td>
            <td style={{ textAlign: 'right' }}>Type</td><td style={{ textAlign: 'right' }}>: Dine-In</td>
          </tr>
        </tbody>
      </table>

      <div style={{ borderTop: '1px dashed #000', marginTop: 3, paddingTop: 3, fontSize: fsBody, fontWeight: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>1 x Sample Item</span><span>500.00</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', marginTop: 3, paddingTop: 3, fontWeight: 900, fontSize: compact ? 12 : 14 }}>
          <span>TOTAL</span><span>500.00</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', borderTop: '1px dashed #000', marginTop: 4, paddingTop: 4, fontSize: fsBody, fontWeight: 800 }}>
        <div>{settings.thankYouText || 'Thank You!'}</div>
        {!!branch.invoiceFooter && (
          <div style={{ fontWeight: 700, marginTop: 2, whiteSpace: 'pre-line' }}>{branch.invoiceFooter}</div>
        )}
      </div>
    </div>
  );
}
