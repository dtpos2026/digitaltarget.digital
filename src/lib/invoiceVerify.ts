// ============================================================
// Online invoice verification (v1.83.0)
//
// Every Digital Target invoice carries a link and a QR code to  <site>/#/verify/<invoice id>.  The id is the invoice's
// own random uuid (122 bits: it cannot be guessed or counted up), and the page asks the database function
// public.verify_invoice(uuid), which answers with the invoice header and its payment state only — never line items,
// notes or contact details — or nothing when the id is unknown.
//
// What the page proves: "this invoice exists in Digital Target's records, for this customer and amount, and this is its
// payment state". It does not prove that a paper copy was not altered after printing, which is why the page shows the
// amount and number to compare with the paper.
// ============================================================

export const VERIFY_PATH = '#/verify/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const looksLikeInvoiceId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v.trim());

/** The address printed on the invoice. `origin` is the site the invoice was issued from. */
export function verifyUrl(invoiceId: string, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}/${VERIFY_PATH}${invoiceId}`;
}

/** The id out of a verify address or a bare id; null when it is neither. */
export function invoiceIdFrom(text: string): string | null {
  const t = String(text || '').trim();
  const m = t.match(/#\/verify\/([^/?#\s]+)/i);
  const id = (m ? m[1] : t).trim();
  return looksLikeInvoiceId(id) ? id.toLowerCase() : null;
}

export type VerifiedStatus = 'unpaid' | 'partial' | 'paid' | 'void';
export interface VerifiedInvoice {
  number: string;
  issuedAt: string;
  dueAt: string | null;
  total: number;
  paidTotal: number;
  balance: number;
  status: VerifiedStatus;
  customer: string | null;
  issuer: string;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Reads the database answer into a verified invoice; null when it is not shaped like one. Never throws. */
export function parseVerification(raw: unknown): VerifiedInvoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.number !== 'string' || !r.number) return null;
  const status = r.status === 'paid' || r.status === 'partial' || r.status === 'void' || r.status === 'unpaid' ? r.status : null;
  if (!status) return null;
  const total = num(r.total);
  const paid = Math.min(num(r.paid_total), total > 0 ? total : num(r.paid_total));
  return {
    number: r.number,
    issuedAt: typeof r.issued_at === 'string' ? r.issued_at : '',
    dueAt: typeof r.due_at === 'string' ? r.due_at : null,
    total,
    paidTotal: paid,
    balance: status === 'void' ? 0 : Math.max(0, total - paid),
    status,
    customer: typeof r.customer === 'string' && r.customer ? r.customer : null,
    issuer: typeof r.issuer === 'string' && r.issuer ? r.issuer : 'Digital Target',
  };
}

export type Verdict = { tone: 'success' | 'warning' | 'danger'; headline: string; detail: string };

/** The one-line answer a person reads first. */
export function verdictFor(v: VerifiedInvoice, nowMs = Date.now()): Verdict {
  if (v.status === 'void') return { tone: 'danger', headline: 'Genuine invoice — cancelled', detail: 'This invoice was issued by Digital Target and has since been cancelled. It is not payable.' };
  if (v.status === 'paid') return { tone: 'success', headline: 'Genuine invoice — paid in full', detail: 'This invoice was issued by Digital Target and has been paid in full.' };
  const overdue = v.dueAt ? new Date(v.dueAt).getTime() < nowMs : false;
  if (v.status === 'partial') return { tone: 'warning', headline: 'Genuine invoice — partly paid', detail: `A balance is still due${overdue ? ' and the due date has passed' : ''}.` };
  return { tone: overdue ? 'danger' : 'warning', headline: 'Genuine invoice — payment pending', detail: overdue ? 'This invoice is genuine and its due date has passed.' : 'This invoice is genuine and is awaiting payment.' };
}

export type VerifyResult =
  | { state: 'ok'; invoice: VerifiedInvoice }
  | { state: 'not-found' }
  | { state: 'invalid' }
  | { state: 'error'; message: string };

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

/** Asks the database. `rpc` is injectable for tests; by default it is the app's Supabase client. */
export async function verifyInvoice(id: string, rpc?: Rpc): Promise<VerifyResult> {
  if (!looksLikeInvoiceId(id)) return { state: 'invalid' };
  try {
    const call: Rpc = rpc ?? (async (fn, args) => {
      const { sb } = await import('./supabase');
      return sb().rpc(fn, args) as any;
    });
    const { data, error } = await call('verify_invoice', { p_id: id.trim().toLowerCase() });
    if (error) return { state: 'error', message: error.message || 'The verification service could not be reached.' };
    if (data === null || data === undefined) return { state: 'not-found' };
    const invoice = parseVerification(data);
    return invoice ? { state: 'ok', invoice } : { state: 'not-found' };
  } catch (e) {
    return { state: 'error', message: e instanceof Error ? e.message : 'The verification service could not be reached.' };
  }
}
