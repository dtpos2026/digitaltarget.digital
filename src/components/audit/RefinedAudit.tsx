// v1.145.0 — the Staff audit log in the design's shape (SW-39): "N events", Export, a search with All · Void · Discount … chips, and a table —
// Time · User · Action (a coloured pill) · Bill · Amount · Reason · Approved by. The day, Refresh and the exact action are kept beside the chips.
// The page owns the loading (and the append-only log itself); this is the picture and the clicks.
import { useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { money } from '@/lib/currency';
import { AUDIT_ACTION_TITLES, type AuditAction, type StaffAuditEntry } from '@/lib/staffAudit';
import { ACTION_WORD, actionTone, AUDIT_GROUPS, auditRows, auditSubtitle, billOf, timeOf, type AuditGroup } from '@/lib/auditBoard';

export interface RefinedAuditProps {
  rows: StaffAuditEntry[];
  loading: boolean;
  day: string;
  today: string;
  onDay: (d: string) => void;
  onRefresh: () => void;
  onExport: (shown: StaffAuditEntry[]) => void;
}

const ACTIONS = Object.keys(AUDIT_ACTION_TITLES) as AuditAction[];

export default function RefinedAudit(p: RefinedAuditProps) {
  const [group, setGroup] = useState<AuditGroup>('all');
  const [exact, setExact] = useState<AuditAction | 'all'>('all');
  const [q, setQ] = useState('');
  const shown = auditRows(p.rows, group, exact, q);
  return (
    <div data-au-page className="au-root">
      <div className="au-head">
        <div className="au-titles"><h1 data-au-title>Staff audit log</h1><p data-au-subtitle>{auditSubtitle(p.rows.length, p.day, p.today)}</p></div>
        <div className="au-head-actions">
        <select className="au-select" aria-label="Exact action" value={exact} onChange={e => { setExact(e.target.value as AuditAction | 'all'); setGroup('all'); }}>
          <option value="all">Any action</option>
          {ACTIONS.map(a => <option key={a} value={a}>{AUDIT_ACTION_TITLES[a]}</option>)}
        </select>
          <input type="date" className="au-date" aria-label="Day" value={p.day} max={p.today} onChange={e => e.target.value && p.onDay(e.target.value)} />
          <button type="button" className="au-icon" aria-label="Refresh" data-au-refresh disabled={p.loading} onClick={p.onRefresh}><RefreshCw className={`h-4 w-4 ${p.loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" className="au-btn" data-au-export disabled={shown.length === 0} onClick={() => p.onExport(shown)}><Download aria-hidden className="h-4 w-4" />Export</button>
        </div>
      </div>
      <div className="au-filters" role="search" aria-label="Filter the audit log">
        <label className="au-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search staff audit log" placeholder="Search staff audit log…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div role="group" aria-label="Action group" className="au-chips">
          {AUDIT_GROUPS.map(g => <button key={g.key} type="button" data-au-group={g.key} aria-pressed={group === g.key} className="au-chip" onClick={() => { setGroup(g.key); setExact('all'); }}>{g.label}</button>)}
        </div>
      </div>
      <div className="au-card" data-au-table>
        {shown.length === 0 ? (
          <div className="au-empty" data-au-empty>{p.loading ? 'Loading…' : p.rows.length === 0 ? 'No audit records for this day.' : 'No records match.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-roomy className="w-full text-[14px]">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Bill</th><th className="text-right">Amount</th><th>Reason</th><th>Approved by</th></tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} data-au-row={r.id} data-action={r.action}>
                    <td className="tabular-nums" title={new Date(r.at).toLocaleString()}>{timeOf(r.at)}{r.deviceName && <span className="au-sub">{r.deviceName}</span>}</td>
                    <td>{r.userName || '—'}{r.userRole && <span className="au-sub">{r.userRole}</span>}</td>
                    <td><span className="au-pill" data-tone={actionTone(r.action)} title={AUDIT_ACTION_TITLES[r.action]}>{ACTION_WORD[r.action] || r.action}</span></td>
                    <td>{billOf(r)}{r.tableLabel && <span className="au-sub">{r.tableLabel}</span>}</td>
                    <td className="text-right tabular-nums">{r.amount != null ? money(r.amount) : '—'}</td>
                    <td className="au-reason" title={r.reason || ''}>{r.reason || '—'}</td>
                    <td>{r.approvedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
