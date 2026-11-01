// ============================================================
// PUBLIC invoice verification page (v1.83.0) — opened from the QR code or link printed on a Digital Target invoice.
// No sign-in, no restaurant: it asks one database function about one invoice id (see lib/invoiceVerify.ts).
// ============================================================
import { useEffect, useState } from 'react';
import { useParams } from '@/lib/hash-router';
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { verdictFor, verifyInvoice, type VerifyResult } from '@/lib/invoiceVerify';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

const TONE = {
  success: { box: 'border-[hsl(var(--status-success)/0.35)] bg-[hsl(var(--status-success)/0.08)] text-[hsl(var(--status-success))]', Icon: CheckCircle2 },
  warning: { box: 'border-amber-500/35 bg-amber-500/10 text-amber-800', Icon: Clock },
  danger: { box: 'border-[hsl(var(--status-danger)/0.35)] bg-[hsl(var(--status-danger)/0.08)] text-[hsl(var(--status-danger))]', Icon: XCircle },
} as const;

export default function VerifyInvoicePage() {
  const { invoiceId = '' } = useParams<{ invoiceId: string }>();
  const [res, setRes] = useState<VerifyResult | null>(null);
  useEffect(() => {
    let off = false;
    setRes(null);
    verifyInvoice(invoiceId).then(r => { if (!off) setRes(r); });
    return () => { off = true; };
  }, [invoiceId]);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="verify-invoice">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <BrandLockup size={44} />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-[12px] font-semibold text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Invoice verification</span>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          {res === null && (
            <div className="flex items-center gap-3 py-8 text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Checking this invoice…</div>
          )}

          {res?.state === 'invalid' && (
            <Message tone="danger" title="This is not a valid invoice link" body="The address is incomplete or has been changed. Scan the QR code on the invoice again, or contact Digital Target." />
          )}
          {res?.state === 'not-found' && (
            <Message tone="danger" title="No invoice found" body="Digital Target has no invoice with this code. If you hold a paper or PDF copy, treat it as unverified and contact us before paying." />
          )}
          {res?.state === 'error' && (
            <Message tone="warning" title="Could not check right now" body={`${res.message} Please try again in a moment.`} />
          )}

          {res?.state === 'ok' && (() => {
            const v = res.invoice;
            const verdict = verdictFor(v);
            const T = TONE[verdict.tone];
            return (
              <>
                <div className={`flex items-start gap-3 rounded-xl border p-4 ${T.box}`} data-testid="verdict" data-tone={verdict.tone}>
                  <T.Icon className="mt-0.5 h-6 w-6 shrink-0" />
                  <div>
                    <div className="text-[18px] font-extrabold leading-tight">{verdict.headline}</div>
                    <div className="mt-1 text-[13.5px] opacity-90">{verdict.detail}</div>
                  </div>
                </div>

                <dl className="mt-5 divide-y text-[14px]" data-testid="verify-details">
                  {([
                    ['Invoice number', v.number],
                    ['Issued by', v.issuer],
                    ['Issued to', v.customer || '—'],
                    ['Issue date', day(v.issuedAt)],
                    ['Due date', day(v.dueAt)],
                    ['Invoice total', rs(v.total)],
                    ['Paid', rs(v.paidTotal)],
                    ['Balance due', rs(v.balance)],
                  ] as [string, string][]).map(([k, val]) => (
                    <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right font-bold tabular-nums">{val}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                  Compare the invoice number and total above with the invoice you hold. If they differ, the copy has been altered — do not pay it and contact us.
                  This page shows only the invoice header and its payment state.
                </p>
              </>
            );
          })()}
        </div>

        <p className="mt-6 text-center text-[12px] text-muted-foreground">
          {BRAND.name} · {BRAND.phoneShort} · {BRAND.email}
        </p>
      </div>
    </div>
  );
}

function Message({ tone, title, body }: { tone: 'danger' | 'warning'; title: string; body: string }) {
  const T = TONE[tone];
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${T.box}`} data-testid="verify-message" data-tone={tone}>
      <T.Icon className="mt-0.5 h-6 w-6 shrink-0" />
      <div>
        <div className="text-[17px] font-extrabold leading-tight">{title}</div>
        <div className="mt-1 text-[13.5px] opacity-90">{body}</div>
      </div>
    </div>
  );
}
