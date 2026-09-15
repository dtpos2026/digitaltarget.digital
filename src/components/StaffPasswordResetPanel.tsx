// ============================================================================
// v1.56.0 — emergency staff password reset, from the Super Admin panel
//
// REQUESTED: "jesy forget pass ya email waa ata ha asy he agy her resturant ka
// super admin penal sy user pass forget ho ya change kr sko ... ak bnda pass
// bhol gya din ka ya caser ka pos open he nhi hota is leyi ye option emergency
// rkho super admin penal me" — and, to be unambiguous: "ye user pass ka forget
// krny ka option super admin me ho, ye nhi ky super admin pass krna". This
// resets a RESTAURANT staff member's password. It does not touch the Super
// Admin's own login.
//
// The restaurant's own admin can already do this in Users & Access. This panel
// exists for the case where nobody in the restaurant can: the person who
// forgot the password IS the admin, or it is the middle of service and the
// cashier cannot open the till.
//
// WHAT THE OPERATOR SHOULD UNDERSTAND WHILE USING IT, so it is written on the
// screen and not only in a migration:
//   * the new password works ONCE — the staff member must choose their own on
//     the way in, so this cannot become a permanent shared password;
//   * the restaurant sees the reset in their own audit history, with the Super
//     Admin's email against it.
// ============================================================================
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { KeyRound, Copy, Check, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  listTenantStaff, resetStaffPassword,
  type TenantStaffMember, type StaffPasswordReset,
} from '@/lib/superAdminSupabase';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', cashier: 'Cashier',
  order_taker: 'Order Taker', waiter: 'Waiter', rider: 'Rider', kitchen: 'Kitchen',
};

export default function StaffPasswordResetPanel({ tenantId, restaurantName }: {
  tenantId: string;
  restaurantName?: string;
}) {
  const [staff, setStaff] = useState<TenantStaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // v1.56.2 — the new password must survive a refresh.
  //
  // WHAT WENT WRONG IN PRODUCTION: three accounts were reset, the password was
  // shown once in React state, the page moved on, and the passwords were gone —
  // so those restaurants could not sign in at all and had to be reset again
  // from the database. A reset that loses its own result is worse than no
  // reset, because the old password is already dead by then.
  //
  // sessionStorage, not localStorage: it is the operator's own browser, it dies
  // with the tab, and "Done" below clears it explicitly. Scoped per restaurant
  // so switching restaurants cannot show the wrong one.
  const DONE_KEY = `dt-sa-last-reset:${tenantId}`;
  const [done, setDoneState] = useState<StaffPasswordReset | null>(() => {
    try {
      const raw = sessionStorage.getItem(DONE_KEY);
      return raw ? JSON.parse(raw) as StaffPasswordReset : null;
    } catch { return null; }
  });
  const setDone = (v: StaffPasswordReset | null) => {
    setDoneState(v);
    try {
      if (v) sessionStorage.setItem(DONE_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(DONE_KEY);
    } catch { /* the value is on screen either way */ }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listTenantStaff(tenantId);
      setStaff(r.staff);
    } catch (e: any) {
      // Never a silent catch: an empty list and a refused read look identical
      // on screen otherwise, and the operator would keep clicking.
      setStaff(null);
      setError(e?.message || 'Could not load the staff list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const submit = async (u: TenantStaffMember) => {
    setBusy(true);
    try {
      const r = await resetStaffPassword(u.userId, custom, reason);
      setDone(r);
      setOpenFor(null);
      setCustom(''); setReason(''); setCopied(false);
      toast.success(`New password set for ${r.name || r.username}`);
      void load();
    } catch (e: any) {
      toast.error(e?.message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in plenty of browsers. The password is on screen
      // either way — say so rather than pretending the copy worked.
      toast.error('Could not copy — please read it from the screen.');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-xs font-bold uppercase tracking-wider text-violet-600 flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          Staff Logins — emergency password reset
        </h3>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        Use this when nobody at <strong>{restaurantName || 'the restaurant'}</strong> can get in —
        the cashier forgot their password and the POS will not open, or the admin
        themselves is locked out. The new password works <strong>once</strong>: the staff
        member has to choose their own before the POS lets them through. The
        restaurant sees this reset in their own audit history, against your email.
      </p>

      {done && (
        <div className="mb-3 rounded-lg border-2 border-green-500/40 bg-green-500/10 p-3">
          <div className="text-[11px] font-bold text-green-700 dark:text-green-400 mb-1.5">
            New password for {done.name || done.username} ({ROLE_LABEL[done.role] || done.role})
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-3 py-1.5 rounded bg-background border font-mono text-base font-bold tracking-wider select-all">
              {done.password}
            </code>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void copy(done.password)}>
              {copied ? <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                // Confirmed, because this is the only copy that exists. Once it
                // is gone the account has to be reset all over again.
                if (window.confirm('Have you given this password to them? It cannot be shown again.')) {
                  setDone(null);
                }
              }}
            >
              Done — I have it
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
            <span>
              Write this down before you leave the page. It is not stored anywhere
              in readable form — if it is lost the account has to be reset again.
              Username to sign in with: <strong className="font-mono">{done.username}</strong>
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-700 dark:text-red-400 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold">{error}</div>
            <div className="text-muted-foreground mt-0.5">
              Only a Super Admin account can read or reset restaurant staff logins.
            </div>
          </div>
        </div>
      )}

      {!error && loading && !staff && (
        <div className="text-[11px] text-muted-foreground py-2">Loading staff…</div>
      )}

      {!error && staff && staff.length === 0 && (
        <div className="text-[11px] text-muted-foreground py-2">
          This restaurant has no staff logins yet.
        </div>
      )}

      {!error && staff && staff.length > 0 && (
        <div className="space-y-2">
          {staff.map(u => (
            <div key={u.userId} className="bg-card border rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate flex items-center gap-2">
                    {u.name || u.username}
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300">
                      {ROLE_LABEL[u.role] || u.role}
                    </span>
                    {!u.isActive && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-600">
                        Switched off
                      </span>
                    )}
                    {u.mustChangePassword && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        Must set a new password
                      </span>
                    )}
                    {!u.hasPassword && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600">
                        No password set
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    signs in as <span className="font-mono font-bold">{u.username}</span>
                    {u.phone ? ` · ${u.phone}` : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                  onClick={() => {
                    setOpenFor(openFor === u.userId ? null : u.userId);
                    setCustom(''); setReason('');
                  }}
                >
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                  {openFor === u.userId ? 'Cancel' : 'Reset Password'}
                </Button>
              </div>

              {openFor === u.userId && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        New password (optional)
                      </label>
                      <Input
                        value={custom}
                        onChange={e => setCustom(e.target.value)}
                        placeholder="leave blank to generate one"
                        className="h-8 mt-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Reason (kept in their audit log)
                      </label>
                      <Input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="e.g. cashier forgot password, called at 7pm"
                        className="h-8 mt-1 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                      disabled={busy}
                      onClick={() => void submit(u)}
                    >
                      {busy ? 'Resetting…' : `Reset ${u.name || u.username}'s password`}
                    </Button>
                    <span className="text-[10px] text-muted-foreground">
                      Their current password stops working immediately.
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
