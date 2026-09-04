// Shows the restaurant's Workspace Code so the admin can hand it to staff.
// The code only helps the shared DT Rider / DT Order Taker apps tell two
// restaurants apart when a username is reused — it is NOT a credential.
import { useEffect, useState } from 'react';
import { getTenantId } from '@/lib/tenant';
import { resolveRestaurantIdentity } from '@/lib/restaurantIdentity';
import { Button } from '@/components/ui/button';
import { Copy, KeyRound, Users, BookOpen, CheckCircle2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/lib/hash-router';

/**
 * ===== v1.28.4 — "restaurant create karo to workspace code add hi nahi hota" =====
 *
 * The code was always there. Every restaurant gets one from the
 * tenants_workspace_code trigger at INSERT, and all three live restaurants
 * have had one from the moment they were created.
 *
 * What was missing was any way to SEE it. This card returned null the instant
 * the read came back empty — offline, a lapsed cloud session, or a staff PIN
 * login that has no Supabase session at all — so the card did not appear, no
 * error appeared either, and the only reasonable conclusion was that creating
 * a restaurant does not produce a code.
 *
 * Vanishing silently is the bug. The card now always states where the code is
 * and why it cannot be shown, so "I can't read it right now" is never
 * indistinguishable from "it does not exist".
 */
type CodeState =
  | { kind: 'loading' }
  | { kind: 'ready'; code: string }
  | { kind: 'unavailable'; why: string };

export default function WorkspaceCodeCard() {
  const [state, setState] = useState<CodeState>({ kind: 'loading' });

  const read = async () => {
    const tid = getTenantId();
    setState({ kind: 'loading' });
    try {
      // v1.45.0 — one resolver for the whole app.
      //
      // This card used to do its own three reads and give up. It now asks the
      // same resolver the header chip, the Rider badge and the Order Taker use,
      // so there is no longer a device where the header knows the code and this
      // card claims it does not exist. The resolver covers all four session
      // kinds: cloud owner, staff PIN, portal token, and offline cache.
      const id = await resolveRestaurantIdentity();
      if (id.workspaceCode) { setState({ kind: 'ready', code: id.workspaceCode }); return; }

      setState({
        kind: 'unavailable',
        why: !tid && !id.tenantId
          ? 'This device is not linked to a restaurant yet.'
          : navigator.onLine === false
            ? 'No internet — the code is stored on the server.'
            : 'Sign in again to read it — this device has not stored it yet.',
      });
    } catch (e: any) {
      setState({ kind: 'unavailable', why: e?.message || 'Could not reach the server.' });
    }
  };

  useEffect(() => { void read(); }, []);

  if (state.kind !== 'ready') {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-primary/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Workspace Code</div>
            <p className="text-xs text-foreground/80">
              {state.kind === 'loading'
                ? 'Reading this restaurant’s code…'
                : `Every restaurant has one. ${state.why}`}
            </p>
          </div>
          {state.kind === 'unavailable' && (
            <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={() => void read()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const code = state.code;


  const steps = [
    { text: 'Open DT Rider / DT Order Taker app on staff phone.', },
    { text: 'Enter username and password (or phone + PIN).', },
    { text: 'If the app asks for Workspace Code, type this code exactly.', },
  ];

  return (
    <div className="mb-4 rounded-xl border-2 border-gold bg-gradient-to-br from-card to-[hsl(var(--gold-soft))] shadow-gold p-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Icon + title block */}
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-gold text-primary flex items-center justify-center shadow-gold shrink-0">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Workspace Code</div>
            <div className="font-mono text-2xl font-extrabold tracking-[0.25em] text-primary">{code}</div>
          </div>
        </div>

        {/* Steps */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-background/70 rounded-lg px-3 py-2 border border-primary/10">
              <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-extrabold shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-[11px] leading-tight text-foreground/90">{s.text}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/10 font-bold"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast.success('Workspace Code copied');
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy
          </Button>
          <Link to="/users">
            <Button
              size="sm"
              className="bg-gradient-gold text-primary shadow-gold font-bold w-full sm:w-auto"
            >
              <Users className="h-3.5 w-3.5 mr-1" /> Manage Staff
            </Button>
          </Link>
        </div>
      </div>

      {/* Footer links / notes */}
      <div className="mt-3 pt-3 border-t border-gold/40 flex flex-wrap items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
          <span>Code is required only when the same username exists at multiple restaurants.</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/docs/DT-MULTISAAS-APPS.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:text-gold hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" /> APK Setup Guide
          </a>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
