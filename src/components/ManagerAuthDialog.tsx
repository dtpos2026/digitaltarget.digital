// ============================================================
// v1.2.5 — Manager authorization dialog.
//
// Used for protected actions (e.g. removing/voiding an item from a bill)
// when the admin has enabled the corresponding setting. Only Admin /
// Manager credentials unlock the action, and every attempt is logged.
//
// The dialog is intentionally self-contained so it can be dropped into
// any screen without touching that screen's own state handling.
// ============================================================
import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ShieldAlert } from 'lucide-react';
import { getUsers } from '@/lib/store';

export interface ManagerAuthDialogProps {
  open: boolean;
  /** Shown under the title, e.g. "Item remove karne ke liye ijazat chahiye". */
  reason?: string;
  /** Called with the authorizing user's name when the password is correct. */
  onAuthorized: (byName: string) => void;
  onCancel: () => void;
}

/** Roles allowed to authorize a protected action. */
const AUTH_ROLES = ['admin', 'manager', 'owner'];

/**
 * Async manager check for the Supabase backend.
 *
 * The synchronous version below scans the LOCAL user array and compares
 * plaintext. On Supabase the hash never leaves the database, so it can never
 * match — every correct manager password was rejected. This asks Postgres.
 */
export async function verifyManagerPasswordAsync(
  password: string,
): Promise<{ ok: boolean; name?: string; message?: string }> {
  // ===== v1.49.0 — the Order Taker could not ask at all =====
  //
  // REPORTED: "Order Taker payment pe admin/manager password sahi daalo to
  // bhi 'Not Valid' aata hai."
  //
  // The password was never the problem. verify_manager_password below is
  // granted to `authenticated` only, and guards on auth_tenant_id(). An Order
  // Taker holds a portal token, not a Supabase session — it is `anon` with a
  // null auth.uid() — so the call was refused before it reached the password
  // comparison, the catch turned that into { ok: false }, and the manager
  // standing at the till was told their own password was wrong.
  //
  // portal_verify_manager resolves the restaurant from the TOKEN (no tenant
  // parameter exists, so one cannot be spoofed) and locks the SESSION after
  // five wrong tries — the device guessing, never the manager's account, which
  // would otherwise let any order taker lock their boss out of the till.
  try {
    const { hasPortalSession, portalVerifyManager } = await import('@/lib/portalData');
    if (hasPortalSession()) {
      const res = await portalVerifyManager(password);
      if (!res.ok) return { ok: false, message: res.message };
      const d = res.data;
      if (d?.ok) return { ok: true, name: d.name };
      if (d?.reason === 'locked') {
        const mins = Math.ceil((d.retryAfterSeconds ?? 900) / 60);
        return { ok: false, message: `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
      }
      if (typeof d?.attemptsLeft === 'number') {
        return { ok: false, message: `Wrong password — ${d.attemptsLeft} tr${d.attemptsLeft === 1 ? 'y' : 'ies'} left.` };
      }
      return { ok: false };
    }
  } catch { /* not a portal device, or offline — fall through */ }

  const { usingSupabaseAuth, authTenantId } = await import('@/lib/authProvider');
  if (!usingSupabaseAuth()) return verifyManagerPassword(password);

  const tenantId = authTenantId();
  if (!tenantId) return { ok: false };
  try {
    const { sb } = await import('@/lib/supabase');
    const { data, error } = await sb().rpc('verify_manager_password', {
      p_tenant: tenantId, p_password: (password || '').trim(),
    });
    if (error) throw error;
    const r = data as { ok: boolean; name?: string };
    return r?.ok ? { ok: true, name: r.name } : { ok: false };
  } catch (e) {
    console.error('[managerAuth] verification failed', e);
    return { ok: false };
  }
}

/** Legacy synchronous check — Firebase backend only. */
export function verifyManagerPassword(password: string): { ok: boolean; name?: string } {
  const pw = (password || '').trim();
  if (!pw) return { ok: false };
  try {
    const match = getUsers().find(u =>
      u.isActive !== false
      && AUTH_ROLES.includes(String(u.role || '').toLowerCase())
      && String(u.password || '') === pw
    );
    return match ? { ok: true, name: match.name || match.username } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export default function ManagerAuthDialog({ open, reason, onAuthorized, onCancel }: ManagerAuthDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setError('');
      setAttempts(0);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const submit = async () => {
    const res = await verifyManagerPasswordAsync(password);
    if (!res.ok && res.message) {
      // The server said something specific — how many tries are left, or how
      // long the lockout runs. Replacing that with "Not valid" is how the last
      // bug stayed invisible for so long.
      setAttempts(a => a + 1);
      setError(res.message);
      setPassword('');
      return;
    }
    if (res.ok) {
      setPassword('');
      setError('');
      onAuthorized(res.name || 'manager');
      return;
    }
    const n = attempts + 1;
    setAttempts(n);
    setPassword('');
    setError(n >= 3
      ? 'Wrong password. Please contact an Admin or Manager.'
      : 'Wrong password — please try again.');
    inputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Manager Authorization
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {reason || 'This action requires an Admin or Manager password.'}
          </p>
          <div>
            <Label className="text-xs">Admin / Manager Password</Label>
            <Input
              ref={inputRef}
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="••••••"
            />
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={!password.trim()}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
