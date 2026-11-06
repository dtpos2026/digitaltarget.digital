// Super Admin → Monitoring: which restaurants connect their OWN website, and whether it is delivering (v1.108.0).
// Read-only. No secret, no hint of it: only the mode, the addresses, the last order and the last problem.
import { useEffect, useState } from 'react';
import { ExternalLink, Globe, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { listOwnSites, type OwnSiteRow } from '@/lib/customSiteApi';

const MODE_LABEL = { builtin: 'Built-in', own: 'Own website', both: 'Both' } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** A site is "quiet" when it is on, has a key, and nothing arrived for 3 days. */
export function siteState(r: OwnSiteRow, now = Date.now()): 'off' | 'no_key' | 'problem' | 'quiet' | 'ok' {
  if (r.mode === 'builtin') return 'off';
  if (!r.hasKey) return 'no_key';
  if (r.lastError && (!r.lastOrderAt || Date.parse(r.lastErrorAt ?? '') > Date.parse(r.lastOrderAt))) return 'problem';
  if (!r.lastOrderAt || now - Date.parse(r.lastOrderAt) > 3 * 86400_000) return 'quiet';
  return 'ok';
}

const STATE_TEXT = { off: 'Not using it', no_key: 'No key yet', problem: 'Has a problem', quiet: 'Nothing for 3 days', ok: 'Delivering' } as const;

export default function SuperAdminOwnSites() {
  const [rows, setRows] = useState<OwnSiteRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listOwnSites().then(r => { if (live) setRows(r); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  return (
    <section className="bg-card border rounded-xl p-4 space-y-3 mt-4" data-testid="own-sites-panel">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-primary" aria-hidden />
        <h3 className="text-sm font-bold">Restaurants with their own website</h3>
        {rows && <Badge variant="secondary" className="ml-auto">{rows.length}</Badge>}
      </div>
      {failed && <p className="text-xs text-destructive" role="alert">Could not load. Check the connection and that you are signed in as Super Admin.</p>}
      {!failed && rows === null && <p className="text-xs text-muted-foreground">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-xs text-muted-foreground">No restaurant has connected its own website yet.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Restaurant</th>
                <th className="py-1.5 pr-3 font-medium">Mode</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Orders, 7 days</th>
                <th className="py-1.5 pr-3 font-medium">Last order</th>
                <th className="py-1.5 font-medium">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(r => {
                const st = siteState(r);
                return (
                  <tr key={r.tenantId} data-testid={`own-site-${r.tenantId}`}>
                    <td className="py-1.5 pr-3 font-semibold">{r.name}</td>
                    <td className="py-1.5 pr-3">{MODE_LABEL[r.mode]}</td>
                    <td className="py-1.5 pr-3">
                      <span className={st === 'problem' ? 'text-destructive' : st === 'ok' ? 'text-emerald-700' : ''}>
                        {st === 'problem' && <TriangleAlert className="inline w-3 h-3 mr-1" aria-hidden />}
                        {STATE_TEXT[st]}
                      </span>
                      {st === 'problem' && r.lastError && <div className="text-[11px] text-muted-foreground">{r.lastError} ({when(r.lastErrorAt)})</div>}
                    </td>
                    <td className="py-1.5 pr-3 font-mono">{r.orders7d}</td>
                    <td className="py-1.5 pr-3">{when(r.lastOrderAt)}</td>
                    <td className="py-1.5">
                      <div className="flex gap-2">
                        {r.siteUrl && <a href={r.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline"><ExternalLink className="w-3 h-3" aria-hidden />Site</a>}
                        {r.adminUrl && <a href={r.adminUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline"><ExternalLink className="w-3 h-3" aria-hidden />Admin</a>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
