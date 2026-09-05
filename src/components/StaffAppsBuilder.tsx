// ============================================================================
// Super Admin → the two staff apps: DT Rider and DT Order Taker
//
// REPORTED: "rider app apk ka b BUTT BBQ ata, order taker app ka b BUTT BBQ
// name ata — koi super admin me nhi branding kr skty."
//
// Both halves of that are real, and they pull in opposite directions:
//
//   - The names WERE wrong. A build was started with a restaurant selected, and
//     the branding step renamed all three apps, so every rider's phone showed
//     one restaurant's name whichever restaurant they actually worked for.
//   - There was no way to build these two from Super Admin at all. The panel
//     hard-coded apps:'Customer', so the only route was the GitHub UI.
//
// The fix is not to add per-restaurant branding here. These two are ONE build
// for every restaurant — the login resolves user → restaurant → branch → role,
// which is what lets a rider move between branches and what stops us shipping a
// separate APK per customer. Branding them per restaurant is what broke them.
//
// So: this panel builds them, and deliberately sends no tenant. The server
// refuses a tenant on these two as well (apk-build, v1.48.0), so the mistake
// cannot be repeated from anywhere else either.
// ============================================================================
import { useState } from 'react';
import { Bike, ClipboardList, Loader2, Package, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { versionCodeFor } from '@/lib/appVersionCode';

type Which = 'Rider' | 'OrderTaker';

const APPS: Array<{ key: Which; label: string; pkg: string; icon: typeof Bike }> = [
  { key: 'Rider', label: 'DT Rider', pkg: 'com.digitaltarget.dtrider', icon: Bike },
  { key: 'OrderTaker', label: 'DT Order Taker', pkg: 'com.digitaltarget.dtordertaker', icon: ClipboardList },
];

export default function StaffAppsBuilder() {
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState<Which | 'all' | null>(null);

  const code = versionCodeFor(version);
  const versionLooksWrong = version.trim() !== '' && !code;

  async function build(which: Which | 'all') {
    if (versionLooksWrong) {
      toast.error('Version must look like 1.2.3, with each part under 100.');
      return;
    }
    setBusy(which);
    try {
      const { sb } = await import('@/lib/supabase');
      const { data: session } = await sb().auth.getSession();
      if (!session?.session?.access_token) {
        toast.error('Sign in again — the session has expired.');
        return;
      }

      const { data, error } = await sb().functions.invoke('apk-build', {
        body: {
          // No tenant_id, deliberately. See the note at the top of this file.
          apps: which === 'all' ? 'all' : which,
          refresh_bundle: false,
          app_version: version.trim(),
          version_code: code,
        },
      });

      if (error) {
        // A non-2xx from an edge function arrives as an error whose body holds
        // the useful part, so show the reason rather than "failed".
        let detail = '';
        try { detail = (await (error as any).context?.json())?.message ?? ''; } catch { /* body read */ }
        throw new Error(detail || error.message);
      }
      toast.success(data?.message ?? 'Build started.', { duration: 12000 });
    } catch (e: any) {
      toast.error(String(e?.message ?? e), { duration: 12000 });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Staff Apps — Rider &amp; Order Taker</h2>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex gap-2">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed text-foreground/90 space-y-1">
          <p>
            <strong>These two are one build for every restaurant.</strong> A rider
            signs in with their username and password, and the server works out
            which restaurant, branch and role they belong to. That is what lets
            one APK serve every client and a rider move between branches.
          </p>
          <p>
            So they are <strong>not</strong> branded per restaurant, and there is
            no restaurant to pick here. Building them with a restaurant selected
            is what once put one client's name on every rider's phone; the server
            now refuses that outright.
          </p>
          <p className="text-muted-foreground">
            The restaurant a staff member works for is shown inside the app, from
            their login — name, branch and Workspace Code in the header.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Version name
          </label>
          <Input
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder="1.2.0"
            className={`h-9 w-32 font-mono ${versionLooksWrong ? 'border-destructive' : ''}`}
          />
        </div>
        <div className="text-[11px] text-muted-foreground pb-2">
          {versionLooksWrong
            ? <span className="text-destructive">Use 1.2.3, each part under 100.</span>
            : code
              ? <>versionCode <span className="font-mono font-bold">{code}</span> — must be higher than what is installed, or Android refuses the update.</>
              : <>Leave blank to keep the version the repository already carries.</>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {APPS.map(a => (
          <div key={a.key} className="border rounded-lg bg-card p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <a.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{a.label}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">{a.pkg}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void build(a.key)}
            >
              {busy === a.key
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Package className="h-3.5 w-3.5 mr-1" />}
              Build
            </Button>
          </div>
        ))}
      </div>

      <Button
        size="sm"
        disabled={busy !== null}
        onClick={() => void build('all')}
      >
        {busy === 'all'
          ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          : <Package className="h-3.5 w-3.5 mr-1" />}
        Build all three (Customer, Rider, Order Taker)
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Builds run on GitHub Actions and take a few minutes. The APKs appear as
        artifacts on the run.
      </p>
    </div>
  );
}
