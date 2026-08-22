// Admin → Staff → Action Audit Log
// Immutable trail: User · Date/Time · Order · Table · Device · Action.
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldCheck, Download } from 'lucide-react';
import { fetchAuditLog, flushAuditQueue, AUDIT_ACTION_TITLES, type StaffAuditEntry, type AuditAction } from '@/lib/staffAudit';

const ACTIONS: Array<AuditAction | 'all'> = ['all', ...(Object.keys(AUDIT_ACTION_TITLES) as AuditAction[])];

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

export default function StaffAuditLogPage() {
  const [day, setDay] = useState(isoDay(new Date()));
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [staff, setStaff] = useState('');
  const [rows, setRows] = useState<StaffAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      await flushAuditQueue();
      const from = new Date(`${day}T00:00:00`).toISOString();
      const to = new Date(`${day}T23:59:59.999`).toISOString();
      setRows(await fetchAuditLog({ from, to, action, staff, limit: 1000 }));
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [day, action, staff]);

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.action, (m.get(r.action) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const exportCsv = () => {
    const head = ['Date/Time', 'User', 'Role', 'Action', 'Order', 'Table', 'Device', 'Approved By', 'Amount', 'Reason'];
    const body = rows.map(r => [
      new Date(r.at).toLocaleString(), r.userName || '', r.userRole || '',
      AUDIT_ACTION_TITLES[r.action] || r.action,
      r.orderNumber ? `#${r.orderNumber}` : (r.orderId || ''),
      r.tableLabel || '', r.deviceName || '', r.approvedBy || '',
      r.amount ?? '', (r.reason || '').replace(/"/g, "'"),
    ]);
    const csv = [head, ...body].map(line => line.map(c => `"${c}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `staff-audit-${day}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-extrabold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Staff — Action Audit Log
          </h1>
          <p className="text-xs text-muted-foreground">
            Every sensitive action with user, time, order, table and device. Records are append-only.
          </p>
        </div>
        <Input type="date" value={day} onChange={e => setDay(e.target.value)} className="h-9 w-[160px]" />
        <Input placeholder="Search staff…" value={staff} onChange={e => setStaff(e.target.value)} className="h-9 w-[170px]" />
        <select
          value={action}
          onChange={e => setAction(e.target.value as AuditAction | 'all')}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {ACTIONS.map(a => (
            <option key={a} value={a}>{a === 'all' ? 'All actions' : AUDIT_ACTION_TITLES[a]}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {summary.map(([a, n]) => (
          <span key={a} className="px-2 py-1 rounded-lg bg-muted text-[11px] font-bold border">
            {AUDIT_ACTION_TITLES[a as AuditAction] || a}: {n}
          </span>
        ))}
      </div>

      <Card className="p-0 overflow-auto max-h-[70vh]">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr className="text-left">
              <th className="p-2">Date / Time</th>
              <th className="p-2">User</th>
              <th className="p-2">Action</th>
              <th className="p-2">Order</th>
              <th className="p-2">Table</th>
              <th className="p-2">Device</th>
              <th className="p-2">Approved by</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2 whitespace-nowrap">{new Date(r.at).toLocaleString()}</td>
                <td className="p-2">
                  <div className="font-semibold">{r.userName || '—'}</div>
                  <div className="text-[10px] text-muted-foreground">{r.userRole || ''}</div>
                </td>
                <td className="p-2 font-bold">{AUDIT_ACTION_TITLES[r.action] || r.action}</td>
                <td className="p-2">{r.orderNumber ? `#${r.orderNumber}` : (r.orderId ? r.orderId.slice(0, 8) : '—')}</td>
                <td className="p-2">{r.tableLabel || '—'}</td>
                <td className="p-2">{r.deviceName || '—'}</td>
                <td className="p-2">{r.approvedBy || '—'}</td>
                <td className="p-2 text-muted-foreground">
                  {r.amount != null && <span className="mr-2 font-mono">{r.amount}</span>}
                  {r.reason || ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No audit records for this day.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
