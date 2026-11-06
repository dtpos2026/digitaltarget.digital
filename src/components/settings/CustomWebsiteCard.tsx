// ============================================================
// SETTINGS → ONLINE ORDER → "My own website" (v1.107.0)
//
// A restaurant that already has its own food-order website connects it here: orders placed there arrive in the
// software like any other online order, and staff can open that site (or its admin panel) from this card.
//
// The software stores no password of that site. The secret shown here is the key THIS software issues so the site can
// sign its orders; it is displayed once, when created, and only its last four characters afterwards.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Copy, ExternalLink, Globe, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { getTenantId } from '@/lib/tenant';
import {
  CUSTOM_SITE_MODES, EMPTY_STATUS, HEADER_IDEMPOTENCY, HEADER_SIGNATURE, HEADER_TIMESTAMP,
  intakePath, ownSiteActive, type CustomSiteMode, type CustomSiteStatus,
} from '@/lib/customSite';
import { money } from '@/lib/currency';

type Fns = typeof import('@/lib/customSite.functions');

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function copy(text: string, label: string) {
  navigator.clipboard?.writeText(text).then(() => toast.success(`${label} copied`), () => toast.error('Copy failed'));
}

export default function CustomWebsiteCard() {
  const [status, setStatus] = useState<CustomSiteStatus>(EMPTY_STATUS);
  const [mode, setMode] = useState<CustomSiteMode>('builtin');
  const [siteUrl, setSiteUrl] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);

  const fns = useCallback(async (): Promise<Fns> => import('@/lib/customSite.functions'), []);

  const load = useCallback(async () => {
    try {
      const s = await (await fns()).getCustomSiteStatus();
      setStatus(s); setMode(s.mode); setSiteUrl(s.siteUrl ?? ''); setAdminUrl(s.adminUrl ?? ''); setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [fns]);
  useEffect(() => { void load(); }, [load]);

  const run = async (name: string, job: () => Promise<void>) => {
    setBusy(name);
    try { await job(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(null); }
  };

  const save = () => run('save', async () => {
    await (await fns()).saveCustomSiteSettings({ data: { mode, siteUrl: siteUrl.trim() || null, adminUrl: adminUrl.trim() || null } });
    toast.success('Saved');
    await load();
  });
  const makeKey = () => run('key', async () => {
    const r = await (await fns()).rotateCustomSiteKey();
    setSecret(r.secret);
    await load();
  });
  const revoke = () => run('revoke', async () => {
    if (!window.confirm('Revoke the key? The website stops delivering orders until you create a new key.')) return;
    await (await fns()).revokeCustomSiteKey();
    setSecret(null);
    toast.success('Key revoked');
    await load();
  });
  const test = () => run('test', async () => {
    const r = await (await fns()).testCustomSiteConnection();
    setCheck({ ok: r.ok, message: r.message });
    await load();
  });

  const tid = getTenantId() || '<restaurant id>';
  const origin = typeof window !== 'undefined' && window.location.origin.startsWith('https') ? window.location.origin : 'https://<your-software-address>';
  const endpoint = `${origin}${intakePath(tid)}`;
  const active = ownSiteActive(mode);

  return (
    <div className="bg-card border rounded-xl p-4 space-y-4" data-testid="custom-website-card">
      <div className="flex items-start gap-2">
        <Globe className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
        <div>
          <h3 className="text-sm font-bold">My own website</h3>
          <p className="text-[11px] text-muted-foreground">
            Already have your own food-order website? Connect it and its orders arrive here like any other online order.
            The software never stores your website's password.
          </p>
        </div>
      </div>

      {offline && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px]" role="status">
          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>This needs the online server. Open the software from your web address (signed in as the owner) to set it up.</span>
        </div>
      )}

      <fieldset className="grid sm:grid-cols-3 gap-2" disabled={offline}>
        <legend className="sr-only">Which website takes orders</legend>
        {CUSTOM_SITE_MODES.map(m => (
          <button
            key={m.value} type="button" onClick={() => setMode(m.value)} aria-pressed={mode === m.value}
            data-testid={`custom-site-mode-${m.value}`}
            className={`text-left rounded-lg border p-3 transition ${mode === m.value ? 'border-primary bg-primary/10' : 'hover:bg-muted/40'}`}
          >
            <div className="text-xs font-semibold">{m.label}</div>
            <div className="text-[11px] text-muted-foreground">{m.hint}</div>
          </button>
        ))}
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cs-site" className="text-xs text-muted-foreground">Site address</Label>
          <Input id="cs-site" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://myrestaurant.com" disabled={offline} />
        </div>
        <div>
          <Label htmlFor="cs-admin" className="text-xs text-muted-foreground">Its admin panel (optional)</Label>
          <Input id="cs-admin" value={adminUrl} onChange={e => setAdminUrl(e.target.value)} placeholder="https://myrestaurant.com/wp-admin" disabled={offline} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={offline || busy !== null}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        {status.siteUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={status.siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" aria-hidden />Open site</a>
          </Button>
        )}
        {status.adminUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={status.adminUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1" aria-hidden />Open its admin panel</a>
          </Button>
        )}
      </div>

      {active && !offline && (
        <div className="space-y-3 border-t pt-3" data-testid="custom-site-intake">
          <div>
            <Label className="text-xs text-muted-foreground">Where the website sends orders (POST)</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 truncate rounded border bg-muted/30 px-2 py-1.5 text-[11px] font-mono">{endpoint}</code>
              <Button size="sm" variant="outline" onClick={() => copy(endpoint, 'Address')}><Copy className="w-3.5 h-3.5" aria-hidden /><span className="sr-only">Copy address</span></Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              JSON body. Headers: <code>{HEADER_TIMESTAMP}</code> (unix seconds), <code>{HEADER_IDEMPOTENCY}</code> (one unique value per order) and{' '}
              <code>{HEADER_SIGNATURE}</code> = HMAC-SHA256 of <code>&lt;timestamp&gt;.&lt;body&gt;</code> with your key, as hex.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" aria-hidden />
              <div className="text-xs font-semibold">Secret key</div>
              <span className="text-[11px] text-muted-foreground" data-testid="custom-site-key-hint">
                {status.hasKey ? `${status.keyHint} · created ${when(status.keyCreatedAt)}` : 'not created yet'}
              </span>
            </div>
            {secret && (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-1" role="alert" data-testid="custom-site-secret">
                <div className="text-[11px] font-semibold">Copy this key now. It is shown only once.</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all text-[11px] font-mono">{secret}</code>
                  <Button size="sm" variant="outline" onClick={() => copy(secret, 'Key')}><Copy className="w-3.5 h-3.5" aria-hidden /><span className="sr-only">Copy key</span></Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={makeKey} disabled={busy !== null}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden />{status.hasKey ? 'Replace key' : 'Create key'}
              </Button>
              {status.hasKey && <Button size="sm" variant="outline" onClick={revoke} disabled={busy !== null}>Revoke key</Button>}
              <Button size="sm" onClick={test} disabled={busy !== null || !status.hasKey}><ShieldCheck className="w-3.5 h-3.5 mr-1" aria-hidden />{busy === 'test' ? 'Checking…' : 'Check connection'}</Button>
            </div>
            {check && (
              <div className={`flex items-start gap-2 text-[11px] ${check.ok ? 'text-emerald-700' : 'text-destructive'}`} role="status" data-testid="custom-site-check">
                {check.ok ? <Check className="w-3.5 h-3.5 mt-0.5" aria-hidden /> : <TriangleAlert className="w-3.5 h-3.5 mt-0.5" aria-hidden />}
                <span>{check.message}</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Checking sends a signed sample order through every rule but places nothing.</p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center" data-testid="custom-site-health">
            <div className="rounded-lg border p-2"><div className="text-lg font-bold">{status.orders7d}</div><div className="text-[11px] text-muted-foreground">Orders, 7 days</div></div>
            <div className="rounded-lg border p-2"><div className="text-xs font-semibold mt-1">{when(status.lastOrderAt)}</div><div className="text-[11px] text-muted-foreground">Last order</div></div>
            <div className="rounded-lg border p-2"><div className="text-lg font-bold">{status.unmatched7d}</div><div className="text-[11px] text-muted-foreground">Need matching</div></div>
          </div>
          {status.lastError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px]" data-testid="custom-site-last-error">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" aria-hidden />
              <span><b>Last problem</b> ({when(status.lastErrorAt)}): {status.lastError}</span>
            </div>
          )}
          {status.recentUnmatched.length > 0 && (
            <div data-testid="custom-site-unmatched">
              <div className="text-xs font-semibold mb-1">Needs matching</div>
              <p className="text-[11px] text-muted-foreground mb-1">These lines are not on your menu. They were kept on the order with the website's own name and price. Add them to the menu with the same name (or SKU) so the next order matches.</p>
              <ul className="text-[11px] divide-y border rounded-md">
                {status.recentUnmatched.map((u, i) => (
                  <li key={i} className="flex justify-between gap-2 px-2 py-1">
                    <span>{u.quantity} × {u.name}{u.orderNumber ? ` · order #${u.orderNumber}` : ''}</span>
                    <span className="font-mono">{money(u.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
