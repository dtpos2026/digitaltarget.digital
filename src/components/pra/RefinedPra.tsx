// v1.147.0 — PRA fiscal invoicing in the design's shape (SW-37): the title with its one line, Enable / Disable, the "Not live" notice, three status cards,
// the settings (POS ID, token, mode …) and the invoices table with Retry. API logs, Send pending and Export audit are kept. The page owns the queue and the sending.
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, Eye, EyeOff, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { praVerifyUrl, praConfigReady, type PraConfig, type PraEnvironment, type PraTransportMode } from '@/lib/praEims';
import type { PraLogRecord, PraQueueEntry } from '@/lib/praQueue';
import { PRA_FILTERS, PRA_NOT_LIVE, PRA_STATUS_LABEL, praCounts, praRows, praSubtitle, type PraFilter } from '@/lib/praBoard';

export interface RefinedPraProps {
  cfg: PraConfig;
  onCfg: (next: PraConfig) => void;
  queue: PraQueueEntry[];
  logs: PraLogRecord[];
  showLogs: boolean;
  onShowLogs: (v: boolean) => void;
  onClearLogs: () => void;
  limitation: string | null;
  testing: boolean;
  status: { ok: boolean; message: string; detail?: string } | null;
  onTest: () => void;
  onRetry: (id: string) => void;
  onSendPending: () => void;
  onExport: () => void;
}

export default function RefinedPra(p: RefinedPraProps) {
  const [filter, setFilter] = useState<PraFilter>('all');
  const [reveal, setReveal] = useState(false);
  const c = praCounts(p.queue);
  const rows = praRows(p.queue, filter);
  const ready = praConfigReady(p.cfg);
  const set = (patch: Partial<PraConfig>) => p.onCfg({ ...p.cfg, ...patch });
  return (
    <div data-pra-page className="pr-root">
      <div className="pr-head">
        <div className="pr-titles"><h1 data-pra-title>PRA fiscal invoicing</h1><p data-pra-subtitle>{praSubtitle(p.cfg.enabled, p.cfg.environment)}</p></div>
        <button type="button" className={p.cfg.enabled ? 'pr-btn' : 'pr-btn pr-btn-primary'} data-pra-enable aria-pressed={p.cfg.enabled} onClick={() => set({ enabled: !p.cfg.enabled })}>{p.cfg.enabled ? 'Disable' : 'Enable'}</button>
      </div>
      <div className="pr-notice" data-pra-notice><ShieldAlert aria-hidden className="h-4 w-4" />{PRA_NOT_LIVE}</div>
      {p.limitation && <div className="pr-notice pr-notice-soft" data-pra-limit><AlertTriangle aria-hidden className="h-4 w-4" />{p.limitation}</div>}

      <div className="pr-cards">
        {([['Submitted', c.submitted, CheckCircle2, 'sent'], ['Pending', c.pending, Clock, 'pending'], ['Failed', c.failed, XCircle, 'failed']] as const).map(([label, n, Icon, key]) => (
          <button key={key} type="button" className="pr-card" data-pra-card={key} onClick={() => setFilter(key)} title={`Show ${label.toLowerCase()} invoices`}>
            <span className="pr-card-top"><span>{label}</span><i><Icon aria-hidden className="h-4 w-4" /></i></span>
            <b className="pr-card-n">{n}</b>
          </button>
        ))}
      </div>

      <section className="pr-panel" aria-label="Settings">
        <h2>Settings</h2>
        <div className="pr-grid">
          <label className="pr-field"><span>POS ID</span><input inputMode="numeric" placeholder="e.g. 100000" value={p.cfg.posId} onChange={e => set({ posId: e.target.value.replace(/\D/g, '') })} aria-label="POS ID" /><small>From the PRA portal — one per branch / counter.</small></label>
          <label className="pr-field"><span>Seller PNTN (optional)</span><input placeholder="1234567-8" value={p.cfg.sellerPntn || ''} onChange={e => set({ sellerPntn: e.target.value })} aria-label="Seller PNTN" /></label>
          <label className="pr-field"><span>Branch label</span><input placeholder="Main Branch" value={p.cfg.branchLabel || ''} onChange={e => set({ branchLabel: e.target.value })} aria-label="Branch label" /><small>For our own logs only.</small></label>
          <label className="pr-field"><span>Mode</span>
            <select value={p.cfg.environment} onChange={e => set({ environment: e.target.value as PraEnvironment })} aria-label="Mode"><option value="sandbox">Sandbox</option><option value="production">Production</option></select>
            {p.cfg.environment === 'production' && <small className="pr-warn">In production, real invoices are recorded with the PRA.</small>}
          </label>
          <label className="pr-field"><span>Transport</span>
            <select value={p.cfg.transport} onChange={e => set({ transport: e.target.value as PraTransportMode })} aria-label="Transport"><option value="local">Local Fiscal Device (this PC)</option><option value="cloud">PRAL Cloud (needs a token)</option></select>
          </label>
          {p.cfg.transport === 'cloud' ? (
            <label className="pr-field"><span>Token</span>
              <span className="pr-pass"><input type={reveal ? 'text' : 'password'} placeholder="Obtain this from PRA" value={p.cfg.cloudToken || ''} onChange={e => set({ cloudToken: e.target.value })} aria-label="PRA bearer token" /><button type="button" aria-label={reveal ? 'Hide token' : 'Show token'} onClick={() => setReveal(r => !r)}>{reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button></span>
            </label>
          ) : (
            <label className="pr-field"><span>Local device URL (optional)</span><input placeholder="http://localhost:8524" value={p.cfg.localBaseUrl || ''} onChange={e => set({ localBaseUrl: e.target.value })} aria-label="Local device URL" /></label>
          )}
        </div>
        <label className="pr-check"><input type="checkbox" checked={p.cfg.printOnReceipt} onChange={e => set({ printOnReceipt: e.target.checked })} />Print the PRA invoice number and QR on the receipt</label>
        <div className="pr-actions">
          <button type="button" className="pr-btn" data-pra-test disabled={p.testing} onClick={p.onTest}><RefreshCw aria-hidden className={`h-4 w-4 ${p.testing ? 'animate-spin' : ''}`} />Test connection</button>
          <span className="pr-ready" data-ok={ready.ok ? '' : undefined}>{ready.ok ? 'Settings complete' : ready.reason}</span>
        </div>
        {p.status && <div className="pr-status" data-ok={p.status.ok ? '' : undefined} role="status"><b>{p.status.message}</b>{p.status.detail && <span>{p.status.detail}</span>}</div>}
        <details className="pr-how"><summary>How it works</summary>
          <p>The PRA gives you a <b>Software Fiscal Device</b> installed on this same Windows computer. The POS sends every bill to it; it returns a <b>Fiscal Invoice Number</b>, printed on the receipt with a QR code. The device reports to the PRA itself. First register your POS client at e.pra.punjab.gov.pk to get the <b>POS ID</b>, then run the IMS installer.</p>
        </details>
      </section>

      <section className="pr-panel" aria-label="Invoices" data-pra-invoices>
        <div className="pr-bar">
          <h2>Invoices</h2>
          <div role="group" aria-label="Status" className="pr-chips">{PRA_FILTERS.map(f => <button key={f.key} type="button" data-pra-filter={f.key} aria-pressed={filter === f.key} className="pr-chip" onClick={() => setFilter(f.key)}>{f.label}</button>)}</div>
          <span className="pr-grow" />
          <button type="button" className="pr-btn pr-btn-sm" data-pra-send onClick={p.onSendPending}>Send pending</button>
          <button type="button" className="pr-btn pr-btn-sm" data-pra-export onClick={p.onExport}><Download aria-hidden className="h-4 w-4" />Export audit</button>
        </div>
        {rows.length === 0 ? <p className="pr-empty" data-pra-empty>{p.queue.length === 0 ? 'No invoices in the queue.' : 'No invoices in this status.'}</p> : (
          <div className="overflow-x-auto"><table data-roomy className="w-full text-[14px]">
            <thead><tr><th>Bill</th><th>Status</th><th>PRA invoice</th><th>Error</th><th>Tries</th><th aria-label="Actions" /></tr></thead>
            <tbody>{rows.map(q => (
              <tr key={q.id} data-pra-row={q.usin} data-status={q.status}>
                <td className="pr-usin">#{q.usin}</td>
                <td><span className="pr-pill" data-status={q.status}>{PRA_STATUS_LABEL[q.status] || q.status}</span></td>
                <td>{q.praInvoiceNumber ? <a href={praVerifyUrl(q.praInvoiceNumber)} target="_blank" rel="noreferrer" className="pr-link">{q.praInvoiceNumber}</a> : '—'}</td>
                <td className="pr-err" title={q.lastError || ''}>{q.lastError || '—'}</td>
                <td className="tabular-nums">{q.attempts}</td>
                <td className="text-right">{q.status === 'failed' && <button type="button" className="pr-btn pr-btn-sm" data-pra-retry onClick={() => p.onRetry(q.id)}>Retry</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="pr-panel" aria-label="API logs">
        <div className="pr-bar"><h2>API logs</h2><span className="pr-grow" />
          <button type="button" className="pr-btn pr-btn-sm" data-pra-logs onClick={() => p.onShowLogs(!p.showLogs)}>{p.showLogs ? 'Hide' : 'Show'}</button>
          <button type="button" className="pr-btn pr-btn-sm" data-pra-clear onClick={p.onClearLogs}>Clear</button>
        </div>
        {p.showLogs && (p.logs.length === 0 ? <p className="pr-empty">No log entries.</p> : (
          <div className="pr-logs">{p.logs.map(l => (
            <details key={l.id}><summary>{new Date(l.at).toLocaleString('en-GB')} · {l.direction} · #{l.usin}{l.ok === false && <b className="pr-bad"> · FAILED</b>}</summary><pre>{JSON.stringify(l.data, null, 2)}</pre></details>
          ))}</div>
        ))}
      </section>
    </div>
  );
}
